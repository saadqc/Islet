Islet 0.1.7 adds offline spreadsheet and Word document editing, plus file-management improvements.

- Edit CSV, XLS and XLSX using locally bundled Jspreadsheet CE and SheetJS CE. Create, rename, duplicate and delete worksheets, with structural Undo/Redo. CSV also has a source view that preserves identifiers, delimiters and line endings.
- Open, edit, save and recover DOCX documents using SuperDoc 1.46.2. Pages are centered with document margins intact. A bottom zoom bar provides 25–400%, Fit width, reset and Cmd/Ctrl +/−/0 shortcuts. Telemetry is disabled; editing requires no vendor service.
- Open File and Finder Open With open only the selected file, without adding its parent folder as a project. CSV, Excel and Word files have distinct icons. The app advertises file associations without changing your system defaults.
- Create files and folders from the project tree. Choose single- or double-click folder expansion in Settings.
- Drop files/folders onto project folders to copy them; drop onto the editor to open files or add folders. Local file/folder copy and paste uses Finder-compatible file URLs.
- Download remote files through Save As; download remote folders as ZIPs prepared on the helper host. Transfers provide progress/cancellation, bounded chunks, checksums and staged writes. Existing names are not silently overwritten. Reinstall older SSH helpers with Setup Remote Helper for this version.
- Original Office bytes are verified and backed up before replacement, and ordinary revision/conflict protections remain in place.

Spreadsheet formulas are preserved as editable text and are not calculated. Legacy XLS formula saves require Save XLSX Copy. Charts, pivots, macros and advanced Office formatting are not guaranteed to round trip losslessly. Legacy DOC is unsupported.

Install using the Apple silicon DMG or Check for Updates. macOS 13.5 or newer is required. The preview is ad-hoc signed and **not notarized**; automatic-update archives have independent cryptographic signatures. Islet application source is distributed under AGPLv3, with source archives and dependency notices supplied alongside this release.
