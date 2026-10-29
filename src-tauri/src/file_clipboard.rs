use serde_json::{json, Value};
use std::{
    io::Write,
    path::Path,
    process::{Command, Stdio},
};

fn text_clipboard(operation: &str, payload: &Value) -> Result<Value, String> {
    let board = if cfg!(debug_assertions) {
        std::env::var("ISLET_TEST_PASTEBOARD").unwrap_or_default()
    } else {
        String::new()
    };
    let writing = operation == "desktop.clipboard.writeText";
    let text = if writing {
        payload
            .get("text")
            .and_then(Value::as_str)
            .ok_or("Clipboard text is required")?
    } else {
        ""
    };
    let script = if writing {
        r#"ObjC.import('AppKit'); function run(argv) { var pb = argv[0] ? $.NSPasteboard.pasteboardWithName($(argv[0])) : $.NSPasteboard.generalPasteboard; var data = $.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile; var text = $.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding); pb.clearContents; if (!pb.setStringForType(text, $.NSPasteboardTypeString)) throw Error('Clipboard write failed'); return 'true'; }"#
    } else {
        r#"ObjC.import('AppKit'); function run(argv) { var pb = argv[0] ? $.NSPasteboard.pasteboardWithName($(argv[0])) : $.NSPasteboard.generalPasteboard; var text = pb.stringForType($.NSPasteboardTypeString); return JSON.stringify(text ? ObjC.unwrap(text) : ''); }"#
    };
    let mut child = Command::new("/usr/bin/osascript")
        .args(["-l", "JavaScript", "-e", script, "--", &board])
        .stdin(if writing {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|_| "The text clipboard is unavailable.".to_string())?;
    // Clipboard contents travel over stdin, never shell interpolation or argv.
    if writing {
        child
            .stdin
            .take()
            .ok_or("Clipboard input unavailable")?
            .write_all(text.as_bytes())
            .map_err(|_| "Could not copy text to the clipboard")?;
    }
    let output = child
        .wait_with_output()
        .map_err(|_| "The text clipboard did not respond")?;
    if !output.status.success() {
        return Err("The text clipboard could not be accessed. Try the native Edit menu.".into());
    }
    serde_json::from_slice(&output.stdout).map_err(|_| "Invalid clipboard response".into())
}

pub fn handle(operation: &str, payload: &Value) -> Result<Value, String> {
    if !cfg!(target_os = "macos") {
        return Err("File clipboard integration is currently supported on macOS.".into());
    }
    if matches!(
        operation,
        "desktop.clipboard.readText" | "desktop.clipboard.writeText"
    ) {
        return text_clipboard(operation, payload);
    }
    // JXA uses the system AppKit file-URL pasteboard, without Apple Events,
    // clipboard text access, shell interpolation, or an additional runtime.
    let board = if cfg!(debug_assertions) {
        std::env::var("ISLET_TEST_PASTEBOARD").unwrap_or_default()
    } else {
        String::new()
    };
    let mut command = Command::new("/usr/bin/osascript");
    command.args(["-l", "JavaScript", "-e"]);
    if operation == "desktop.clipboard.copyFiles" {
        if payload.get("hostId").and_then(Value::as_str) != Some("local") {
            return Err("Only local items can be copied to Finder's clipboard.".into());
        }
        let paths = payload
            .get("paths")
            .and_then(Value::as_array)
            .ok_or("Choose local files or folders.")?;
        if paths.is_empty() || paths.len() > 1000 {
            return Err("Choose 1–1000 local items.".into());
        }
        let mut values = Vec::new();
        for value in paths {
            let value = value.as_str().ok_or("Invalid clipboard path.")?;
            if value.contains(['\0', '\r', '\n'])
                || !Path::new(value).is_absolute()
                || !Path::new(value).exists()
            {
                return Err("The copied item is not an existing absolute local path.".into());
            }
            values.push(value);
        }
        command.arg(r#"ObjC.import('AppKit'); function run(argv) { var name = argv.shift(); var pb = name ? $.NSPasteboard.pasteboardWithName($(name)) : $.NSPasteboard.generalPasteboard; pb.clearContents; if (!pb.writeObjects($(argv.map(function(p) { return $.NSURL.fileURLWithPath($(p)); })))) throw Error('Could not write the file clipboard'); return 'true'; }"#);
        command.arg("--").arg(&board).args(values);
    } else if operation == "desktop.clipboard.readFiles" {
        command.arg(r#"ObjC.import('AppKit'); function run(argv) { var pb = argv[0] ? $.NSPasteboard.pasteboardWithName($(argv[0])) : $.NSPasteboard.generalPasteboard, items = pb.pasteboardItems, paths = []; if (items) for (var i = 0; i < Number(items.count); i++) { var item = items.objectAtIndex(i), value = item.stringForType($('public.file-url')); if (ObjC.unwrap(value)) { var url = $.NSURL.URLWithString(value); if (url.isFileURL) paths.push(ObjC.unwrap(url.path)); } } if (!paths.length) { var old = pb.propertyListForType($('NSFilenamesPboardType')); if (old) for (var j = 0; j < Number(old.count); j++) paths.push(ObjC.unwrap(old.objectAtIndex(j))); } return JSON.stringify(paths); }"#);
        command.arg("--").arg(&board);
    } else {
        return Err("Unknown file clipboard operation.".into());
    }
    let output = command
        .output()
        .map_err(|error| format!("File clipboard unavailable: {error}"))?;
    if !output.status.success() {
        return Err(
            "The macOS file clipboard could not be accessed. Try copying the file again.".into(),
        );
    }
    let value: Value =
        serde_json::from_slice(&output.stdout).map_err(|_| "Invalid file clipboard response.")?;
    if operation.ends_with("readFiles") {
        let paths: Vec<String> = value
            .as_array()
            .ok_or("Invalid clipboard file list.")?
            .iter()
            .filter_map(|item| item.as_str())
            .filter(|item| Path::new(item).is_absolute() && !item.contains(['\0', '\r', '\n']))
            .take(1000)
            .map(String::from)
            .collect();
        return Ok(json!(paths));
    }
    Ok(json!(true))
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;
    #[test]
    fn text_round_trip_uses_an_isolated_native_pasteboard() {
        let name = format!("islet-text-test-{}", std::process::id());
        std::env::set_var("ISLET_TEST_PASTEBOARD", &name);
        let text = "Unicode café 😃 اردو\n'quotes' $(literal) `literal`";
        assert_eq!(
            handle("desktop.clipboard.writeText", &json!({"text":text})).unwrap(),
            json!(true)
        );
        assert_eq!(
            handle("desktop.clipboard.readText", &json!({})).unwrap(),
            json!(text)
        );
        assert_eq!(
            handle("desktop.clipboard.readFiles", &json!({})).unwrap(),
            json!([])
        );
        handle("desktop.clipboard.writeText", &json!({"text":""})).unwrap();
        assert_eq!(
            handle("desktop.clipboard.readText", &json!({})).unwrap(),
            json!("")
        );
        std::env::remove_var("ISLET_TEST_PASTEBOARD");
    }
}
