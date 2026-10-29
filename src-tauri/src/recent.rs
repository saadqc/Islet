use crate::HostState;
use serde_json::{json, Value};
use tauri::Manager;

pub async fn open(app: tauri::AppHandle, id: &str) -> Result<Value, String> {
    let host = app.state::<HostState>();
    let project = host.request("recents.get".into(), json!({"id":id})).await?;
    let windows = host.request("app.windows".into(), json!({})).await?;
    let rows = windows.as_array().ok_or("Invalid window list")?;
    let existing = rows.iter().find(|window| {
        if project["kind"] == "workspace" {
            window["workspaceIdentity"] == project["path"]
        } else {
            window["roots"].as_array().is_some_and(|roots| {
                roots.iter().any(|root| {
                    root["hostId"] == project["hostId"] && root["path"] == project["path"]
                })
            })
        }
    });
    if let Some(window) = existing
        .and_then(|row| row["id"].as_str())
        .and_then(|id| app.get_webview_window(id))
    {
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
        return Ok(json!(true));
    }
    let empty = rows
        .iter()
        .find(|row| row["empty"] == true)
        .and_then(|row| row["id"].as_str());
    let window_id = if let Some(id) = empty {
        id.to_owned()
    } else {
        crate::new_window(&app).await?
    };
    let mut root = json!({"hostId":project["hostId"],"path":project["path"]});
    if let Some(interpreter) = project.get("interpreter").and_then(Value::as_str) {
        root["interpreter"] = json!(interpreter);
    }
    let payload = if project["kind"] == "workspace" {
        json!({"operation":"open","windowId":window_id,"workspace":project["path"],"newWindow":false})
    } else {
        json!({"operation":"add","windowId":window_id,"roots":[root],"newWindow":false})
    };
    host.request("cli.deliver".into(), payload).await?;
    if let Some(window) = app.get_webview_window(&window_id) {
        let _ = window.show();
        let _ = window.set_focus();
    }
    Ok(json!(true))
}

pub async fn refresh(app: &tauri::AppHandle) {
    #[cfg(target_os = "macos")]
    if let Ok(entries) = app
        .state::<HostState>()
        .request("recents.list".into(), json!({}))
        .await
    {
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || crate::dock::refresh(handle, entries));
    }
}
