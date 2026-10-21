Islet fixes file access stopping after macOS sleep, lock or a long pause.

- The local file service now follows the app's lifetime instead of expiring when sleep delays its heartbeat. Open folders, file access and recovery snapshots remain available after waking.
- Remote SSH helpers retain their bounded lease for abandoned-session cleanup.
- Unexpected file-service failures display a clear recovery instruction instead of a raw “Broken pipe” error. Open editor buffers remain available to copy; interrupted saves are never automatically replayed.

Install using the Apple silicon DMG, or use **Check for Updates** in Islet 0.1.2 or newer. If an older version's file service has already stopped, copy any unsaved changes before restarting. Available updates download automatically when enabled and install only after an explicit restart, with unsaved-work protection. macOS 13.5 or newer is required.

The preview remains ad-hoc signed and **not notarized**. Update signatures are verified independently and require no paid Apple Developer membership.
