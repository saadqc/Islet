# GitHub Codespaces plugin

GitHub Codespaces is bundled with Islet and **off by default**. Enable it in **Settings → Plugins**, then choose **Manage Codespaces…**. While disabled, Islet makes no GitHub CLI requests, polls no Codespaces, and opens no Codespaces connections. Disabling closes Islet-owned connections and local forwards, while retaining recovery buffers and leaving cloud environments running.

Install GitHub CLI and sign in with `gh auth login` outside Islet. The plugin finds `gh` automatically; Settings also accepts an absolute executable path. Authentication remains with GitHub CLI. Islet does not save tokens in settings, manifests, or logs. The manager displays installation or login guidance when needed and polls only while that screen is open.

The list distinguishes the **GitHub state** from the **editor connection**. Creating a Codespace requires a separate billing confirmation. Start acts on the selected exact ID. Stop and delete require entering that ID and a recent safety check, repeated immediately before the action. Unsaved buffers, pending or uncertain saves, uncommitted or unpushed Git work, unknown Git state, or a missing editor-window response block the action. Save and push work using your normal tools first; Islet does not commit or push on your behalf.

## Folders and intelligence

Discover the default development folder, choose another absolute directory, or browse remote folders. Adding a Codespace folder preserves the local and SSH roots already in the window. Provider identity includes the exact Codespace ID, so equal paths on different hosts remain separate.

The connection uses `gh codespace ssh` and Islet’s existing remote file and language-service protocol. A new installation needs explicit consent to place the versioned helper, Node runtime and language services in the remote user cache. An existing compatible helper folder can be selected instead. Setup needs no root permission or permanent daemon. Reconnect preserves buffers and compares remote revisions before saving. The **Copy SSH Command** action copies a command for your external terminal; Islet does not embed a terminal.

## Local forwarding

**Codespace port** uses GitHub CLI forwarding. **Advanced host and port over SSH** can reach another destination inside the Codespace network. Both bind only to `127.0.0.1`, require an available local port, and expire after the chosen duration (1–1440 minutes). A conflict leaves unrelated listeners untouched.

Only forwards created by Islet appear as owned forwards. Stopping one or disabling the plugin terminates its owned process group. Saved mappings contain destinations and ports, not credentials. Each has an **Enabled** choice; older mappings without that choice default off. They never start automatically: choose **Restore Enabled Mappings** after enabling the plugin. Disabled mappings are skipped. Failed restorations are reported individually, and saved mappings can be forgotten.

## Validation

`npm test` covers the renderer’s disabled gate and stale request rejection. `npm run test:backend` covers settings, bounded CLI calls, lifecycle safety, ownership, expiry, sanitization, and the actual adapter against an isolated loopback SSH server. That fixture verifies files, conditional saves, mixed-root search, Python intelligence, reconnect, and both forwarding modes. `npm run test:ui` includes mocked cloud workflows for consent, safety and forwarding. A live read-only check verified CLI detection, authentication and the Codespaces list. The available cloud environment was stopped and was left unchanged. Full live helper bootstrap, cloud forwarding, lifecycle and billing behavior remain unverified; they require a separate disposable account-approved test.
