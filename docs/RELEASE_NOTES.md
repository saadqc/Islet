Islet now supports automatic update checks and verified background downloads.

- **Check for Updates** in the application menu and settings, with an **Update** action when a new version is available.
- Download progress and a **Restart and Update / Later** prompt after the update is verified. The app never restarts for an update without your approval.
- All open windows prepare for restart; unsaved documents and unfinished recovery prevent an unsafe update.
- Update signatures are verified against Islet's embedded public key and bind each package to its release version.
- Automatic checks and downloads can be configured in settings, with retry and manual-install guidance for failures or read-only app locations.

Install this release once using the Apple silicon DMG to enable in-app updates from future releases. Older installed versions do not already contain an updater. Update archives, signatures and a manifest are additional release assets used by the updater; the DMG remains the normal installer. macOS 13.5 or newer is required.

The preview remains ad-hoc signed and **not notarized**. Updater signatures do not replace Apple's notarization, and Gatekeeper may still require explicit approval. No paid Apple Developer membership is needed for the update signature.
