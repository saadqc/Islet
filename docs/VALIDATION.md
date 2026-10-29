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

## Offline spreadsheets, sheet management and creation — 27 October 2026

Implemented CSV/XLS/XLSX editing with locally bundled Jspreadsheet CE, SheetJS CE and Papa Parse; CSV source/grid switching; workbook create/rename/duplicate/delete sheet controls and structural Undo/Redo; scoped file/folder creation; and persisted single/double-click folder expansion. At that milestone DOC/DOCX were deferred; the subsequent DOCX scope is qualified below.

- `npm run build`: TypeScript and production frontend build passed. Vite still reports the existing main bundle size and CE's unused formula-evaluation code; formula evaluation is disabled and the native CSP retains `script-src 'self'` without `unsafe-eval`. The wrapper/build adapter removes CE's inline selection handler.
- `npm test`: **69 passed**, zero failures/skips. New coverage includes ragged/multiline CSV and leading-zero identifiers; XLS/XLSX typed round trips and other sheets; exact undo buffers; exclusive creation; binary recovery/uncertain acknowledgement/conflicts; backup corruption blocking writes; sheet lifecycle/name validation; and formula/named-range/internal-link reference updates.
- Backend suite: **38 passed**, zero failures/skips, using `node --test --test-concurrency=1 tests/backend/engine.test.mjs tests/backend/codespaces.test.mjs tests/backend/host-lifetime.test.mjs`. The lifecycle test intentionally waits 125 seconds. An earlier parallel run missed one filesystem-watch event; its isolated retry and the complete serial rerun passed.
- `npm run test:ui`: all eight browser scripts passed. The spreadsheet script uses the built production assets and strict CSP, blocks external URLs and observed **zero external requests**. It verifies real disk saves, BOM/CRLF, added rows/columns, worksheet switching and lifecycle with Undo/Redo, XLS formula-save blocking/XLSX copy, source/grid switching, both active-cell and committed-edit recovery, external conflicts, nested creation/duplicates and persisted folder click settings. Existing text/language/navigation/settings/update workflows passed too.
- Inspected actual dark/light screenshots at 1440, 1280, 1024 and 768 pixels under `~/islet-ui-screens/offline-spreadsheets-20261027/`. The toolbar wraps at narrow widths; the grid scrolls inside the editor. Screenshots and the native report stay outside the repository.
- `tauri build --debug --no-bundle`: passed with embedded production assets. With the development server stopped and global Node absent from the child PATH, `npm run test:native:spreadsheets` passed in real macOS WKWebView at `tauri://localhost`. The bundled editor and runtime saved all three formats through Tauri IPC; the native create/rename-sheet and new-folder dialogs succeeded; the driver independently read the saved workbook data and sheet names. The debug-only script and driver are in `tests/backend/native-spreadsheets-smoke.js` and `tests/native-spreadsheets.mjs`.
- `npm audit --omit=dev --audit-level=high`: zero vulnerabilities. `git diff --check`: passed.

This qualifies the implemented data editor and native debug path, not lossless Office fidelity or physical keyboard/clipboard/IME behavior. Formula calculation, arbitrary row/column shifts, charts/pivots/macros/advanced formatting, DOC/DOCX and a published application release are outside this qualification. Original workbook bytes are backed up before replacement; legacy XLS formula saves require an XLSX copy. Temporary native data/fixtures are removed by the driver, and the isolated one-hour development processes were stopped.


## Offline DOCX, file operations and icons — 2026-10-27

- Final frontend production build and native debug `.app` bundle passed. The dependency tree pins SuperDoc 1.47.2 and excludes the proprietary `@superdoc/docx-engine`; the runtime audit reports zero vulnerabilities.
- Core suite: **69 passed**. File-icon resolver and asset-integrity tests passed after adding original Excel/Word/CSV dark/light SVGs shared by project rows and tabs.
- Backend: **43 passed**, zero failures/skips, serial run with a 180-second per-test bound (the intentional 125-second lifetime test remains). Five transfer tests cover chunked binary local/remote copying, directories/internal symlinks, collision refusal, cancellation and staging cleanup, traversal/source-mutation rejection, helper-side ZIP generation/cleanup, and DOCX binary backup/conflict protection.
- Real isolated OpenSSH loopback passed, including a 1,200,003-byte binary upload, helper-side ZIP download verified with an independent unzip, and remote-to-local folder copying. No production SSH host was used. This does not qualify first-use Linux bootstrap.
- All **nine browser scripts passed**, including DOCX typing, save/reopen, clean opening without fabricated dirty edits, creation of a valid blank DOCX, legacy DOC error, actual Open File selection outside the existing root, and drag-to-folder copy versus drag-to-editor open. The office scripts use built assets, strict CSP and observed zero external requests. A mocked Codespaces startup fixture was updated for file-versus-folder stat, and malformed transfer-list replies are ignored safely.
- The follow-up centered-page/toolbar-wrap CSS passed the targeted DOCX/file browser flow. Actual screenshots at 1440/1280/768 were inspected under `~/islet-ui-screens/offline-docx-files-20261027/`. The page is centered on gray workspace padding with its original internal margins; at 100% zoom on narrow windows it scrolls horizontally. Toolbar controls wrap rather than being clipped. Excel/Word/CSV icons are visible in tree rows and tabs.
- Native `tauri://localhost` WKWebView checks passed with global Node absent from PATH: actual DOCX DOM editing and guarded disk save, native AppKit file URL clipboard on a private named pasteboard, local file/folder copies using the bundled runtime, and CLI positional-file opening. `ISLET_TEST_OPEN_WITH=1 node tests/native-office-files.mjs` additionally passed an **actual macOS LaunchServices Open With event** against the `.app`. Native CSV/XLS/XLSX save/sheet/create dialogs passed too. Synthetic editing is not physical keyboard/IME certification.
- Native receipts: `~/islet-ui-screens/offline-docx-files-20261027/native-report.json`; logs `/tmp/islet-associations-native-report.log`, `/tmp/islet-office-native-report.log`, `/tmp/islet-files-ui-suite.log`, `/tmp/islet-files-backend.log`, `/tmp/islet-files-ssh.log`, `/tmp/islet-files-native-build.log`. Private job metadata is outside the repository at `~/.agents/jobs/islet-office-files-20261027/`.

Remaining manual checks: physical Finder drag/drop, physically operating the native Save As chooser, cold Finder launch, and broad Word fidelity on the owner's documents. Legacy DOC is unsupported. No installed application, system default association, production remote host, or published release was changed. The general macOS clipboard was not touched by automated tests.

DOCX unsaved edits also passed a real session-persist → page reload → recovered editor → save round trip after the final layout change. A fresh native preview is running with Example.docx active and synthetic sample spreadsheets in `~/Documents/Islet Office Test-jsWRlv/`; it uses isolated app data and a one-hour process expiry. The development HTTP server was stopped.

## Standalone file opening correction — 2026-10-27

Open File no longer attaches a selected file's parent as a workspace root. Explicit file selections gain an exact-file, client-owned local grant; save/reload/recovery remain supported, while directory listing, sibling saves, new sibling files, and remote standalone authorization stay denied. Folder drops still attach folders.

Evidence: 70 core tests passed, including a new real Engine/DocumentStore authorization/save/ownership test; 29 targeted engine/transfer tests passed. The production browser flow selected an outside DOCX, edited/saved it, restored it after a page reload, and checked that its parent/sibling never appeared in the project tree. Native `ISLET_TEST_STANDALONE=1 ISLET_TEST_OPEN_WITH=1 node tests/native-office-files.mjs` passed direct DOCX startup with zero tree rows, binary save, native clipboard/copies and a real LaunchServices file event. Build and diff checks passed. Logs: `/tmp/islet-standalone-{unit,backend,ui,native,native-build}.log`.

A fresh one-hour preview uses `~/Documents/Islet File Open Test-iwhhjg/Example.docx` as its initial file and isolated app data. The prior preview/window was preserved for unsaved work.

## DOCX zoom — 2026-10-27

Built the fixed document view bar and exercised actual page dimensions in the production browser: plus/minus, slider maximum and button bound, 100% reset, keyboard +/−/0, automatic Fit width at 768 and 1280, and zoom retention across tab remounts. Zoom leaves the document clean; the full targeted DOCX save/recovery/standalone opening and file-drop workflow remains green. Actual screenshots `zoom-fit-768.png` and `zoom-fit-1280.png` were inspected under `~/islet-ui-screens/offline-docx-files-20261027/`. Production frontend/native builds and diff checks passed; logs `/tmp/islet-zoom-{ui,build,native-build,native}.log`.

The native zoom smoke also passed actual page-size changes from visible +/- controls and keyboard minus/reset, with a clean document before subsequent editing/save. Standalone opening, clipboard, file copying and LaunchServices file delivery remained green.

## Release 0.1.6 preparation — 2026-10-27

Pinned SuperDoc 1.46.2 for the release to align with its maintained public 1.x source tree, and reran the DOCX/zoom/standalone/recovery workflows. Current build/package/helper versions are 0.1.6. Local checks: 70 core, 43 backend and 22 release/update pipeline tests passed; all nine browser suites passed; production build, rustfmt and runtime audit passed (zero vulnerabilities). Both Linux helper archives were regenerated at 0.1.6 with yazl included. Source publication is gated by the version/commit, checksum and pinned SuperDoc source provenance before an immutable release or feed can publish.

The first v0.1.6 tag was not published: CI caught a grid double-click assertion during scrolling to a newly appended edge cell. The grid adapter now focuses its cell input with preventScroll and keeps text editors alive during deferred grid scroll events: the upstream editor closes itself on a scroll event, and implicit focus scrolling was immediately closing newly opened edge-cell editors. The original browser regression continues to double-click the edge cell directly. The release continues as v0.1.7, preserving the failed tag and published v0.1.5 assets unchanged.

## DOCX Find and Replace — 2026-10-28

Added an application-owned document search bar backed by pinned SuperDoc's native search sessions and replacement transactions. Cmd/Ctrl+F opens Find; Cmd/Ctrl+R opens Find and Replace before browser Find/Reload shortcuts. Existing document command/menu routing and visible view-bar buttons use the same actions. Search highlights matches, counts/navigates them, supports Match case and closes with Escape. Read-only documents expose Find only. Replace all restores the live query after SuperDoc clears its session, so subsequent Undo/Redo and edits refresh the results. Each command reads a fresh native transaction rather than retaining a command snapshot.

`npm run build` and all 70 core tests passed. The production-built `tests/docx-files-ui.mjs` browser workflow passed with external requests blocked: both Ctrl and Meta shortcut variants, input focus, Enter/Shift+Enter navigation, case-sensitive counts, clean search-only state, single/all replacement, toolbar Undo/Redo, save/reopen, no-results search, and subsequent draft recovery. Existing standalone Open File, file creation, and drop/copy checks in the same workflow also passed. The recovery assertion waits for the new edit's serialized draft, rather than accepting an older dirty snapshot. Screenshots at 1440, 1280, 1024 and 768 were inspected under `~/islet-ui-screens/offline-docx-files-20261028/docx-search-*.png`; search, replacement and zoom controls fit with the sidebar open. Logs: `/tmp/islet-docx-search-{build,core,ui}.log`. This qualification uses Chromium; native WKWebView and physical keyboard testing were not rerun for this change.

## Editor keymaps, hover and search docks — 2026-10-29

Added 49 configurable supported actions under Settings → Keyboard shortcuts, with system/macOS/Windows-Linux JetBrains-style presets, filtering, recording, typed edits applied on blur/Enter, alternatives, disabling, resets and conflict feedback. Central keyboard dispatch replaces duplicated app/editor bindings; Ctrl+Tab / Ctrl+Shift+Tab use an MRU switcher, with platform next/previous-tab bindings and preserved legacy bookmark/Save aliases. Dialog controls retain ordinary editing behavior. Native Edit uses first-responder Cut/Copy/Paste/Select All/Undo/Redo roles, while app commands and native accelerators avoid stealing modal or printable-input keystrokes. Project-tree clipboard routing remains explicit.

Text and DOCX Find/Replace now occupy a shared bottom-dock design. Text search includes match counters, next/previous, case, word and regex controls; search-input Save still saves the file. Empty definition/reference targets use anchored transient feedback, including unsupported or unowned files. Hover uses sanitized Markdown/code, bounded scrollable content and real language-service definition fallback for unresolved types, with an honest interpreter/import hint if they remain unresolved. Python analysis explicitly enables library-code type use; source/version and project-boundary checks remain in force.

Verification: `npm run build` passed; all 77 core tests and all 10 scripts in `npm run test:ui` passed after targeted checks. The production-built focused browser test verifies MRU/ordered switching, a manually typed/remapped tab binding, dock position/search/replacement, Save while a search field is focused, modal copy/paste/select-all without changing the editor buffer, real Python signatures/docs, entity/fence rendering, wheel scrolling of long hover content and non-modal missing-reference feedback. Existing interpreter, Codespaces, sidebar/terminal, tabs/navigation, updater, formats/callers, CSV/Excel and DOCX workflows remain green. The recovery fault-injection test now delays the exact intended edit, avoiding interception of an unrelated startup snapshot while retaining its serialization assertions.

Inspected screenshots at 1440/1280/1024/768, in dark/light themes where applicable, under `~/islet-ui-screens/editor-experience-20261029/` and `~/islet-ui-screens/offline-docx-files-20261029/`. Logs: `/tmp/islet-keymap-{build,core,full-ui,regression,save-targets}.log`. Native physical keyboard/menu testing and a packaged WKWebView run were not rerun for this frontend change; browser tests do not certify OS-reserved shortcut delivery. No installed app, default association, remote production host or release was changed.

## SSH reconnection — 2026-10-29

The project-tree retry now establishes SSH and reattaches the host's roots before reloading folders. Workspace restoration and window focus reconnect SSH automatically. Shared per-host attempts prevent concurrent roots/windows from replacing each other's handshake, and healthy transports are checked and reused. Reconnection preserves custom SSH/helper configuration within the running host. Timed-out heartbeats retire the unusable channel; cancelled startups and late events from retired channels cannot remove its replacement. A missing folder remains an independent error while other roots restore. Inline errors wrap within the sidebar and offer a named Reconnect button. Unsaved buffers are retained, remote revisions are rechecked, and reconnect never retries writes.

Verification: production build, 77 core tests, 44 backend tests (including the two helper-lifetime checks), and all 11 browser scripts passed. The actual isolated OpenSSH scenario now also verifies concurrent failed handshakes can be retried, host-only reconnect preserves a custom helper/configuration, six concurrent root restores share one connection, and opening another window reuses the generation of a healthy channel. Existing uncertain-save/revision-conflict checks passed. The new production-built browser workflow covers startup, manual retry, authentication failure, repeated focus, connection recovery from another window, new-window restore, independent missing-folder errors, and preservation of dirty/conflicted buffers with no save request.

Logs: `/tmp/islet-ssh-{build,core,backend,lifetime,integration,full-ui}.log`. Inspected error and reconnected/conflict screenshots under `~/islet-ui-screens/ssh-reconnect-20261029/`; error bounds were checked at 1280 and 768. The SSH fixture uses macOS loopback, not a production host. Native WKWebView, physical sleep/wake and a packaged app install were not rerun for this change. The installed app and published release were not changed.

## Window closing, recent projects and empty workspaces — 2026-10-29

Fixed the missing native destroy permission used by Tauri's close-request completion, and allowed unload after an explicit recovery-preserving close. Restored SSH editors now wait until their root is ready before starting scoped language services, avoiding an early `OUTSIDE_WORKSPACE` failure. The isolated OpenSSH test also opens a new, unrelated folder with a MarinaShell-style manifest ID on an existing connection, then lists it and starts its language service successfully.

Added a locally persisted, serialized recent-project history with host/type-aware identities and a 20-entry bound. The start screen and workspace menu offer folders and manifests; the macOS Dock offers the latest four names through AppKit's `applicationDockMenu:` callback, without replacing Tao's delegate. Window titles use the first folder's basename. Reopening focuses an existing matching window, reuses an empty one, or creates a separate window. New Workspace opens an empty window from the start screen, workspace menu, or configurable keyboard command. Folders default to collapsed and retain explicit expansion choices locally.

Verification: production build, 80 core tests, 42 focused backend tests, and all 12 browser workflows passed, including targeted reruns after fixture expansion updates. Existing editor scenarios now explicitly expand fixture roots; the new projects workflow separately verifies default collapse, persisted expansion, actual recent-folder delivery, the start screen, New Workspace dispatch, and recent-menu entries. Rust checks passed offline with the lockfile. Real macOS WKWebView tests invoked the actual native Dock menu action, verified four basename-only entries and native window titles, opened a separate empty workspace, completed clean window closes, and completed a dirty Keep Recovery and Close with the unsaved buffer on disk in recovery and the source file unchanged. These are native close-event tests, not a physical mouse click on the red control.

Inspected start-screen screenshots at 1440/1024/768 under `~/islet-ui-screens/projects-20261029/`. Logs: `/tmp/islet-projects-{build,core,backend,ssh,full-ui,ssh-ui,ui,native,rust-final}.log`. No installed app, default association, production remote host or release was changed.

## Missing versioned SSH helper recovery — 2026-10-29

Default SSH connections now probe for the matching helper before launching its Node executable. Readiness requires both `host.mjs` and an executable `node`, rather than the script alone. Missing/incomplete installations produce `REMOTE_SETUP_REQUIRED` and a setup action instead of a shell error and an ineffective reconnect loop. Probe/setup retain the host's saved SSH configuration. Explicitly selected custom helpers and Codespaces retain their existing connection paths.

The folder's setup dialog shows the host and versioned cache location, then installs the bundled package only after **Install and Reconnect**. Cancellation never installs anything; setup failures remain inline and retryable. Successful setup reuses normal root/watch/language reattachment and preserves dirty/conflicted buffers. The SSH folder context menu also opens setup directly.

Verification: production build, all 80 core tests, 43 focused backend tests, the isolated OpenSSH workflow and Codespaces UI checks passed. A backend fixture executes the actual Python probe against an isolated home directory, checks missing/non-executable runtimes, verifies saved SSH config retention, and proves unapproved setup is rejected without modifying the existing helper. The production-built SSH browser scenario checks missing-helper feedback, cancel without installation, explicit approval, a failed install followed by retry, restored folders, and unchanged unsaved buffers. Installation itself is mocked in that browser test. Inspected `~/islet-ui-screens/ssh-reconnect-20261029/helper-setup.png`. Logs: `/tmp/islet-helper-upgrade-{build,core,backend,ui,ssh,codespaces-ui}.log`. No production remote host or installed app was modified.

## Checkbox alignment and text paste — 2026-10-29

Updates and caller-panel checkboxes use the shared inline label style; checkboxes retain their width when labels wrap. The existing updater browser workflow checks the position of both update toggles at 768, 1024 and 1440 pixels in light and dark themes. Screenshots under `~/islet-ui-screens/checkboxes-20261029/` were captured; the narrow light view was visually inspected.

Standard text-editor clipboard shortcuts now pass through to native clipboard events. Context-menu/remapped text-editor commands and spreadsheet paste use a desktop pasteboard bridge instead of WebKit's permission-gated asynchronous Clipboard API. Clipboard text passes over stdin without shell interpolation or command-line arguments. Cut waits for a successful clipboard write before removing text, and pending text edits are discarded if the active document or selection changes.

Verification: production frontend and native builds, 80 core tests, the focused clipboard, editor, spreadsheet and updater browser workflows passed. Browser paste inserts a synthetic clipboard payload with asynchronous clipboard reads denied and verifies the source file remains unchanged. A native Rust unit test round-trips Unicode, empty text and shell-like literals on a private named pasteboard. The focused WKWebView test passes actual editor context-menu paste with the web Clipboard API blocked and verifies unchanged source bytes. Automated checks never access the user's general clipboard. The broader native projects test stalled at an earlier clean-window-close step before reaching paste; it does not provide additional qualification for this change. Logs: `/tmp/islet-checkbox-ui.log`, `/tmp/islet-clipboard-{build,core,ui,editor-ui,sheets-ui,native-unit,native-focused}.log`.

Release v0.1.12 qualification: synchronized npm/Tauri/Cargo/helper versions and lockfiles. The final source passed 80 core, 45 backend (including the two-minute idle helper check), 22 release/update pipeline tests, the production build, the native clipboard unit test, and the clipboard/updater/SSH browser workflows. Rust formatting, changed-source formatting, diff checks and staged secret scanning passed. Logs: `/tmp/islet-012-{core,backend,release,build,native-clipboard,clipboard-ui,updates-ui,ssh-ui,rustfmt,format,secrets}.log`. CI assembles and verifies the release packages after the tag push.
