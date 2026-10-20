# Islet native host

`src-tauri/src/lib.rs` owns one Node host process. The webview calls the typed `host_request` command; the host has no generic shell-execution operation. Requests and replies use newline-delimited UTF-8 JSON, capped at 64 MB. LSP subprocess traffic uses standard byte-counted Content-Length frames. Native events carry `lsp-message` or `host-event` payloads.

## Files and persistence

Local and SSH document identity is `(hostId, canonical absolute path)`. `root.open` attaches directories; `fs.list` and search remain within attached roots. `fs.list` with `browse: true` permits read-only folder selection before attachment. Dependency reads are allowed for definitions but are marked read-only outside attached roots. Saves require explicit expected SHA-256 raw-byte revisions, retain UTF-8 BOM/newline style and permissions, write+fsync a temporary sibling, recheck the disk revision and replace atomically. Unsupported encodings and binary files are rejected without modification. A concurrent external write cannot be made globally atomic with an ordinary filesystem rename.

App-data state uses mode-0600 JSON snapshots under mode-0700 directories. Session, recovery, settings and transaction journals remain separate from source repositories. Workspace manifests contain versioned roots and preferences, remove credential fields, and resolve relative local paths against the manifest directory. Their canonical manifest identity is returned separately. A serial recovery-session index records immutable per-window keys, workspace identity, names and dirty counts; opening the same named workspace in another window never shares its recovery key.

## Search

The same ECMAScript Unicode matcher runs locally and remotely. Offset ranges use UTF-16 code units, matching CodeMirror/LSP. Each search owns a worker thread so cancel and unrelated file/language operations remain responsive during pathological regular expressions. A 1.5-second per-file matcher limit is disclosed as a failed root. Limits are 5 MB/file, 10,000 results and bounded result payloads. Snippets are bounded and source text is not copied into every result. Dirty buffers replace disk results, with the same folder, mask, ancestor-ignore, hidden and ignored filters. Both per-root states and overall completeness are returned; failures are never represented as a complete empty search.

## Language services

Services are keyed by root, language, Python interpreter and window client. This prevents independent webviews from mixing JSON-RPC IDs and unsaved text. Sessions cap at eight; a service can be evicted after two minutes without messages when that cap is reached. Python `.venv`/`venv` is detected without modifying the environment. The renderer initializes the service and sends configuration, document versions and cancel requests. Remote sessions encode host identity in session IDs and events. Removing roots or closing windows releases their owned services.

## SSH

OpenSSH handles aliases, key agents, IdentityFile, ports and ProxyJump. Agent mode rejects unknown/changed keys. Explicit interactive mode uses a temporary mode-0700 askpass wrapper and authenticated mode-0600 Unix socket; prompts are rendered by the application and responses are never written to workspace files or logs. Each prompt includes the originating host and expires after two minutes.

Remote setup requires an explicit approval. Linux x86_64/arm64 packages contain the same helper, a versioned Node runtime and locked language services. Node downloads are checked against official SHA-256 manifests, and the complete transfer checksum is checked remotely before safe extraction into `~/.cache/islet/0.1.0`. Existing compatible helper folders may be selected instead. No root account, listening remote port or permanent daemon is required. Project paths travel inside JSON, not in shell commands.

Connections have a fresh generation on reconnect. Thirty-second heartbeats maintain a two-minute helper lease. Closing stdin or lease expiry stops owned language processes. Buffers/recovery remain local during disconnection. Lost acknowledgements during a remote save return `SAVE_UNCERTAIN`; callers must reread before retrying. Revision checks catch external changes after reconnection.

## CLI

`scripts/islet.mjs` normalizes and deduplicates ordered local/SSH roots, parses workspace/window options, and reports malformed inputs separately. It talks to per-process authenticated Unix sockets stored in app data with mode-0600 registry files. `add` requires an explicit or unambiguous target; `windows --json` lists exact window IDs. The optional installer writes a launcher only to the chosen directory and refuses to replace an unrelated executable.

## Reproduce verification

```sh
node --test tests/backend/engine.test.mjs
node scripts/remote-test.mjs
node scripts/setup-runtime.mjs
node scripts/setup-runtime.mjs --remote x64
node scripts/setup-runtime.mjs --remote arm64
PATH="$PWD/.tools/cargo/bin:$PATH" CARGO_HOME="$PWD/.tools/cargo" RUSTUP_HOME="$PWD/.tools/rustup" npm run desktop:build
```

`remote-test.mjs` starts and cleans up an isolated OpenSSH server with disposable keys and repositories. It proves actual SSH file/LSP channels, same-path host separation, unsaved search overlay, reconnect revision conflicts and a committed save with a deliberately lost acknowledgement. The current host is macOS; a Linux clean-host bootstrap remains a separate qualification gate. `tests/backend/native-smoke.js` is injected only by debug builds with `ISLET_NATIVE_TEST_SCRIPT`; it exercises a real macOS WKWebView with isolated data. Physical IME/dead keys and trackpad momentum are not established by synthetic events.
