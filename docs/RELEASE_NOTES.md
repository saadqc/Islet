Islet 0.1.0 is a functional macOS preview of the Islands-style code editor.

It includes local and SSH workspaces, Python/JavaScript/TypeScript intelligence, semantic rename and grouped undo, navigation/bookmarks, scoped Find/Replace, Markdown reading, and independent recovery records.

Download the arm64 build for Apple Silicon or the x64 build for Intel. macOS 13.5 or newer is required. Both ZIP and DMG contain the same self-contained Islet.app with bundled Node, language services, fonts, notices, and Linux SSH-helper packages. SHA256SUMS.txt verifies the downloads; per-architecture metadata records runtime versions and signing state.

The preview is ad-hoc signed and **not notarized**. Gatekeeper may require explicit approval. It is published as a prerelease; it is not a performance- or footprint-qualified release. Prior local validation passed 24 core/language tests, 18 backend tests, 13 browser workflows, actual macOS WKWebView and isolated OpenSSH checks. The release workflow reruns regressions and native package/service/CLI checks for both architectures.

Still unqualified: first-use Linux helper bootstrap, physical IME/dead-key/trackpad behavior, broader performance budgets, and notarized distribution. No Windows or Linux desktop build is published. Linux archives inside the app support SSH functionality only.
