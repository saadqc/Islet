# Apple silicon preview release

[GitHub Releases](https://github.com/saadqc/Islet/releases) provides the versioned `Islet_<version>_macos_arm64.dmg` for Apple silicon Macs with macOS 13.5 or newer. Open the disk image and drag `Islet.app` to Applications. The app includes its runtime, language services, fonts and notices; Node and Rust are needed only for development.

The preview is ad-hoc signed, verified with `codesign --deep --strict`, and **not notarized**. Gatekeeper may require explicit approval. Automatic updates have a separate cryptographic signature; this does not create an Apple Developer ID or notarization ticket. The remaining qualification limits are recorded in [VALIDATION.md](VALIDATION.md).

Each versioned release contains the Apple silicon DMG, `SHA256SUMS.txt`, a signed `.app.tar.gz` update archive and its `.sig`, and `latest.json`, plus `Islet_<version>_source.tar.gz` containing the tagged application source and pinned public SuperDoc 1.x source. The DMG is the normal manual installer; the additional files support in-app updates. Download all files listed in the checksum file into one directory and run `shasum -a 256 -c SHA256SUMS.txt` to verify them. No Intel, ZIP, Linux desktop or Windows desktop installer is published.

The [workflow](../.github/workflows/macos-release.yml) runs core/language, backend, browser and updater-pipeline regressions. Manual dispatch and version tags also build natively on the Apple silicon macOS 15 runner. It launches the actual packaged app with bundled language services and CLI, checks the running app's Dock icon and Finder icon, verifies source/resource provenance, creates the DMG, mounts it read-only, and checks its signature and runtime.

After those checks, the workflow archives the final signed app. Its complete contents, executable modes and symlinks must match the app verified inside the DMG. The archive is signed with the Tauri updater key, with the release version bound into the signature. Independent verification checks the archive signature and signed version before publication. Validation metadata is internal and is not a release download.

The publishing job verifies GitHub's uploaded sizes and digests before making the draft prerelease visible. It then advances the separate `updater` release's `latest.json` feed. Publication is serialized and an older workflow cannot replace a newer feed. Published version assets are immutable; only the dedicated feed is mutable. See [UPDATES.md](UPDATES.md) for signing-key setup and recovery.

Dependencies and Rust builds use lockfiles. Node 24.12.0 runtime archives are pinned to official SHA-256 checksums and include the archive's license. Linux x64 and arm64 helper archives inside the app support SSH workspaces; they are separate from desktop installer architecture.

Release maintainers can rehearse a build with manual workflow dispatch, then push a matching version tag. A failed draft publication can be rerun without exposing an incomplete release. An already published version must match exactly; a rebuild that produces different bytes requires a new version.
