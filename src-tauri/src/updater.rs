use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, BTreeSet},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

const FEED: &str = "https://github.com/saadqc/Islet/releases/download/updater/latest.json";
const RELEASES: &str = "https://github.com/saadqc/Islet/releases";
const MAX_DOWNLOAD: u64 = 1024 * 1024 * 1024;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Preferences {
    pub auto_check: bool,
    pub auto_download: bool,
}
impl Default for Preferences {
    fn default() -> Self {
        Self {
            auto_check: true,
            auto_download: true,
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    phase: String,
    current_version: String,
    version: Option<String>,
    notes: Option<String>,
    downloaded: u64,
    total: Option<u64>,
    error: Option<String>,
    last_checked: Option<u64>,
    supported: bool,
    preferences: Preferences,
    releases_url: &'static str,
}

#[derive(Default)]
struct Barrier {
    id: u64,
    replies: BTreeMap<String, Option<bool>>,
    failed: bool,
}
impl Barrier {
    fn acknowledge(&mut self, id: u64, window: &str, clean: bool) -> Result<(), String> {
        if self.id != id || id == 0 {
            return Err("The restart request has expired.".into());
        }
        let reply = self
            .replies
            .get_mut(window)
            .ok_or("This window was not asked to restart.")?;
        if reply.is_none() {
            *reply = Some(clean);
            self.failed |= !clean;
        }
        Ok(())
    }
    fn complete(&self, windows: &BTreeSet<String>) -> Result<bool, String> {
        if self.failed {
            return Err("Save changes and resolve pending file operations in every workspace before updating.".into());
        }
        if self.replies.keys().cloned().collect::<BTreeSet<_>>() != *windows {
            return Err("The open workspaces changed. Try Restart and Update again.".into());
        }
        Ok(self.replies.values().all(|reply| *reply == Some(true)))
    }
}

struct Inner {
    snapshot: Snapshot,
    available: Option<Update>,
    bytes: Option<Arc<Vec<u8>>>,
    barrier: Barrier,
}
pub struct Service {
    inner: Mutex<Inner>,
    busy: AtomicBool,
    preparing: AtomicBool,
    sequence: AtomicU64,
    preferences_path: Option<PathBuf>,
}
struct Busy<'a>(&'a AtomicBool);
impl Drop for Busy<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

impl Service {
    pub fn new(app: &tauri::AppHandle) -> Self {
        let preferences_path = app
            .path()
            .app_config_dir()
            .ok()
            .map(|directory| directory.join("updates.json"));
        let preferences = preferences_path
            .as_ref()
            .and_then(|path| std::fs::read(path).ok())
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default();
        let supported =
            cfg!(all(target_os = "macos", target_arch = "aarch64")) && !cfg!(debug_assertions);
        Self {
            inner: Mutex::new(Inner {
                snapshot: Snapshot {
                    phase: if supported { "idle" } else { "unsupported" }.into(),
                    current_version: app.package_info().version.to_string(),
                    version: None,
                    notes: None,
                    downloaded: 0,
                    total: None,
                    error: None,
                    last_checked: None,
                    supported,
                    preferences,
                    releases_url: RELEASES,
                },
                available: None,
                bytes: None,
                barrier: Barrier::default(),
            }),
            busy: AtomicBool::new(false),
            preparing: AtomicBool::new(false),
            sequence: AtomicU64::new(1),
            preferences_path,
        }
    }
    fn snapshot(&self) -> Snapshot {
        self.inner.lock().unwrap().snapshot.clone()
    }
    fn emit(&self, app: &tauri::AppHandle) {
        let _ = app.emit("updater-status", self.snapshot());
    }
    fn change(&self, app: &tauri::AppHandle, change: impl FnOnce(&mut Inner)) {
        change(&mut self.inner.lock().unwrap());
        self.emit(app);
    }
    fn acquire(&self) -> Result<Busy<'_>, String> {
        self.busy
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| "An update operation is already in progress.")?;
        Ok(Busy(&self.busy))
    }
    pub fn preparing(&self) -> bool {
        self.preparing.load(Ordering::Acquire)
    }
    fn fail(&self, app: &tauri::AppHandle, error: String) {
        self.change(app, |inner| {
            inner.snapshot.phase = if inner.bytes.is_some() {
                "ready"
            } else {
                "error"
            }
            .into();
            inner.snapshot.error = Some(error);
        });
    }
    async fn check(&self, app: &tauri::AppHandle) -> Result<(), String> {
        let _guard = self.acquire()?;
        if !self.snapshot().supported {
            return Err("Updates are available in the packaged Apple silicon app.".into());
        }
        if self.inner.lock().unwrap().bytes.is_some() {
            return Ok(());
        }
        self.change(app, |inner| {
            inner.snapshot.phase = "checking".into();
            inner.snapshot.error = None;
        });
        let result: Result<(), String> = async {
            let updater = app
                .updater_builder()
                .endpoints(vec![FEED.parse().unwrap()])
                .map_err(|e| e.to_string())?
                .timeout(Duration::from_secs(30))
                .configure_client(|builder| {
                    builder.redirect(reqwest::redirect::Policy::custom(|attempt| {
                        if attempt.previous().len() >= 5 || !trusted_transport(attempt.url()) {
                            attempt.error("Update redirect is outside the release service")
                        } else {
                            attempt.follow()
                        }
                    }))
                })
                .build()
                .map_err(|e| e.to_string())?;
            let mut update = updater.check().await.map_err(|_| {
                "Could not check for updates. Check your connection and try again.".to_string()
            })?;
            if let Some(value) = update.as_mut() {
                validate_artifact_url(&value.download_url, &value.version)?;
                value.timeout = Some(Duration::from_secs(600));
            }
            self.change(app, |inner| {
                inner.snapshot.last_checked = Some(now());
                inner.snapshot.phase = if update.is_some() {
                    "available"
                } else {
                    "current"
                }
                .into();
                inner.snapshot.version = update.as_ref().map(|u| u.version.clone());
                inner.snapshot.notes = update
                    .as_ref()
                    .and_then(|u| u.body.clone())
                    .map(|s| s.chars().take(20000).collect());
                inner.snapshot.downloaded = 0;
                inner.snapshot.total = None;
                inner.available = update;
            });
            if self.snapshot().preferences.auto_download
                && self.inner.lock().unwrap().available.is_some()
            {
                self.download_inner(app).await?;
            }
            Ok(())
        }
        .await;
        if let Err(error) = &result {
            self.fail(app, error.clone());
        }
        result
    }
    async fn download_inner(&self, app: &tauri::AppHandle) -> Result<(), String> {
        let update = self
            .inner
            .lock()
            .unwrap()
            .available
            .clone()
            .ok_or("Check for updates first.")?;
        self.change(app, |inner| {
            inner.snapshot.phase = "downloading".into();
            inner.snapshot.error = None;
            inner.snapshot.downloaded = 0;
        });
        let cancelled = tokio::sync::Notify::new();
        let mut received = 0;
        let mut last_progress = std::time::Instant::now();
        let download = update.download(
            |length, total| {
                received += length as u64;
                if received > MAX_DOWNLOAD || total.is_some_and(|n| n > MAX_DOWNLOAD) {
                    cancelled.notify_one();
                }
                if last_progress.elapsed() >= Duration::from_millis(200) {
                    self.change(app, |inner| {
                        inner.snapshot.downloaded = received;
                        inner.snapshot.total = total;
                    });
                    last_progress = std::time::Instant::now();
                }
            },
            || self.change(app, |inner| inner.snapshot.phase = "verifying".into()),
        );
        let bytes = tokio::select! {
            result = download => result.map_err(|_| "The update could not be downloaded or its signature/version could not be verified. Retry the download.".to_string())?,
            _ = cancelled.notified() => return Err("The update exceeds the supported download size.".into()),
        };
        if bytes.len() as u64 > MAX_DOWNLOAD {
            return Err("The update exceeds the supported download size.".into());
        }
        self.change(app, |inner| {
            inner.snapshot.downloaded = bytes.len() as u64;
            inner.bytes = Some(Arc::new(bytes));
            inner.snapshot.phase = "ready".into();
        });
        Ok(())
    }
    async fn download(&self, app: &tauri::AppHandle) -> Result<(), String> {
        let _guard = self.acquire()?;
        if self.inner.lock().unwrap().bytes.is_some() {
            return Ok(());
        }
        let result = self.download_inner(app).await;
        if let Err(error) = &result {
            self.fail(app, error.clone());
        }
        result
    }
    async fn install(&self, app: &tauri::AppHandle) -> Result<(), String> {
        let _guard = self.acquire()?;
        let (update, bytes) = {
            let inner = self.inner.lock().unwrap();
            (
                inner.available.clone().ok_or("No update is available.")?,
                inner
                    .bytes
                    .clone()
                    .ok_or("Download and verify the update first.")?,
            )
        };
        writable_install()?;
        let id = self.sequence.fetch_add(1, Ordering::Relaxed);
        self.preparing.store(true, Ordering::Release);
        self.change(app, |inner| {
            inner.barrier = Barrier {
                id,
                replies: windows(app)
                    .into_iter()
                    .map(|label| (label, None))
                    .collect(),
                failed: false,
            };
            inner.snapshot.phase = "preparing".into();
            inner.snapshot.error = None;
        });
        let result: Result<(), String> = async {
            app.emit("updater-prepare", json!({"requestId":id})).map_err(|e| e.to_string())?;
            tokio::time::timeout(Duration::from_secs(15), async {
                loop {
                    if self.inner.lock().unwrap().barrier.complete(&windows(app))? { return Ok::<_, String>(()); }
                    tokio::time::sleep(Duration::from_millis(40)).await;
                }
            }).await.map_err(|_| "A workspace did not respond. Close any unresponsive windows and try again.".to_string())??;
            self.change(app, |inner| inner.snapshot.phase = "installing".into());
            tauri::async_runtime::spawn_blocking(move || update.install(bytes.as_ref()))
                .await.map_err(|e| e.to_string())?
                .map_err(|_| "The update could not be installed. Your current app is retained where possible; download the DMG from Releases if this persists.".to_string())?;
            app.restart();
            #[allow(unreachable_code)] Ok(())
        }.await;
        self.preparing.store(false, Ordering::Release);
        self.inner.lock().unwrap().barrier = Barrier::default();
        let _ = app.emit("updater-abort", json!({"requestId":id}));
        if let Err(error) = &result {
            self.fail(app, error.clone());
        }
        result
    }
    fn configure(&self, app: &tauri::AppHandle, preferences: Preferences) -> Result<(), String> {
        let preferences_path = self
            .preferences_path
            .as_ref()
            .ok_or("Settings directory is unavailable.")?;
        let parent = preferences_path
            .parent()
            .ok_or("Settings directory is unavailable.")?;
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        let mut file = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
        serde_json::to_writer(&mut file, &preferences).map_err(|e| e.to_string())?;
        file.as_file().sync_all().map_err(|e| e.to_string())?;
        file.persist(preferences_path).map_err(|e| e.to_string())?;
        self.change(app, |inner| inner.snapshot.preferences = preferences);
        Ok(())
    }
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
fn windows(app: &tauri::AppHandle) -> BTreeSet<String> {
    app.webview_windows().into_keys().collect()
}
fn trusted_transport(url: &tauri::Url) -> bool {
    url.scheme() == "https"
        && url.username().is_empty()
        && url.password().is_none()
        && url.port_or_known_default() == Some(443)
        && matches!(
            url.host_str(),
            Some(
                "github.com"
                    | "release-assets.githubusercontent.com"
                    | "objects.githubusercontent.com"
            )
        )
}
fn validate_artifact_url(url: &tauri::Url, version: &str) -> Result<(), String> {
    if !trusted_transport(url)
        || url.host_str() != Some("github.com")
        || url.query().is_some()
        || url.fragment().is_some()
        || !url
            .path()
            .starts_with(&format!("/saadqc/Islet/releases/download/v{version}/"))
        || !url.path().ends_with(".app.tar.gz")
    {
        return Err("The update does not point to an Islet release package.".into());
    }
    Ok(())
}
fn install_root(executable: &Path) -> Result<PathBuf, String> {
    let bundle = executable
        .parent()
        .and_then(Path::parent)
        .and_then(Path::parent)
        .ok_or("The installed application could not be found.")?;
    if bundle.extension().is_none_or(|ext| ext != "app")
        || bundle.starts_with("/Volumes")
        || executable.to_string_lossy().contains("/AppTranslocation/")
    {
        return Err("Move Islet to Applications and reopen it before updating. You can also download the latest DMG from Releases.".into());
    }
    Ok(bundle.to_path_buf())
}
fn writable_install() -> Result<(), String> {
    let bundle = install_root(&std::env::current_exe().map_err(|e| e.to_string())?)?;
    let parent = bundle
        .parent()
        .ok_or("Application directory is unavailable.")?;
    tempfile::Builder::new().prefix(".islet-update-check-").tempfile_in(parent)
        .map_err(|_| "Islet cannot update this application folder. Move it to a writable Applications folder or install the latest DMG.".to_string())?;
    Ok(())
}

pub fn start(app: &tauri::AppHandle) {
    let service = Arc::new(Service::new(app));
    app.manage(service.clone());
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(15)).await;
        loop {
            let state = service.snapshot();
            if state.supported && state.preferences.auto_check {
                let _ = service.check(&app).await;
            }
            tokio::time::sleep(Duration::from_secs(6 * 60 * 60)).await;
        }
    });
}

pub async fn handle(
    app: &tauri::AppHandle,
    window: &str,
    operation: &str,
    payload: Value,
) -> Result<Value, String> {
    let service = app.state::<Arc<Service>>().inner().clone();
    match operation {
        "updater.status" => {}
        "updater.check" => service.check(app).await?,
        "updater.download" => service.download(app).await?,
        "updater.install" => service.install(app).await?,
        "updater.configure" => service.configure(
            app,
            serde_json::from_value(payload).map_err(|_| "Invalid update preferences.")?,
        )?,
        "updater.acknowledge" => {
            service.inner.lock().unwrap().barrier.acknowledge(
                payload["requestId"]
                    .as_u64()
                    .ok_or("Missing restart request.")?,
                window,
                payload["clean"].as_bool().unwrap_or(false),
            )?;
        }
        _ => return Err("Unknown update operation.".into()),
    }
    Ok(serde_json::to_value(service.snapshot()).unwrap())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    #[ignore = "Requires a final signed updater archive and isolated app rehearsal inputs"]
    async fn actual_signed_archive_download_install_and_relaunch() {
        use std::io::{Read, Write};
        use std::net::TcpListener;
        use std::process::{Command, Stdio};
        let archive_path =
            PathBuf::from(std::env::var("ISLET_UPDATE_TEST_ARCHIVE").expect("archive path"));
        let signature_path =
            PathBuf::from(std::env::var("ISLET_UPDATE_TEST_SIGNATURE").expect("signature path"));
        let source =
            PathBuf::from(std::env::var("ISLET_UPDATE_TEST_APP").expect("source app path"));
        let bytes = std::fs::read(archive_path).unwrap();
        let signature = std::fs::read_to_string(signature_path).unwrap();
        let config: Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let version = config["version"].as_str().unwrap().to_string();
        let directory = tempfile::tempdir().unwrap();
        let installed = directory.path().join("Islet.app");
        assert!(Command::new("/bin/cp")
            .args(["-R"])
            .arg(&source)
            .arg(&installed)
            .status()
            .unwrap()
            .success());
        let marker = installed.join("Contents/Resources/update-test-old-version");
        std::fs::write(&marker, b"old app remains until verified replacement").unwrap();
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let address = listener.local_addr().unwrap();
        let manifest = json!({"version":version,"platforms":{"darwin-aarch64":{"url":format!("http://{address}/payload"),"signature":signature.trim()}}});
        let response_manifest = manifest.to_string().into_bytes();
        let server = std::thread::spawn(move || {
            let deadline = std::time::Instant::now() + Duration::from_secs(90);
            let mut served = 0;
            while served < 2 && std::time::Instant::now() < deadline {
                let Ok((mut stream, _)) = listener.accept() else {
                    std::thread::sleep(Duration::from_millis(10));
                    continue;
                };
                stream
                    .set_read_timeout(Some(Duration::from_secs(5)))
                    .unwrap();
                stream
                    .set_write_timeout(Some(Duration::from_secs(30)))
                    .unwrap();
                let mut headers = Vec::new();
                let mut byte = [0];
                while headers.len() < 8192 && !headers.ends_with(b"\r\n\r\n") {
                    if stream.read(&mut byte).unwrap_or(0) == 0 {
                        break;
                    }
                    headers.push(byte[0]);
                }
                let payload = if headers.starts_with(b"GET /update ") {
                    &response_manifest
                } else {
                    &bytes
                };
                write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", payload.len()).unwrap();
                stream.write_all(payload).unwrap();
                served += 1;
            }
            assert_eq!(served, 2);
        });
        let mut context = tauri::test::mock_context(tauri::test::noop_assets());
        context.config_mut().plugins.0.insert(
            "updater".into(),
            json!({
                "pubkey":config["plugins"]["updater"]["pubkey"], "requireSignedVersion":true,
                "dangerousInsecureTransportProtocol":true
            }),
        );
        let app = tauri::test::mock_builder()
            .plugin(tauri_plugin_updater::Builder::new().build())
            .build(context)
            .unwrap();
        let updater = app
            .updater_builder()
            .target("darwin-aarch64")
            .executable_path(installed.join("Contents/MacOS/islet"))
            .endpoints(vec![format!("http://{address}/update").parse().unwrap()])
            .unwrap()
            .timeout(Duration::from_secs(90))
            .build()
            .unwrap();
        let update = updater.check().await.unwrap().unwrap();
        assert_eq!(update.version, version);
        let downloaded = update.download(|_, _| {}, || {}).await.unwrap();
        server.join().unwrap();
        let mut corrupted = downloaded.clone();
        corrupted[0] ^= 1;
        assert!(update.install(&corrupted).is_err());
        assert!(
            marker.exists(),
            "Invalid signatures must preserve the old app"
        );
        drop(corrupted);
        let mut inflated = manifest;
        inflated["version"] = json!("99.0.0");
        assert!(updater
            .restore_update(inflated)
            .unwrap()
            .unwrap()
            .verify(&downloaded)
            .is_err());
        update.install(&downloaded).unwrap();
        assert!(
            !marker.exists(),
            "The real Tauri installer replaced the isolated app"
        );
        assert!(Command::new("/usr/bin/codesign")
            .args(["--verify", "--deep", "--strict"])
            .arg(&installed)
            .status()
            .unwrap()
            .success());
        struct ChildGuard(std::process::Child);
        impl Drop for ChildGuard {
            fn drop(&mut self) {
                let _ = self.0.kill();
                let _ = self.0.wait();
            }
        }
        let data = directory.path().join("data");
        std::fs::create_dir_all(&data).unwrap();
        let mut child = ChildGuard(
            Command::new(installed.join("Contents/MacOS/islet"))
                .env("ISLET_DATA_DIR", &data)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .unwrap(),
        );
        let resources = installed.join("Contents/Resources");
        let mut ready = false;
        for _ in 0..100 {
            assert!(
                child.0.try_wait().unwrap().is_none(),
                "Updated app exited before handshake"
            );
            let output = Command::new(resources.join("resources/runtime/node"))
                .arg(resources.join("_up_/scripts/islet.mjs"))
                .args(["windows", "--json"])
                .env("ISLET_DATA_DIR", &data)
                .output()
                .unwrap();
            if output.status.success()
                && serde_json::from_slice::<Value>(&output.stdout)
                    .ok()
                    .is_some_and(|value| {
                        value.as_array().is_some_and(|windows| !windows.is_empty())
                    })
            {
                ready = true;
                break;
            }
            tokio::time::sleep(Duration::from_millis(200)).await;
        }
        assert!(
            ready,
            "Updated app must relaunch and register its native window"
        );
        drop(child);
    }
    // Public test vectors from tauri-plugin-updater 2.14 (MIT / Apache-2.0).
    const PUBLIC_KEY: &str = "untrusted comment: minisign public key: A49EF4746FA6E6D7\nRWTX5qZvdPSepDGWg2bz8n6ArQnBMwgQK1geVosorcbLzcunD+KJ+cYe";
    const SIGNATURE: &str = "untrusted comment: signature from tauri secret key\nRUTX5qZvdPSepPF2zsjvP/L/TQtBLRnWRvaq+4omK1UEugtQp/USrGiI1v762sDy3id3aor7bRC9ETyeot6lMHHrWoZ5hjUM1Qc=\ntrusted comment: timestamp:1791649051\tfile:payload\tversion:2.0.0\nDDq2CLOEl5cQmC2eJRHlnZPVViOZsu1CjpPKQoei4A/XBfkDqGO0B+QMrcrHgEQ5qV3mne75tdFWhJpqUXh9AA==";

    #[test]
    fn tauri_rejects_tampering_wrong_versions_and_stale_updates() {
        use base64::{engine::general_purpose::STANDARD, Engine};
        let mut context = tauri::test::mock_context(tauri::test::noop_assets());
        context.config_mut().plugins.0.insert(
            "updater".into(),
            json!({"pubkey":STANDARD.encode(PUBLIC_KEY),"requireSignedVersion":true}),
        );
        let app = tauri::test::mock_builder()
            .plugin(tauri_plugin_updater::Builder::new().build())
            .build(context)
            .unwrap();
        let updater = app
            .updater_builder()
            .target("test-target")
            .executable_path("test-app")
            .endpoints(vec!["https://example.invalid/update".parse().unwrap()])
            .unwrap()
            .build()
            .unwrap();
        let manifest = json!({"version":"2.0.0","platforms":{"test-target":{"url":"https://example.invalid/Islet.app.tar.gz","signature":STANDARD.encode(SIGNATURE)}}});
        let update = updater.restore_update(manifest.clone()).unwrap().unwrap();
        update.verify(b"test").unwrap();
        assert!(update.verify(b"tampered").is_err());
        assert!(update.install(b"tampered").is_err());
        let mut inflated = manifest.clone();
        inflated["version"] = json!("3.0.0");
        assert!(updater
            .restore_update(inflated)
            .unwrap()
            .unwrap()
            .verify(b"test")
            .is_err());
        let mut stale = manifest.clone();
        stale["version"] = json!("0.0.1");
        assert!(updater.restore_update(stale).unwrap().is_none());
        let mut invalid = manifest;
        invalid["platforms"]["test-target"]["signature"] = json!("invalid");
        assert!(updater
            .restore_update(invalid)
            .unwrap()
            .unwrap()
            .verify(b"test")
            .is_err());
    }
    #[test]
    fn release_downloads_are_bound_to_repository_version_and_https() {
        let valid = "https://github.com/saadqc/Islet/releases/download/v0.2.0/Islet.app.tar.gz";
        assert!(validate_artifact_url(&valid.parse().unwrap(), "0.2.0").is_ok());
        for url in [
            valid.replace("https:", "http:"),
            valid.replace("saadqc/Islet", "other/Islet"),
            valid.replace("v0.2.0", "v0.1.0"),
            format!("{valid}?redirect=elsewhere"),
            valid.replace("github.com", "github.com.evil.invalid"),
        ] {
            assert!(validate_artifact_url(&url.parse().unwrap(), "0.2.0").is_err());
        }
    }
    #[test]
    fn restart_requires_all_original_windows_clean_and_exact_request() {
        let windows: BTreeSet<String> = BTreeSet::from(["main".into(), "workspace-2".into()]);
        let mut barrier = Barrier {
            id: 3,
            replies: windows.iter().map(|label| (label.clone(), None)).collect(),
            failed: false,
        };
        assert!(barrier.acknowledge(2, "main", true).is_err());
        assert!(barrier.acknowledge(3, "other", true).is_err());
        barrier.acknowledge(3, "main", true).unwrap();
        assert!(!barrier.complete(&windows).unwrap());
        barrier.acknowledge(3, "workspace-2", false).unwrap();
        barrier.acknowledge(3, "workspace-2", true).unwrap();
        assert!(barrier.complete(&windows).is_err());
        barrier.failed = false;
        barrier.replies.insert("workspace-2".into(), Some(true));
        assert!(barrier.complete(&windows).unwrap());
        assert!(barrier.complete(&BTreeSet::from(["main".into()])).is_err());
    }
    #[test]
    fn only_one_update_operation_can_own_the_service() {
        let busy = AtomicBool::new(false);
        assert!(busy
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_ok());
        let guard = Busy(&busy);
        assert!(busy
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_err());
        drop(guard);
        assert!(busy
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_ok());
    }
    #[test]
    fn read_only_and_translocated_apps_cannot_be_replaced() {
        assert!(install_root(Path::new("/Applications/Islet.app/Contents/MacOS/islet")).is_ok());
        for value in [
            "/Volumes/Islet/Islet.app/Contents/MacOS/islet",
            "/private/tmp/AppTranslocation/random/Islet.app/Contents/MacOS/islet",
            "/tmp/islet",
        ] {
            assert!(install_root(Path::new(value)).is_err());
        }
    }
}
