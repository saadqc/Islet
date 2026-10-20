# Implementation and validation record

20 October 2026. This record concerns the functional preview in this directory. It does not certify the entire initial-release acceptance matrix or substitute synthetic events for physical input tests.

## Architecture delivered

- Tauri 2 macOS host with a bundled Node file/service supervisor; production has no HTTP listener. The authenticated development HTTP bridge is loopback-only and separately launched.
- React/TypeScript shell, CodeMirror 6, bundled Inter and JetBrains Mono, exact documented Islands theme tokens.
- Host-qualified document registry, revision-checked atomic saves preserving BOM/newline/permissions, external-change conflicts, local recovery and transaction journals.
- Real basedpyright and TypeScript language services, isolated by host/root/environment/client, with completion, hover/signatures, diagnostics, semantic tokens, definitions, references, symbols and rename.
- Search runs on the owning host, streams progress, overlays unsaved documents, and uses a cancellable worker for regex matching. Replacement previews share one implementation of matching/capture semantics with the document transaction layer.
- SSH helper channels honor OpenSSH configuration, key agents, authentication/host-key prompts, lease heartbeats, reconnect generations and uncertain-save reconciliation. Setup archives contain verified Linux Node runtimes for x64 and arm64.
- CLI parser, authenticated per-process delivery, explicit window targeting, workspace manifests and independent per-window recovery records. Canonical manifest identity indexes snapshots without sharing a write key; a recovery chooser keeps prior unnamed/secondary sessions accessible.

## Automated evidence

The local evidence files listed below are generated and excluded from source control. GitHub Actions exposes its current run results; local machine logs and raw diagnostic files are not published.

Final frozen-source suites: **24 core/real-language tests, 18 backend tests, and 13 browser workflows passed**, with no skipped core/backend checks or browser runtime errors. Browser workflows also verify source fixture files remain unchanged.

| Check | Evidence |
| --- | --- |
| TypeScript and production frontend build | `design/validation/build.log` |
| Core safety and real language integration | `design/validation/core-language-tests.txt` |
| Filesystem, filters, cancellation, SSH ownership and backend services | `design/validation/backend-tests.log` |
| Actual browser workflows, no network image fetch before opt-in, no fixture disk changes | `design/validation/ui-regression-tests.txt` |
| Actual isolated OpenSSH loopback transport and interrupted-save acknowledgement | `design/validation/ssh-test-report.json` |
| Debug native WKWebView, fonts, Unicode/RTL/combining edits, undo/redo, persisted save, scroll, Find folder field | `design/validation/native-test-report.json` |
| Packaged native build/launch and CLI | `design/validation/package-test-report.json`, `package-manifest.json`, and `package-signing.log` |

Core tests cover UTF-16 positions, host identity, exact history snapshots, bookmark relocation, stale asynchronous previews, coherent grouped undo, read-only/resource-operation rejection, regex captures and zero-width Unicode, unsaved overlays, native structured errors, uncertain-save reconciliation, real venv import discovery, and independent clients sharing a root.

Browser checks use their own window/session and disposable fixtures. The editor tests use actual basedpyright 1.40.2, typescript-language-server 5.3.0, and TypeScript 5.9.3. Runtime and dependency versions are recorded inside the packaged runtime.

The loopback SSH host is macOS arm64 and uses an existing compatible helper. It validates actual SSH transport, path quoting, same-path host separation, remote services, atomic saves, mixed search, disconnection and interrupted acknowledgement. It does **not** prove first-use Linux helper bootstrap. That bootstrap remains unverified; no production SSH host was used to fill the gap.

Native smoke executes in real WKWebView through a debug-only test hook and IPC, including an exact Unicode save/reread. It uses synthetic editor transactions and DOM controls. Physical IME/dead-key composition, trackpad momentum, wheel/scrollbar behavior and OS-captured shortcuts still require human validation. Debug hooks are excluded from release builds.

## Visual evidence

`design/validation/islet-dark.png`, `islet-light.png`, `islet-find.png`, `islet-markdown.png`, and `ui-regression.png` are actual rendered UI captures, distinct from `design/mockups/`. The app uses the approved color tokens. Browser captures cannot certify native text rasterization or one-pixel matching against PyCharm. Published visual evidence is limited to browser-rendered captures.

## Release gates still requiring separate qualification

- First-use helper bootstrap on Linux x64/arm64, plus host-key/password/ProxyJump edge-case testing against disposable Linux machines.
- Physical macOS input methods, dead keys, trackpad and accessibility verification; visual comparison to PyCharm at 100/125/150% scales and full popup states.
- Full cold/warm latency, keystroke p95, process memory and scrolling performance measurements on a fixed corpus. No provisional budget is claimed as measured.
- The installed-footprint target was 150 MB. The built application bundle measures **270.38 MiB logical content (283,509,565 bytes), or 286.04 MiB allocated on disk**, including both Linux archives, so that target is not met. The final package report/provenance records the exact final bytes. Language services/runtime packaging needs profiling before a size-qualified release.
- Windows/Linux desktop packaging, code signing and notarization have not been qualified.

These limits remain visible even when automated suites pass. The implementation is reviewable and usable as a preview; distribution qualification remains separate.
