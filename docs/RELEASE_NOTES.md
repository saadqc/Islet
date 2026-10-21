Islet 0.1.1 improves everyday code review and adds an optional GitHub Codespaces plugin.

- Original Islet macOS Dock/Finder icon, with standard and Retina assets checked in the running packaged app.
- Complete themed file/folder icon pack, including Python, React, configuration and environment files.
- Project sidebar with full filenames, horizontal scrolling, persistent resizing and collapse controls.
- Local file/folder **Reveal in Finder** and folder **Open in Terminal**, with a configurable terminal. MarinaShell 0.2.24 or newer supports opening the selected folder in a fresh terminal tab.
- Persistent file tabs, drag-to-reorder, pinning and explicit dropped-file opening.
- Same-file definition jumps scroll to the destination; navigation history preserves viewports while deduplicating repeated destinations.
- Python interpreters scoped to each project, with CLI/workspace handoff from MarinaShell and language-service restart when the selected environment changes.
- Bundled **GitHub Codespaces** plugin, **off by default**. Enable it under Settings → Plugins for lifecycle controls, local/remote workspace folders, reconnection, SSH command copying and expiring localhost port forwarding. Authentication uses GitHub CLI.

Download `Islet_0.1.1_macos_arm64.dmg` for an Apple silicon Mac running macOS 13.5 or newer. The only public assets are the DMG and `SHA256SUMS.txt`. Runtime, language services, fonts and notices are bundled.

The preview is ad-hoc signed and **not notarized**. Gatekeeper may require explicit approval. Automated checks cover editor and browser workflows, isolated real SSH transport, native app/CLI/language services, icon identity, and mounted-DMG signature/runtime checks. GitHub lifecycle tests use controlled responses; they do not stop or delete users' existing Codespaces. Physical input/trackpad behavior, broader performance budgets and notarized distribution remain qualification limits.
