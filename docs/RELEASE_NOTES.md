Islet 0.1.0 is a functional Apple silicon macOS preview of the Islands-style code editor.

It includes local and SSH workspaces, Python/JavaScript/TypeScript intelligence, semantic rename and grouped undo, navigation/bookmarks, scoped Find/Replace, Markdown reading, and independent recovery records.

Download `Islet_0.1.0_macos_arm64.dmg` for an Apple silicon Mac running macOS 13.5 or newer. It contains the self-contained Islet.app with bundled Node, language services, fonts and notices. `SHA256SUMS.txt` verifies the download. This release provides one desktop installer: the Apple silicon DMG.

The preview is ad-hoc signed and **not notarized**. Gatekeeper may require explicit approval. It is published as a prerelease; it is not a performance- or footprint-qualified release. Validation includes 24 core/language tests, 18 backend tests, 13 browser workflows, actual macOS WKWebView and isolated OpenSSH checks. The release workflow reruns regressions, native app/service/CLI checks, and mounted-DMG signature/runtime checks.

Still unqualified: first-use Linux SSH-helper bootstrap, physical IME/dead-key/trackpad behavior, broader performance budgets, and notarized distribution. The app includes Linux x64/arm64 helper archives for SSH functionality; no Linux or Windows desktop build is published.
