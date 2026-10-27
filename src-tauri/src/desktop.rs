use serde_json::{json, Value};
use std::{
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{Duration, Instant},
};

fn find_executable(name: &str) -> Option<PathBuf> {
    std::env::var_os("PATH").and_then(|paths| {
        std::env::split_paths(&paths)
            .map(|directory| directory.join(name))
            .find(|file| file.is_file())
    })
}

fn app_path(name: &str) -> Option<PathBuf> {
    let mut candidates = vec![PathBuf::from("/Applications").join(name)];
    if let Some(home) = std::env::var_os("HOME") {
        candidates.push(PathBuf::from(home).join("Applications").join(name));
    }
    candidates.into_iter().find(|p| p.is_dir())
}

fn detected(id: &str) -> Option<PathBuf> {
    if cfg!(target_os = "macos") {
        match id {
            "system" | "terminal" => {
                Some(PathBuf::from("/System/Applications/Utilities/Terminal.app"))
            }
            "marinashell" => app_path("MarinaShell.app"),
            "iterm" => app_path("iTerm.app"),
            _ => None,
        }
    } else if cfg!(target_os = "windows") {
        match id {
            "system" => find_executable("wt.exe"),
            "marinashell" => find_executable("MarinaShell.exe"),
            _ => None,
        }
    } else {
        match id {
            "system" => ["x-terminal-emulator", "gnome-terminal", "konsole", "xterm"]
                .iter()
                .find_map(|name| find_executable(name)),
            "marinashell" => find_executable("marinashell"),
            "gnome" => find_executable("gnome-terminal"),
            "konsole" => find_executable("konsole"),
            _ => None,
        }
    }
}

fn terminal_list() -> Value {
    let mut choices = vec![
        ("system", "System terminal"),
        ("marinashell", "MarinaShell"),
    ];
    if cfg!(target_os = "macos") {
        choices.extend([("terminal", "Terminal"), ("iterm", "iTerm")]);
    } else if cfg!(target_os = "linux") {
        choices.extend([("gnome", "GNOME Terminal"), ("konsole", "Konsole")]);
    }
    json!(choices
        .into_iter()
        .map(|(id, name)| {
            let path = detected(id);
            json!({"id":id,"name":name,"available":path.as_ref().is_some_and(|p| p.exists()),"path":path.map(|p|p.to_string_lossy().to_string()).unwrap_or_default()})
        })
        .collect::<Vec<_>>())
}

fn local_path(payload: &Value, folder: bool) -> Result<PathBuf, String> {
    if payload.get("hostId").and_then(Value::as_str) != Some("local") {
        return Err("Use Copy SSH Command for a remote folder.".into());
    }
    let raw = payload
        .get("path")
        .and_then(Value::as_str)
        .ok_or("A path is required.")?;
    if raw.contains(['\0', '\r', '\n']) {
        return Err("The path contains unsupported control characters.".into());
    }
    let path = PathBuf::from(raw);
    if !path.is_absolute() || !path.exists() || (folder && !path.is_dir()) {
        return Err(if folder {
            "Choose an existing local folder."
        } else {
            "The file or folder no longer exists."
        }
        .into());
    }
    Ok(path)
}

fn launch(mut command: Command, wait: bool) -> Result<Value, String> {
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    let mut child = command
        .spawn()
        .map_err(|e| format!("Could not launch the application: {e}"))?;
    if !wait {
        std::thread::spawn(move || {
            let _ = child.wait();
        });
        return Ok(json!(true));
    }
    let start = Instant::now();
    loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            return if status.success() {
                Ok(json!(true))
            } else {
                Err(
                    "The application could not open this location. Check its path in Settings."
                        .into(),
                )
            };
        }
        if start.elapsed() > Duration::from_secs(10) {
            let _ = child.kill();
            let _ = child.wait();
            return Err("The system launcher did not respond.".into());
        }
        std::thread::sleep(Duration::from_millis(30));
    }
}

fn marina_version_ok(app: &Path) -> Result<(), String> {
    // macOS bundles expose their version without starting the application.
    let output = Command::new("/usr/bin/plutil")
        .args(["-extract", "CFBundleShortVersionString", "raw", "-o", "-"])
        .arg(app.join("Contents/Info.plist"))
        .output()
        .map_err(|e| e.to_string())?;
    let version = String::from_utf8_lossy(&output.stdout);
    let parts = version
        .trim()
        .split('.')
        .map(|v| v.parse::<u32>().unwrap_or(0))
        .collect::<Vec<_>>();
    if !output.status.success() || parts.as_slice() < [0, 2, 24].as_slice() {
        return Err("Opening a folder requires MarinaShell 0.2.24 or newer. Update MarinaShell or choose another terminal in Settings.".into());
    }
    Ok(())
}

pub fn handle(operation: &str, payload: &Value) -> Result<Value, String> {
    if operation.starts_with("desktop.clipboard.") {
        return crate::file_clipboard::handle(operation, payload);
    }
    if operation == "desktop.terminals" {
        return Ok(terminal_list());
    }
    let folder = operation == "desktop.openTerminal";
    if !folder && operation != "desktop.reveal" {
        return Err("Unknown desktop action.".into());
    }
    let path = local_path(payload, folder)?;
    if !folder {
        let mut command;
        if cfg!(target_os = "macos") {
            command = Command::new("/usr/bin/open");
            command.arg("-R").arg(&path);
        } else if cfg!(target_os = "windows") {
            command = Command::new("explorer.exe");
            command.arg(format!("/select,{}", path.to_string_lossy()));
        } else {
            command = Command::new("xdg-open");
            command.arg(path.parent().unwrap_or(&path));
        }
        return launch(command, !cfg!(target_os = "windows"));
    }
    let preference = payload
        .get("terminal")
        .cloned()
        .unwrap_or_else(|| json!({}));
    let id = preference
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or("system");
    let override_path = preference.get("path").and_then(Value::as_str).unwrap_or("");
    let application = if override_path.is_empty() { detected(id) } else { Some(PathBuf::from(override_path)) }
        .ok_or("The selected terminal is not installed or could not be detected. Choose its path in Settings.")?;
    if !application.is_absolute() || !application.exists() {
        return Err(
            "The terminal path is unavailable. Choose an installed application in Settings.".into(),
        );
    }
    let marina = id == "marinashell"
        || application
            .file_name()
            .is_some_and(|n| n.to_string_lossy().to_lowercase().contains("marinashell"));
    if cfg!(target_os = "macos") && application.extension().is_some_and(|e| e == "app") {
        if marina {
            marina_version_ok(&application)?;
        }
        let mut command = Command::new("/usr/bin/open");
        if marina {
            command
                .arg("-n")
                .arg("-a")
                .arg(application)
                .args(["--args", "--open-directory"])
                .arg(path);
        } else {
            command.arg("-a").arg(application).arg(path);
        }
        return launch(command, true);
    }
    if !application.is_file() {
        return Err("Choose a terminal executable or macOS application bundle.".into());
    }
    let name = application
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_lowercase();
    if [
        "cmd.exe",
        "powershell.exe",
        "pwsh.exe",
        "bash",
        "zsh",
        "sh",
        "fish",
    ]
    .contains(&name.as_str())
    {
        return Err("Choose a terminal application, such as Windows Terminal, rather than a command shell executable.".into());
    }
    let mut command = Command::new(&application);
    command.current_dir(&path);
    if marina {
        command.arg("--open-directory").arg(&path);
    } else if name == "wt.exe" {
        command.arg("-d").arg(&path);
    } else if name == "gnome-terminal" {
        command.arg("--working-directory").arg(&path);
    } else if name == "konsole" {
        command.arg("--workdir").arg(&path);
    } else if id == "custom" {
        command.arg(&path);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x00000010); // CREATE_NEW_CONSOLE
    }
    launch(command, false)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn local_actions_reject_remote_and_nonexistent_paths() {
        assert!(local_path(&json!({"hostId":"ssh:example","path":"/"}), true).is_err());
        assert!(local_path(&json!({"hostId":"local","path":"relative"}), false).is_err());
        assert!(local_path(
            &json!({"hostId":"local","path":"/missing-islet-test-location"}),
            false
        )
        .is_err());
        assert!(local_path(&json!({"hostId":"local","path":"/tmp\ninjected"}), true).is_err());
    }
    #[test]
    #[cfg(unix)]
    fn custom_terminal_receives_a_literal_directory_and_working_directory() {
        use std::{fs, os::unix::fs::PermissionsExt, time::SystemTime};
        let dir = std::env::temp_dir().join(format!(
            "islet-terminal-{}",
            SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let folder = dir.join("folder with 'quotes' $(not-a-command)");
        fs::create_dir_all(&folder).unwrap();
        let script = dir.join("terminal-stub");
        let output = dir.join("received.txt");
        fs::write(
            &script,
            format!(
                "#!/bin/sh\nprintf '%s\\n' \"$PWD\" \"$@\" > '{}'\n",
                output.display()
            ),
        )
        .unwrap();
        fs::set_permissions(&script, fs::Permissions::from_mode(0o700)).unwrap();
        handle(
            "desktop.openTerminal",
            &json!({"hostId":"local","path":folder,"terminal":{"id":"custom","path":script}}),
        )
        .unwrap();
        for _ in 0..100 {
            if output.exists() {
                break;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        let result = fs::read_to_string(output).unwrap();
        let lines = result.lines().collect::<Vec<_>>();
        assert_eq!(
            PathBuf::from(lines[0]).canonicalize().unwrap(),
            folder.canonicalize().unwrap()
        );
        assert_eq!(lines[1], folder.to_string_lossy());
        assert_eq!(lines.len(), 2);
        fs::remove_dir_all(dir).unwrap();
    }
}
