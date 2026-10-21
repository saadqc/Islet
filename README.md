# Islet

Islet is a macOS desktop code editor with Islands Dark and Islands Light themes. It combines CodeMirror editing, Python and JavaScript/TypeScript language services, local and SSH folders, semantic navigation and rename, bookmarks, Markdown reading, and workspace Find/Replace.

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
