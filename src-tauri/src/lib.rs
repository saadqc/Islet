use serde_json::{json, Value};
use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Write},
    path::PathBuf,
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{Emitter, Manager};
use tokio::sync::oneshot;
mod desktop;

type Reply = Result<Value, String>;
struct HostState {
    input: Mutex<ChildStdin>,
    child: Mutex<Child>,
    pending: Arc<Mutex<HashMap<u64, oneshot::Sender<Reply>>>>,
    next: AtomicU64,
    initial_args: Vec<String>,
}
impl HostState {
    fn start(app: tauri::AppHandle) -> Result<Self, String> {
        let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let resources = app.path().resource_dir().map_err(|e| e.to_string())?;
        let debug = cfg!(debug_assertions);
        let runtime = if debug {
            manifest.join("resources/runtime")
        } else {
            resources.join("resources/runtime")
        };
        let helper = if debug {
            manifest.join("../remote-helper/host.mjs")
        } else {
            resources.join("_up_/remote-helper/host.mjs")
        };
        let bundled_node = runtime.join(if cfg!(windows) { "node.exe" } else { "node" });
        let node = if bundled_node.is_file() {
            bundled_node
        } else if debug {
            PathBuf::from(std::env::var("ISLET_NODE").unwrap_or_else(|_| "node".into()))
        } else {
            return Err(
                "The bundled Node runtime is missing. Rebuild with npm run runtime:setup.".into(),
            );
        };
        let modules = if runtime.join("node_modules").is_dir() {
            runtime.join("node_modules")
        } else {
            manifest.join("../node_modules")
        };
        let mut child = Command::new(node)
            .arg(helper)
            .env(
                "ISLET_CLI_SCRIPT",
                if debug {
                    manifest.join("../scripts/islet.mjs")
                } else {
                    resources.join("_up_/scripts/islet.mjs")
                },
            )
            .env("ISLET_RUNTIME_DIR", modules)
            .env(
                "ISLET_REMOTE_PACKAGE_DIR",
                if debug {
                    manifest.join("resources/remote")
                } else {
                    resources.join("resources/remote")
                },
            )
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .map_err(|e| format!("Could not start the Islet file host: {e}"))?;
        let input = child.stdin.take().ok_or("Host input unavailable")?;
        let stdout = child.stdout.take().ok_or("Host output unavailable")?;
        let pending: Arc<Mutex<HashMap<u64, oneshot::Sender<Reply>>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let reader_pending = pending.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                let Ok(line) = line else { break };
                let Ok(message) = serde_json::from_str::<Value>(&line) else {
                    continue;
                };
                if let Some(event) = message.get("event").and_then(Value::as_str) {
                    let payload = message.get("payload").cloned().unwrap_or(Value::Null);
                    let _ = app.emit(event, payload);
                } else if let Some(id) = message.get("id").and_then(Value::as_u64) {
                    if let Some(waiter) = reader_pending.lock().unwrap().remove(&id) {
                        let result = if let Some(error) = message.get("error") {
                            Err(error.to_string())
                        } else {
                            Ok(message.get("result").cloned().unwrap_or(Value::Null))
                        };
                        let _ = waiter.send(result);
                    }
                }
            }
            for (_, waiter) in reader_pending.lock().unwrap().drain() {
                let _=waiter.send(Err("{\"code\":\"HOST_DISCONNECTED\",\"message\":\"Islet's file host stopped. Recovery buffers remain on disk.\"}".into()));
            }
        });
        Ok(Self {
            input: Mutex::new(input),
            child: Mutex::new(child),
            pending,
            next: AtomicU64::new(1),
            initial_args: std::env::args().skip(1).collect(),
        })
    }
    async fn request(&self, operation: String, payload: Value) -> Reply {
        let id = self.next.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = oneshot::channel();
        self.pending.lock().unwrap().insert(id, tx);
        let line = json!({"id":id,"operation":operation,"payload":payload}).to_string() + "\n";
        let written = {
            let mut input = self.input.lock().unwrap();
            input.write_all(line.as_bytes()).and_then(|_| input.flush())
        };
        if let Err(e) = written {
            self.pending.lock().unwrap().remove(&id);
            return Err(e.to_string());
        }
        match tokio::time::timeout(Duration::from_secs(190), rx).await {
            Ok(Ok(value)) => value,
            Ok(Err(e)) => Err(e.to_string()),
            Err(_) => {
                self.pending.lock().unwrap().remove(&id);
                Err(
                    "{\"code\":\"HOST_TIMEOUT\",\"message\":\"The host operation timed out.\"}"
                        .into(),
                )
            }
        }
    }
}

#[tauri::command]
async fn host_request(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, HostState>,
    operation: String,
    payload: Option<Value>,
) -> Reply {
    let mut p = payload.unwrap_or_else(|| json!({}));
    if let Some(object) = p.as_object_mut() {
        object
            .entry("clientId")
            .or_insert_with(|| json!(window.label()));
    }
    if operation.starts_with("desktop.") {
        return tauri::async_runtime::spawn_blocking(move || desktop::handle(&operation, &p))
            .await
            .map_err(|e| e.to_string())?;
    }
    if operation == "dialog.open" || operation == "dialog.save" {
        let op = operation.clone();
        return tauri::async_runtime::spawn_blocking(move || {
            let mut dialog = rfd::FileDialog::new()
                .set_title(p.get("title").and_then(Value::as_str).unwrap_or("Islet"));
            if let Some(directory) = p.get("defaultPath").and_then(Value::as_str) {
                dialog = dialog.set_directory(directory);
            }
            if op == "dialog.save" {
                if let Some(name) = p.get("defaultName").and_then(Value::as_str) {
                    dialog = dialog.set_file_name(name);
                }
                return Ok(dialog
                    .save_file()
                    .map(|p| json!(p.to_string_lossy()))
                    .unwrap_or(Value::Null));
            }
            let directory = p.get("directory").and_then(Value::as_bool).unwrap_or(false);
            let multiple = p.get("multiple").and_then(Value::as_bool).unwrap_or(false);
            if multiple {
                let result = if directory {
                    dialog.pick_folders()
                } else {
                    dialog.pick_files()
                };
                Ok(result
                    .map(|files| {
                        json!(files
                            .iter()
                            .map(|p| p.to_string_lossy().to_string())
                            .collect::<Vec<_>>())
                    })
                    .unwrap_or(Value::Null))
            } else {
                let result = if directory {
                    dialog.pick_folder()
                } else {
                    dialog.pick_file()
                };
                Ok(result
                    .map(|p| json!(p.to_string_lossy()))
                    .unwrap_or(Value::Null))
            }
        })
        .await
        .map_err(|e| e.to_string())?;
    }
    if operation == "app.windowId" {
        return Ok(json!(window.label()));
    }
    if operation == "app.initialArgs" {
        return Ok(json!(state.initial_args));
    }
    if operation == "app.openExternal" {
        let url = p
            .get("url")
            .and_then(Value::as_str)
            .ok_or("A URL is required")?;
        if !(url.starts_with("https://")
            || url.starts_with("http://")
            || url.starts_with("mailto:"))
        {
            return Err("External URL scheme is blocked.".into());
        }
        let command = if cfg!(target_os = "macos") {
            "open"
        } else if cfg!(target_os = "windows") {
            "explorer"
        } else {
            "xdg-open"
        };
        Command::new(command)
            .arg(url)
            .spawn()
            .map_err(|e| e.to_string())?;
        return Ok(json!(true));
    }
    if operation == "app.newWindow" {
        let label = format!(
            "workspace-{:x}-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map_err(|e| e.to_string())?
                .as_nanos(),
            state.next.fetch_add(1, Ordering::Relaxed)
        );
        tauri::WebviewWindowBuilder::new(&app, &label, tauri::WebviewUrl::App("index.html".into()))
            .title("Islet")
            .inner_size(1280.0, 820.0)
            .min_inner_size(700.0, 450.0)
            .build()
            .map_err(|e| e.to_string())?;
        state
            .request("app.reserveWindow".into(), json!({"windowId":label}))
            .await?;
        return Ok(json!({"windowId":label}));
    }
    state.request(operation, p).await
}

pub fn run() {
    tauri::Builder::default()
        .on_window_event(|window, event| {
            let operation = match event {
                tauri::WindowEvent::Destroyed => {
                    Some(("app.unregisterWindow", json!({"windowId":window.label()})))
                }
                tauri::WindowEvent::Focused(focused) => Some((
                    "app.focusWindow",
                    json!({"windowId":window.label(),"focused":focused}),
                )),
                _ => None,
            };
            if let Some((operation, payload)) = operation {
                let handle = window.app_handle().clone();
                tauri::async_runtime::spawn(async move {
                    if let Some(state) = handle.try_state::<HostState>() {
                        let _ = state.request(operation.into(), payload).await;
                    }
                });
            }
        })
        .on_page_load(|_webview, _payload| {
            #[cfg(debug_assertions)]
            if _payload.event() == tauri::webview::PageLoadEvent::Finished {
                if let Ok(file) = std::env::var("ISLET_NATIVE_TEST_SCRIPT") {
                    if let Ok(script) = std::fs::read_to_string(file) {
                        let _ = _webview.eval(script);
                    }
                }
            }
        })
        .setup(|app| {
            let state = HostState::start(app.handle().clone()).map_err(std::io::Error::other)?;
            app.manage(state);
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    tokio::time::sleep(Duration::from_secs(30)).await;
                    let _ = handle
                        .state::<HostState>()
                        .request("ping".into(), json!({}))
                        .await;
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![host_request])
        .build(tauri::generate_context!())
        .expect("Could not initialize Islet")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                if let Some(state) = app.try_state::<HostState>() {
                    let _ = state
                        .input
                        .lock()
                        .unwrap()
                        .write_all(b"{\"id\":0,\"operation\":\"app.close\",\"payload\":{}}\n");
                    let mut child = state.child.lock().unwrap();
                    for _ in 0..30 {
                        if child.try_wait().ok().flatten().is_some() {
                            break;
                        }
                        std::thread::sleep(Duration::from_millis(100));
                    }
                    let _ = child.kill();
                }
            }
        });
}
