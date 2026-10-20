# Islet code review and workspace specification

Status: approved specification; functional preview implemented. See [validation record](VALIDATION.md) for measured evidence and outstanding release gates. This specification extends the [implementation plan](PLAN.md) with the accepted code-review requirements. The approved dark/light mockups remain the visual direction; add the new interactions within the same compact Islands layout.

## Navigation and bookmarks

### Definitions and references

Cmd-click on macOS and Ctrl-click on Windows/Linux opens a symbol's definition. Holding the modifier underlines the navigable symbol and changes the pointer. Resolve the symbol at the clicked position, not an old caret position. Multiple targets open a compact chooser with file, project, host, and code preview.

Provide separate Go to Definition and Find References actions in the context menu and keyboard map. Find References lists semantic usages grouped by project and file, with code snippets and next/previous result controls. Clicking a declaration with the modifier shows its usages if the definition would only return the current declaration. A no-result outcome should be clear and leave the caret in place.

Requests use the document's owning language service and unsaved document state. References may span the owning language project and its understood dependencies; unrelated attached folders do not become one program merely because they share a window.

### Back and Forward

Before a successful definition/reference/bookmark/function jump, save the origin's host, document, caret, selection, and scroll position. Back returns to that exact location, including reopening the tab when necessary. Forward returns to the destination. Use visible Back/Forward buttons near the editor tabs plus shortcuts and context-menu actions.

History spans local and remote tabs. Coalesce duplicate destinations, omit failed requests and ordinary caret movement, and clear the forward branch after a new deliberate jump. Map positions through edits. When a remote location is disconnected, retain the entry and offer reconnect; never silently substitute a similarly named local file.

### Next and previous function

Move to the next or previous function/method declaration in document order. Include Python async methods and nested functions, JavaScript function declarations, methods, and named arrow-function bindings. Traverse nested declarations in source order; do not wrap at file boundaries by default.

Prefer fresh language-server document symbols. Use the local syntax tree when the service is unavailable or results are stale. Keep parsing specific to Python/JS syntax rather than searching for function-name strings. Every jump participates in Back/Forward history.

### Line bookmarks

Click a dedicated gutter bookmark area, use Toggle Bookmark, or use the shortcut to bookmark a line. Keep the folding target separate. Show a small marker in the gutter and offer an optional label, next/previous bookmark, and a Bookmarks popup grouped by project/file.

Persist host, canonical document identity, line anchor, label, and surrounding text context in workspace state. Map anchors through live edits and document renames. On reopening externally modified files, use context to relocate the anchor; flag unresolved bookmarks rather than jumping to an arbitrary line. Missing/disconnected files remain listed with their state.

### Proposed default shortcuts

These are Islet defaults to validate against OS shortcuts and editor input bindings, not a claim that every binding matches PyCharm. Make them configurable and show the active binding in menus.

| Action | macOS | Windows/Linux |
| --- | --- | --- |
| Go to Definition | Cmd+B or Cmd-click | Ctrl+B or Ctrl-click |
| Find References | Alt+F7 | Alt+F7 |
| Navigate Back / Forward | Cmd+[ / Cmd+] | Alt+Left / Alt+Right |
| Previous / Next Function | Ctrl+Alt+Up / Ctrl+Alt+Down | Alt+Up / Alt+Down |
| Toggle Line Bookmark | Cmd+F11 | F11 |
| Show Bookmarks | Cmd+Shift+F11 | Shift+F11 |
| Previous / Next Bookmark | Alt+Shift+Up / Alt+Shift+Down | Alt+Shift+Up / Alt+Shift+Down |
| Refactor Rename | Shift+F6 | Shift+F6 |
| Find in Files | Cmd+Shift+F | Ctrl+Shift+F |
| Replace in Files | Cmd+Shift+R | Ctrl+Shift+R |
| Open editor context menu | Shift+F10 | Shift+F10 |

Function keys may require Fn on some keyboards. Detect duplicate application bindings and allow remapping when an OS captures a shortcut. Modifier-click navigation must not conflict with the chosen multiple-cursor gesture.

## Find and Replace in Files

Provide global **Find in Files…** and **Replace in Files…** through the Search menu, project-tree search button, editor context menu, and shortcuts. Right-clicking a project or folder exposes the same actions with that root/folder preselected as the scope. Clearly distinguish these actions from Find/Replace within the active file.

The scope picker offers Entire Workspace, Current Project, Selected Folder, and explicitly selected roots. Entire Workspace includes local and connected SSH projects, with results grouped by host, project, and file. Always show the active scope; global search starts with Entire Workspace, while a folder context action starts with that folder.

Both global modals show a visible **Search in folder** field immediately on opening, alongside the search text and scope controls. The field supports typing a path, autocomplete from workspace folders, recent folder selections, and a Browse button. Selecting or entering a valid folder switches the scope to that folder and its descendants; clearing it restores Entire Workspace. Folder context actions prefill this field.

For mixed workspaces, pair the folder field with a **Location** selector showing Local or the relevant SSH connection. Browse and path validation run on that location; identical paths on different machines remain distinct. Accept an SSH URI as direct input and resolve it to the corresponding connection and path. Show invalid or disconnected locations inline and never fall back silently to a broader scope. Keep folder search within attached roots; for another folder, offer Add Folder to Workspace before searching it. Replacement previews must display the resolved host and folder prominently.

Support literal text, case sensitivity, whole words, regular expressions, file masks such as `*.py` or `*.{js,jsx}`, and include/exclude folders. Respect ignore files by default, with explicit toggles for ignored and hidden files. Skip binary files; disclose file-size/result limits and excluded or unavailable roots. Do not label a partial search as complete or show “No matches” when a root could not be searched.

Stream results with path, line number, match highlights, and a surrounding snippet. Show running/completed/failed state per root; allow cancellation. Selecting a result opens the document at the match and adds the previous location to navigation history. Revalidate results after edits and discard replies from obsolete queries.

Search each root on its owning machine. Use the same pinned search engine and filter semantics locally and through the SSH helper; evaluate ripgrep as the implementation engine during development. Do not download entire remote trees to search them. Overlay unsaved buffers onto disk results, excluding their stale disk matches, so search and replacement reflect the text the user is editing.

Replace in Files opens a preview with before/after changes, file and occurrence counts, and checkboxes for selected matches/files. Provide Replace Selected and Replace All in Scope. Validate regex replacement syntax, capture-group behavior, and zero-width matches before execution; match and replacement semantics must agree across hosts.

Apply replacements through the same version-checked document transaction service as Rename, retaining a grouped undo action. Modified documents become dirty and expose Save Changed Files; existing unsaved edits must not be silently written or discarded. Recompute stale previews when any affected buffer or disk revision changes. Report partial/uncertain disk saves using the transaction journal, especially after SSH loss. Each host has its own persistence outcome; never imply an atomic save across machines.

Find/Replace in Files is text-based and may intentionally change comments or strings. Refactor Rename remains the separate semantic action for changing one symbol across its usages.

## Intelligent symbol rename

Right-click a function or identifier and choose **Refactor → Rename…**. The same operation is available from Shift+F6. Select the identifier under the pointer without destroying an unrelated selection unless the user actually invokes a symbol action.

The language server computes semantic edits across files. LSP defines a prepare-rename request and a rename request returning workspace edits; Islet is responsible for validating and applying those edits. [LSP rename specification](https://raw.githubusercontent.com/microsoft/language-server-protocol/gh-pages/_specifications/lsp/3.17/language/rename.md).

The interaction is:

1. Check whether the language service supports rename and prepare the symbol when supported. Explain unsupported, read-only, disconnected, or invalid targets.
2. Open a compact name field with the current name selected. Validate the new identifier through the server.
3. Show the proposed edits grouped by project, host, and file, with before/after snippets and occurrence counts.
4. Apply the complete coherent edit set after rechecking buffer versions and disk revisions. If anything changed since preview, refresh the preview instead of applying stale offsets.
5. Create one refactoring undo group across every affected document, including previously closed files.

Update declarations, imports, call sites, and other usages identified as the same symbol. Same-spelled symbols in unrelated scopes must stay unchanged. Comments, arbitrary strings, reflection and dynamically constructed attribute names are not guaranteed semantic references; do not claim those were updated unless the server supplied the corresponding edits.

The default scope is the owning language project. A rename can include multiple attached roots only when one language service models their relationship on the same host and the preview explicitly includes them. An unrelated project on another machine is never silently included in a rename.

Apply loads affected closed files into the document registry and marks edited documents dirty. It does not silently save pre-existing unsaved work. Show the affected-file count and an explicit **Save Changed Files** action after applying; closing the refactoring UI leaves those changes discoverable.

Before saving the group, preflight all file revisions/permissions, retain recovery snapshots and a transaction journal, and write each file atomically where supported. A set of filesystem writes is not globally atomic: report saved, pending, conflicted, or uncertain files on partial failure. Recheck remote contents after a connection loss before retrying. Rollback/undo must not overwrite edits made after the transaction; require conflict resolution where versions diverge.

Apply in-memory edits as one validated transaction and preserve each file's prior dirty state for undo. Workspace-level Undo Rename restores the entire edit group. Later edits or disk changes require revalidation before undoing the group. Reject unsupported resource operations as a whole rather than applying only some returned edits. File Rename remains a separate project-tree action; symbol Rename never means renaming the tab's file.

## Custom editor context menu

Use a single command registry for shortcuts, native menus, custom context menus, and toolbar actions so availability and behavior agree.

| Menu group | Actions |
| --- | --- |
| Edit | Undo, Redo, Cut, Copy, Paste, Select All |
| Navigate | Go to Definition, Find References, Back, Forward, Previous Function, Next Function |
| Bookmarks | Toggle Bookmark, Edit Bookmark Label, Previous Bookmark, Next Bookmark, Show Bookmarks |
| Refactor | Rename… |
| File and text | Find, Replace, Find in Files…, Replace in Files…, Copy File Path, Copy Path and Line, Reveal in Project |
| Markdown only | Preview Markdown / Edit Source, as appropriate |

Show familiar edit commands and relevant review commands; disable unavailable actions with a concise reason. Do not silently fall back from semantic rename to text replacement. Preserve selection for Cut/Copy and context-sensitive symbol targeting for navigation.

The menu uses Islands colors, typography, separators, icons, and keyboard-hint alignment. Support arrow-key navigation, submenus, Enter, Escape, Shift+F10, focus restoration, screen-reader roles, and viewport-edge positioning. Stop native WebView menus from replacing the custom editor menu while retaining platform behavior in ordinary text fields.

## Mixed local and SSH workspaces

One workspace contains ordered project roots. Each root has a stable ID, label, host ID, canonical absolute path on that host, environment selection, and connection state. Document identity is the tuple of host and canonical path. `/srv/app/main.py` on two hosts must produce separate tabs, buffers, bookmarks, and language-service documents.

Provide **Add Project/Folder…** with Local Folder and SSH Folder choices. The SSH choice offers saved connection profiles/SSH aliases and a remote folder browser. Display a discreet host badge on remote roots and tabs; show Connecting, Ready, Disconnected, and Setup Needed states. Removing a root closes or detaches its documents only after unsaved edits are resolved; it never deletes source files.

### SSH transport and setup

Use system OpenSSH to honor SSH aliases, agent/key authentication, ports, IdentityFile, and ProxyJump. Show host-key verification and authentication prompts through a controlled UI; reject changed host keys by default. Keep credentials out of workspace manifests and command-line arguments. Support agent authentication first, plus an askpass bridge for passphrases/password and interactive prompts. [OpenSSH documentation](https://www.openssh.org/manual.html).

Install a small versioned Islet helper in the remote user's cache on first use, with a one-time setup dialog stating the host, location, and contents. Target Linux x86_64 and arm64 initially; probe OS, architecture, runtime prerequisites, free space and writable cache. Support selecting an existing compatible helper when installation is unavailable. Do not require root, a listening network port, or a permanent daemon.

Transfer verified helper/runtime packages over SSH/SFTP, pin their versions, and communicate through authenticated SSH channels using framed messages. File paths travel as structured data. Keep the remote bootstrap command fixed and carefully quoted; project paths never become remote shell expressions.

The remote helper provides directory listing, reads, revision-checked saves, watch events, and language-service supervision. Python environments and JS dependencies resolve on the remote host. Islet routes LSP `file://` URIs through the service session's host identity on both requests and replies.

Use one connection manager per host and separate cancellable file/service channels so a slow directory enumeration cannot block completion. Avoid recursive full-tree downloads; list directories lazily and watch only necessary areas. Local editing never waits for SSH.

The helper is owned by the connection with a bounded lease for reconnect, and shuts down its processes on lease expiry or explicit close. Reconnect must attach to the same live session or start a new generation and invalidate pending replies. Never start duplicate language servers blindly.

### Disconnection and saving

Keep open buffers editable and retain unsaved recovery locally, including remote host identity. Clearly distinguish **Saved remotely** from **Unsaved — disconnected**. Never show a local recovery copy as a successful remote save.

After reconnect, compare remote revisions with the last known versions before applying buffered edits. Offer a conflict view if remote contents changed. A connection lost during save produces an uncertain result until rereading the remote file confirms whether the intended revision arrived.

## Command-line interface

Install the optional `islet` launcher from application settings. Positional roots may be local paths or SSH URIs; quote paths containing spaces. Accept `--` to end options. SSH URIs use an absolute remote path and an SSH config alias or explicit user/host/port, with percent-encoding where required.

```sh
# Open several local projects together in a new workspace window
islet open --new-window ~/Projects/backend ~/Projects/frontend ~/Projects/worker

# Open one local project and one remote project in the same window
islet open --new-window ~/Projects/frontend ssh://staging/srv/backend

# Add folders to the existing foreground workspace
islet add ~/Projects/worker ssh://deploy@worker-host:2222/srv/worker

# Target a specific window when several are open
islet windows --json
islet add --window <window-id> ssh://staging/srv/shared

# Restore a named workspace containing local and SSH roots
islet open --workspace ~/Workspaces/harbor.islet-workspace
```

`islet <roots...>` is shorthand for `islet open <roots...>` and creates a new workspace window by default. `add` targets the foreground workspace; when there is no unambiguous target it returns a clear error and available window IDs. `--window` always targets that exact window. Do not guess which workspace should receive folders.

Normalize and deduplicate roots per host, preserve argument order, and report invalid roots individually. Unreachable remote roots stay visible as disconnected entries; valid local roots can still open. CLI success acknowledges delivery to the application, not remote connection readiness. Report parsing/delivery failures through stderr and a nonzero exit code.

Use a local authenticated single-instance IPC channel for delivery, and a structured request including operation, target window, roots, and request ID. Avoid shell command reconstruction.

An `.islet-workspace` manifest stores `schemaVersion`, workspace ID/name, ordered root descriptors and non-secret preferences. Remote roots reference SSH aliases/profiles, never passwords or private-key contents. Local relative paths resolve against the manifest location; remote paths are absolute on their owning host. Session state, bookmarks, and recovery remain in app data keyed by workspace ID.

## Markdown reading and editing

Open `.md` and `.markdown` files in **Preview** by default. Provide a persistent **Edit Source** button; source mode is the normal CodeMirror editor with a **Preview** button in the same place. Remember an explicit per-document choice across tab/session restoration and offer a global default setting.

Render headings, lists, tables, task lists, blockquotes, links, images, inline code, and fenced code with theme-appropriate highlighting. Use markdown-it with explicit extensions for the supported syntax. Typography follows the Islands UI; code blocks use JetBrains Mono. [markdown-it](https://github.com/markdown-it/markdown-it).

Preview reads the current buffer, including unsaved edits. Switching modes must preserve text, dirty state, undo history, source selection, and independent preview/source scroll positions. Use source-line mappings for approximate scroll correspondence when switching for the first time.

Resolve relative links and images against the document's directory on its owning host. Fetch SSH assets through the remote file provider. Clicking another Markdown file opens its preview; links to source files open editor tabs and participate in Back/Forward history. Heading fragments navigate within the preview.

Disable raw executable HTML and scripts; sanitize rendered output and reject executable URL schemes. Proxy file assets through scoped document permissions rather than granting the preview unrestricted filesystem access. External links open in the system browser after an explicit click; remote network images require user opt-in. Preview context menus provide Copy, Copy Link, Open Link, Back/Forward, and Edit Source; edit-only actions are available in source mode.

## Acceptance scenarios

| Area | Required checks |
| --- | --- |
| Definitions and references | Imported Python function and JS/JSX symbol; multiple targets; same-name unrelated symbol; no-result; unsaved edit; stale reply |
| History | Local-to-remote tab jump and return; original caret/selection/scroll; closed tab reopening; edited/deleted file; offline host |
| Functions | Nested/async Python, class methods, JS arrows; file boundaries; parser fallback; no accidental match in comments/strings |
| Bookmarks | Toggle by gutter/menu/shortcut; insert/delete lines; rename/reopen file; restart; identical paths on different hosts; unresolved anchor |
| Rename | Declaration/imports/call sites across several files; scope shadowing; dirty and closed files; invalid names; unavailable service; preview cancellation; grouped undo |
| Rename conflicts | File changed after preview; one read-only file; concurrent edit; unsupported resource edit; failed/uncertain save; recovery after restart |
| Mixed hosts | Local frontend plus SSH backend together; correct remote virtualenv; separate same-path files; local typing during connection failure |
| SSH lifecycle | Agent/askpass, unknown/changed host key, ProxyJump, spaces in paths, permission denial, helper setup/upgrade, disconnect/reconnect, process lease cleanup |
| CLI | Multiple local/SSH roots, manifests, deduplication, spaces/Unicode, `--`, active/missing/explicit target, unreachable root, malformed URI |
| Find/Replace in Files | Global/project/folder scopes; context-menu preselection; literal/case/word/regex filters; ignore/hidden controls; unsaved-buffer overlay; local and SSH results; cancellation and stale replies; partial search disclosure; selective replacement, capture groups, version conflicts, grouped undo and interrupted saves |
| Markdown | Default preview and source button; unsaved content; undo preservation; tables/code/images; local and remote relative links; heading anchors; sanitized hostile content |
| Menus and themes | Matching Dark/Light styling; disabled-state reasons; right-click targeting; keyboard-only/submenu navigation; screen reader; viewport edges |

The complete initial release includes these capabilities. Intermediate milestones may deliver local navigation and rename before SSH, but the initial feature scope is not complete until the mixed-host scenarios pass.
