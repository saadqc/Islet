# Automatic updates

Islet checks its GitHub update channel and downloads available updates automatically when automatic updates are enabled. **Check for Updates** is also available in the app menu and settings. The update status shows download progress and an **Update** or **Restart and Update** action. A downloaded update does not restart the app until the user agrees. **Later** keeps the current session running.

The first updater-enabled release must be installed manually from its Apple silicon DMG. Earlier versions do not contain an updater. This channel currently distributes the macOS Apple silicon preview; Linux archives bundled inside Islet are remote-workspace helpers, not desktop updates.

Before installation, every open Islet window must be ready to restart. Unsaved documents must be saved or resolved and workspace recovery must finish. A failed or unresponsive preparation cancels installation. Running from a read-only disk image or a location that cannot be updated requires installing the DMG into a writable Applications location.

## Trust and signing

Tauri verifies each update with the public key embedded in Islet. The signature also binds the artifact to its announced version. Invalid signatures, altered packages, version mismatches and downgrades are rejected. Download and installation use the configured HTTPS GitHub channel; the renderer cannot supply arbitrary update URLs.

Updater signing is independent from Apple's code signing. This project uses ad-hoc macOS signing and does not require paid Apple membership for its update signature. It is not notarized, so macOS may still request approval to open the app. Do not disable Gatekeeper to enable updates.

The update archive is generated only after the final app has been ad-hoc signed and tested. CI compares its extracted files, permissions and symlinks with the app validated inside the DMG, checks the icon and application identity, and executes the bundled runtime. Release publication verifies uploaded assets before advancing the update feed.

## Release configuration

The public key is committed under `plugins.updater.pubkey` in `src-tauri/tauri.conf.json`. `requireSignedVersion` must remain enabled. The private key and its password are configured only as these repository Actions secrets:

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

Keep an independent secure backup of both outside the repository. Never print them, include them in artifacts, put them in a project `.env`, or commit them. Losing the signing key prevents issuing updates trusted by existing installations. Replacing the key without a supported transition requires users to install a new trusted version manually.

Version releases publish the DMG and the signed update files. The dedicated [update channel](https://github.com/saadqc/Islet/releases/tag/updater) hosts only `latest.json`, pointing to immutable versioned artifacts. It is a prerelease so it does not displace normal user downloads. The publishing job runs serially and compares semantic versions before replacing the feed; a slow older build cannot roll the channel backward.

The publish script creates a missing update channel only after the first complete version release is public. Network errors, permissions failures, malformed existing feeds and uploaded digest mismatches fail closed. A failed feed update can be retried after correcting the cause without replacing the already published application assets.

## Validation

Run `node --test tests/release-helpers.test.mjs tests/updater-release.test.mjs` for the release contract, real Tauri CLI signature compatibility, tamper detection, signed-version binding, architecture/URL restrictions, artifact provenance, publication order and rollback prevention. App-level tests separately exercise update status, restart preparation and failure/retry behavior.

A real update rehearsal should use two isolated app copies and test workspace restoration, modified-download rejection, read-only installation failure and restart cancellation. Never point an update test at an existing user's installed app or application data.
