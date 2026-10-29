Islet 0.1.10 fixes SSH reconnection when reopening or returning to a workspace window.

- The Reconnect button now restores SSH access and reattaches remote folders before refreshing their contents. The folder context menu uses the same recovery flow.
- SSH folders reconnect automatically when a workspace opens or its window regains focus. Folders and windows on the same host share one connection attempt and reuse a healthy connection.
- Failed connection attempts can be retried. Unresponsive channels are retired, cancelled startups stay cancelled, and late events from an old channel cannot disconnect its replacement.
- Reconnection restores file watches and language services while preserving unsaved edits and checking remote file revisions. It never retries a save automatically. A missing remote folder no longer blocks other folders on that host.
- Connection errors wrap within the Project sidebar and provide a clear Reconnect button.

Everything continues to run locally without a vendor service. Existing SSH authentication and remote-helper setup requirements still apply; setting up or upgrading a remote helper requires approval. DOCX is supported; legacy DOC remains unsupported, and advanced Office formatting is not guaranteed to round trip losslessly.

Install using the Apple silicon DMG or Check for Updates. macOS 13.5 or newer is required. The preview is ad-hoc signed and **not notarized**; automatic-update archives have independent cryptographic signatures. Source archives and dependency notices accompany the AGPLv3 release.
