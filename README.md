# Islet

Islet is a macOS desktop code editor with Islands Dark and Islands Light themes. It combines CodeMirror editing, Python and JavaScript/TypeScript language services, local and SSH folders, semantic navigation and rename, bookmarks, Markdown reading, and workspace Find/Replace.

The editor also highlights JSON, YAML, TOML, shell/Bash, XML, SQL, INI, Dockerfiles and requirements files. Common raster images open in read-only preview tabs with fit/zoom controls. Enable **Show caller panel above the editor** in Settings, or use the branch button beside the format label, to follow up to five levels of Python/JavaScript/TypeScript callers. Each entry links to its function definition and shows its file and line. Caller analysis follows code references; it is not a runtime debugger stack.

This is a functional preview implementation. The [validation record](docs/VALIDATION.md) distinguishes automated checks from the remaining platform and physical-input checks. The approved [plan](docs/PLAN.md), [interaction specification](docs/REVIEW_WORKSPACES.md), and [visual reference](docs/REFERENCE.md) remain the product specification.

## Run

Download the Apple silicon (`arm64`) DMG from [Releases](https://github.com/saadqc/Islet/releases). An Apple silicon Mac with macOS 13.5 or newer is required. The preview is ad-hoc signed and not notarized; Gatekeeper may require explicit approval. See [release details](docs/RELEASE.md) for checksums and build gates.

To use a locally built preview, open `src-tauri/target/release/bundle/macos/Islet.app`. It includes its own runtime and language services; Node and Rust are needed only for development.

```sh
open src-tauri/target/release/bundle/macos/Islet.app
```

Development requirements: Node 24.12.0, npm, Rust/Cargo, and the macOS command-line developer tools. The bundled Node runtime requires macOS 13.5 or newer. Dependencies are locked in `package-lock.json` and `src-tauri/Cargo.lock`.

```sh
npm ci
npm run runtime:setup
npm run dev:app
```

`dev:app` starts the authenticated development host and UI at `http://127.0.0.1:1420`, uses isolated `.tools/dev-data`, and stops after one hour. In another terminal, run the native app against that UI:

```sh
ISLET_DATA_DIR="$PWD/.tools/native-data" ./src-tauri/target/debug/islet
```

For a fresh native development build, stop `dev:app` and run `npm run desktop` (Tauri starts Vite itself). The native app starts its own IPC file host and does not require a local HTTP service.

## Build

```sh
npm run runtime:setup
npm run runtime:remote -- x64
npm run runtime:remote -- arm64
npm run desktop:build
```

The application bundle is written to `src-tauri/target/release/bundle/macos/Islet.app`. Local Node and language services, both Linux helper/runtime archives, fonts, and notices are bundled. The preview is ad-hoc signed for local execution and is not notarized for distribution; the GitHub release workflow publishes macOS preview downloads. Installation into `/Applications` remains optional.

## Use

Open a folder from the workspace menu; add more local or SSH folders from the Project `+` button. SSH uses system OpenSSH configuration and agent authentication, with native authentication prompts. New remote helper setup requires approval for the displayed host/cache path. Existing compatible helpers can be selected instead.

Files open in persistent tabs. Drag tabs to reorder them; double-click or right-click a tab to pin it. Native file drops open multiple files and attach outside parent folders without replacing existing tabs. Cmd/Ctrl-click or Cmd+B opens and reveals definitions; Alt+F7 shows semantic references; Shift+F6 previews project-wide symbol rename. Back/Forward restore selections and scroll, with repeated semantic destinations kept once. Line bookmarks have a dedicated gutter. Find/Replace in Files always shows folder and location fields; a blank folder searches the workspace. Replacement and rename changes remain unsaved and offer grouped undo and explicit saving.

Markdown opens in reading mode. Edit Source preserves the buffer and undo history. Relative images use the owning file provider; network images require explicit opt-in.

The bundled [GitHub Codespaces plugin](docs/CODESPACES.md) is off by default. Enable it in Settings → Plugins to manage cloud environments, attach their folders alongside local and SSH roots, and create expiring localhost forwards using GitHub CLI. Disabling it closes owned connections and forwards without stopping or deleting cloud environments.

The optional `islet` launcher is installed from Settings. See the [CLI specification](docs/REVIEW_WORKSPACES.md#command-line-interface) for multi-folder, workspace-file, and window-targeting examples.

Select Python independently for each local or SSH root with repeatable `--python-interpreter <folder-or-ssh-URI> <absolute-executable>` options:

```sh
islet open --python-interpreter /work/api /opt/venvs/api/bin/python --python-interpreter ssh://devbox/srv/web /srv/venvs/web/bin/python
islet add --window WINDOW_ID --python-interpreter /work/api /opt/venvs/other/bin/python
islet open --workspace example.islet-workspace --python-interpreter /work/api /opt/venvs/api/bin/python
```

The executable must exist on that root's host. Workspace overrides must match a manifest root. Omitting the option preserves a configured interpreter; an explicit empty `root.interpreter` in a manifest or clearing the current project's interpreter in Settings restores auto-detection. Settings and the status bar follow the current document's root, and changing its interpreter restarts that root's Python intelligence. External applications can supply the same `root.interpreter` manifest field.


## Verify

```sh
npm test
npm run test:backend
npm run test:ui
npm run test:ssh
npm run build
```

Browser tests require the development host and Chromium. `ISLET_CHROMIUM` can select an existing Chromium executable. SSH tests create an isolated loopback OpenSSH host and fixtures; they do not use production aliases or user repositories. Native smoke uses a debug-only test hook documented in the validation record.

Each window writes an independent recovery record. Named workspaces are indexed by their canonical manifest path; reopening restores a snapshot into a fresh record. Use **Recover Workspace…** in the workspace menu to recover earlier unnamed or secondary-window sessions. Opening another manifest from a populated window creates a new window and preserves its unsaved buffers.

Recovery/session/settings data lives in the platform application-data directory, or `ISLET_DATA_DIR` when explicitly supplied. Workspace manifests contain roots and non-secret preferences; credentials are excluded.

## Offline spreadsheets and creating files

CSV, XLS and XLSX files open in a locally bundled spreadsheet data editor. Double-click a cell to edit; use the worksheet selector for workbooks, Undo/Redo for cell changes, and Row/Column to append space. Cmd/Ctrl+S saves through the same conflict-checked file provider as text files. CSV also offers **Edit CSV Source** / **Show Grid**, retaining UTF-8 BOM/newline style and text identifiers. All editor assets ship with Islet; no hosted editor, converter, license service, or runtime CDN is required.

This is a data editor: formulas are editable text and are not calculated. Advanced Excel formatting, charts, pivots and macros are not guaranteed to survive export. Before replacing an XLS/XLSX file, Islet verifies an exact original backup in the owning host's private application-data `workbook-backups` directory. **Save XLSX Copy…** writes a separate, exclusively created file without changing the source; the source tab keeps its unsaved edits. Legacy XLS formula saves are blocked because SheetJS CE cannot write XLS formulas; use the XLSX copy instead. Binary workbooks are limited to 10 MB, with 5,000 rows / 256 columns / 100,000 cells per editable sheet. DOCX opens in the offline SuperDoc editor; legacy DOC remains unsupported.

Create files and folders from the Project toolbar, the native File menu, or a project-tree context menu. Cmd/Ctrl+N opens New File. The selected folder supplies the parent directory; duplicate names cannot overwrite existing files. New XLS/XLSX files contain a valid blank workbook. Folder labels expand on double click by default; change **Settings → Expand folders with** to Single click if preferred. Disclosure arrows and keyboard expansion work in either mode.

For XLS/XLSX, **+ Sheet** creates a worksheet and **Sheet actions…** offers rename, duplicate and delete. Names follow Excel's length/character rules and cannot collide ignoring case. Rename updates direct formula references, defined names and internal links; formula string literals and external workbook links stay unchanged. Delete requires confirmation and keeps at least one visible sheet. These are unsaved workbook changes with Undo/Redo support (the ten most recent sheet actions while the tab remains mounted).

To qualify the native spreadsheet path, build a debug executable with bundled assets (`tauri build --debug --no-bundle`), stop the development server, then run `npm run test:native:spreadsheets`. The runner uses disposable files and application data, a debug-only DOM/IPC hook, and a 45-second process expiry. It does not replace physical keyboard, clipboard or IME testing.


## Keyboard shortcuts, search and hover

**Settings → Keyboard shortcuts** provides 49 configurable actions with JetBrains-style macOS and Windows/Linux presets, an automatic system preset, action filtering, keystroke recording, resets and conflict warnings. Typed mappings apply on blur or Enter; `;` separates alternatives and `-` disables an application mapping. Ctrl+Tab / Ctrl+Shift+Tab cycle recent editors; next/previous tabs use Cmd+Shift+]/[ on macOS and Alt+Right/Left on Windows/Linux. OS-reserved shortcuts such as Alt+Tab may not reach the app. Native clipboard commands retain normal system behavior in dialog inputs.

Find and Replace within a file open a bottom dock with match counts, navigation and optional replacement controls. Text files additionally support Match case, Whole words and Regular expression options. Search-dialog clipboard shortcuts act on the focused input rather than the editor buffer.

Language hovers render sanitized Markdown and highlighted code, decode documentation entities and contain long documentation in a scrollable viewport. When a type is unresolved, Islet checks a real in-project definition through the language service; it never invents a type. Types that remain unresolved show an interpreter/import hint. Empty definition/reference jumps show an anchored “No reference found” tooltip without opening a modal.

## DOCX and file operations

Use **Cmd/Ctrl+F** to find text in a DOCX, or **Cmd/Ctrl+R** to open Find and Replace. The document view bar also has Find and Replace buttons. Search highlights matches, shows the current match count, and supports Match case, previous/next buttons, Enter/Shift+Enter navigation and Escape to close. Replace changes the active match; Replace all changes all editable matches in one undoable operation. Replacements use ordinary unsaved edits, save and recovery; searching alone does not modify the file. Everything runs locally, and read-only documents allow Find only.

DOCX editing uses **SuperDoc 1.46.2 (AGPLv3)**, with telemetry disabled and no collaboration, vendor services, remote fonts, or proprietary DOCX engine. Version 2.x is deliberately excluded because its separately licensed engine is not open source. The complete editor and blank template ship with the app. A fixed bottom bar provides zoom out/in, a 25–400% slider, percentage reset to 100%, and Fit width. Cmd/Ctrl +/− zoom and Cmd/Ctrl 0 resets; each document remembers its view zoom without becoming dirty. DOCX files use the same 10 MB limit, local/SSH binary saves, recovery, revision conflicts, and verified original backups (`document-backups` in the owning helper's private data directory). Word features outside the editor's supported subset are not guaranteed to round trip losslessly. Legacy `.doc` files produce a clear conversion message.

Drop files/folders onto a project folder to **copy into that folder**; drop onto the editor to open files or add folders. Copies keep the source, stage content before publishing, reject name collisions, verify SHA-256/size, and expose progress/cancellation. Multi-item jobs retain any already completed items if a later item fails. Folder transfers preserve internal symlinks without following them; links escaping the copied folder are rejected for copies. Source folders containing special devices or more than 100,000 entries are rejected.

For local items, **Copy File/Copy Folder** and **Paste** use macOS file URLs, compatible with Finder's file clipboard. Focused tree rows also accept Cmd+C/Cmd+V. On SSH/Codespaces items, **Download File…** opens a native Save As chooser. **Download Folder as ZIP…** first creates the ZIP in the helper host's temporary directory, then streams it to the chosen local path. Temporary archives and partial downloads are cleaned up on completion/cancellation; disconnected helper sessions expire after ten minutes. Transfer RPC chunks are bounded to 512 KB, so downloads do not load an entire folder into the UI bridge.

The macOS bundle advertises CSV, XLS/XLSX, DOCX and common text/source files for **Open With**. It does not change your default applications. After installing the new build, select a file in Finder → Get Info → Open with → Islet → Change All to choose it as the default for that extension. Opening a file opens it as a standalone tab without adding its parent folder. Only that exact local file is authorized for editing; sibling files remain outside the workspace. Remote paths remain workspace/SSH locations, rather than macOS file associations.

Existing SSH helpers must be reinstalled with **Setup Remote Helper** to obtain the new file-transfer protocol. Old helpers fail with an explicit upgrade message. `npm run test:native:office` checks bundled DOCX save, the actual AppKit file URL clipboard using an isolated test pasteboard, local file/folder copies, and native CLI file opening. The debug-only test hook and expiring processes use disposable data and never touch the user's general clipboard.
