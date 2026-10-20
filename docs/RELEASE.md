# macOS preview releases

[GitHub Releases](https://github.com/saadqc/Islet/releases) contains native Apple silicon (`arm64`) and Intel (`x64`) downloads. Both require macOS 13.5 or newer. Choose the architecture that matches your Mac; each ZIP and DMG contains the same self-contained `Islet.app`. The DMG includes a shortcut to Applications. No Node or Rust installation is needed to run the app.

These preview builds are ad-hoc signed, verified with `codesign --deep --strict`, and **not notarized**. Gatekeeper may require explicit approval. No Developer ID identity or notarization credentials are configured. This is a functional preview, with the qualification limits recorded in [VALIDATION.md](VALIDATION.md).

Each release contains:

| Architecture | App archive | Disk image | Build metadata |
| --- | --- | --- | --- |
| Apple silicon | `Islet_0.1.0_macos_arm64.zip` | `Islet_0.1.0_macos_arm64.dmg` | `Islet_0.1.0_macos_arm64.json` |
| Intel | `Islet_0.1.0_macos_x64.zip` | `Islet_0.1.0_macos_x64.dmg` | `Islet_0.1.0_macos_x64.json` |

`SHA256SUMS.txt` records hashes for all downloads and metadata. After downloading the files into one directory, run `shasum -a 256 -c SHA256SUMS.txt`. Per-architecture checksum files are also included. Metadata records the source commit, runtime/package versions, architecture and package verification outcomes.

The [workflow](../.github/workflows/macos-release.yml) runs core/language, backend and browser regressions. Manual workflow dispatch additionally builds both native architectures on matching macOS 15 runners. Version tags run the same gates, build and test each actual app with its bundled language services and CLI, verify provenance, then create ZIP/DMG packages. Archives are extracted/mounted and checked before upload. The publishing job verifies every uploaded asset's size and GitHub SHA-256 digest before making the draft prerelease visible.

Dependencies and Rust builds use lockfiles. Node 24.12.0 runtime archives are pinned to official SHA-256 checksums and include the archive's license. Language-service packages, fonts and notices are bundled. Linux helper archives inside the macOS app support SSH workspaces only; no Linux or Windows desktop release is produced.

Release maintainers run the workflow manually against `main` before tagging, then push a matching version tag such as `v0.1.0`. A failed draft publication can be rerun without exposing an incomplete release. Existing published stable releases are never replaced by the publishing script.
