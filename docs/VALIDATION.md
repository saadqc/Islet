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
