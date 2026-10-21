# Apple silicon preview release

[GitHub Releases](https://github.com/saadqc/Islet/releases) provides `Islet_0.1.1_macos_arm64.dmg` for Apple silicon Macs with macOS 13.5 or newer. Open the disk image and drag `Islet.app` to Applications. The app includes its runtime, language services, fonts and notices; Node and Rust are needed only for development.

The preview is ad-hoc signed, verified with `codesign --deep --strict`, and **not notarized**. Gatekeeper may require explicit approval. No Developer ID identity or notarization credentials are configured. The remaining qualification limits are recorded in [VALIDATION.md](VALIDATION.md).

The release has two assets: the Apple silicon DMG and `SHA256SUMS.txt`. Download both into one directory and run `shasum -a 256 -c SHA256SUMS.txt` to verify the image. No Intel, ZIP, Linux desktop or Windows desktop installer is published.

The [workflow](../.github/workflows/macos-release.yml) runs core/language, backend and browser regressions. Manual dispatch and version tags also build natively on the Apple silicon macOS 15 runner. It launches the actual packaged app with bundled language services and CLI, checks the running app's Dock icon and Finder icon, verifies source/resource provenance, creates the DMG, mounts it read-only, and checks its signature and runtime. Product metadata is an internal validation input. The publishing job verifies the uploaded image and checksum file before making the draft prerelease visible.

Dependencies and Rust builds use lockfiles. Node 24.12.0 runtime archives are pinned to official SHA-256 checksums and include the archive's license. Linux x64 and arm64 helper archives inside the app support SSH workspaces; they are separate from desktop installer architecture.

Release maintainers can rehearse a build with manual workflow dispatch, then push a matching version tag such as `v0.1.1`. A failed draft publication can be rerun without exposing an incomplete release. Existing published stable releases are never replaced by the publishing script.
