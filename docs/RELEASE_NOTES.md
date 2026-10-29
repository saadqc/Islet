Islet 0.1.12 fixes text paste, checkbox alignment and SSH helper recovery.

- Fixed the text-paste permission error on macOS. Standard copy/cut/paste shortcuts use native clipboard events; text-editor context-menu commands and spreadsheet paste use the desktop clipboard bridge. Cut preserves the selected text if copying fails.
- Fixed Updates settings checkboxes appearing above their labels. Checkbox labels stay inline, including at narrow window widths and in both themes.
- SSH connections detect missing or incomplete versioned helpers before launching them. The folder now offers Set Up SSH Helper, with an Install and Reconnect action and retryable errors. SSH folder context menus also offer Set Up / Upgrade SSH Helper. Installation requires explicit approval and preserves unsaved buffers.

Everything continues to run locally without a vendor service. DOCX is supported; legacy DOC remains unsupported, and advanced Office formatting is not guaranteed to round trip losslessly.

Install using the Apple silicon DMG or Check for Updates. macOS 13.5 or newer is required. The preview is ad-hoc signed and **not notarized**; automatic-update archives have independent cryptographic signatures. Source archives and dependency notices accompany the AGPLv3 release.
