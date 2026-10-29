Islet 0.1.11 improves workspace startup, window closing and recent projects.

- New Workspace opens an empty window where you can add folders yourself, while preserving your existing workspace. It is available on the start screen, in the workspace menu and through a configurable shortcut.
- Recently opened folders and workspace files appear on the start screen and in the workspace menu. The macOS Dock offers the four most recent projects, and window titles show the first folder's name instead of a full path. Reopening focuses an existing project window or opens it separately when needed.
- Folders start collapsed and remember your expansion choices locally.
- Fixed window closing, including saving or keeping unsaved recovery buffers before closing.
- Restored SSH editors wait for their folder to finish attaching before starting language services, preventing an early “outside attached roots” error. MarinaShell-style incoming folders are covered by the isolated SSH checks.

Everything continues to run locally without a vendor service. New remote-helper setup or upgrades still require approval. DOCX is supported; legacy DOC remains unsupported, and advanced Office formatting is not guaranteed to round trip losslessly.

Install using the Apple silicon DMG or Check for Updates. macOS 13.5 or newer is required. The preview is ad-hoc signed and **not notarized**; automatic-update archives have independent cryptographic signatures. Source archives and dependency notices accompany the AGPLv3 release.
