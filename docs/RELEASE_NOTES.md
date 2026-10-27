Islet 0.1.8 adds offline Find and Replace for Word documents.

- Press Cmd/Ctrl+F for Find or Cmd/Ctrl+R for Find and Replace. Both are also available from the document view bar and existing document command routing.
- Matches are highlighted and counted. Navigate with previous/next buttons or Enter/Shift+Enter, enable Match case, and close with Escape.
- Replace the active match or use Replace all. Replacements support document Undo/Redo, saving and recovery. The search stays current after replacements and subsequent edits; searching alone does not modify the file.
- Search remains available for read-only documents, while replacement controls are hidden. The controls fit alongside document zoom at narrow window widths.

All search and replacement runs locally using the bundled SuperDoc 1.46.2 editor, without a server or vendor service. DOCX is supported; legacy DOC remains unsupported. Advanced Office formatting is not guaranteed to round trip losslessly.

Install using the Apple silicon DMG or Check for Updates. macOS 13.5 or newer is required. The preview is ad-hoc signed and **not notarized**; automatic-update archives have independent cryptographic signatures. Source archives and dependency notices accompany the AGPLv3 release.
