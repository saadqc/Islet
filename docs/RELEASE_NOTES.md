Islet 0.1.9 improves keyboard navigation, search, language hovers and dialog editing.

- Configure 49 supported actions in Settings → Keyboard shortcuts. Choose system, macOS or Windows/Linux JetBrains-style defaults, record or type mappings, reset them, and see conflicts. Ctrl+Tab / Ctrl+Shift+Tab switch recent editors; platform shortcuts switch adjacent tabs. Existing bookmark and Save aliases remain available.
- Find and Replace in text and DOCX files now use a compact bottom dock. Text search includes match counts, navigation, case sensitivity, whole words and regular expressions. Saving while a search field is focused still saves the document.
- Dialog inputs keep normal copy, cut, paste, selection and undo behavior. Native Edit-menu commands use the focused control instead of always targeting the editor.
- Language hovers render sanitized Markdown and highlighted code, decode documentation entities, and keep long documentation contained and scrollable. Unresolved types can use real in-project definition information; types that remain unresolved show an interpreter/import hint rather than a guessed type.
- Definition/reference jumps with no targets show a small “No reference found” tooltip instead of a modal, including unsupported or standalone files.

Everything continues to run locally without a vendor service. OS-reserved shortcuts such as Alt+Tab may not reach the app. DOCX is supported; legacy DOC remains unsupported, and advanced Office formatting is not guaranteed to round trip losslessly.

Install using the Apple silicon DMG or Check for Updates. macOS 13.5 or newer is required. The preview is ad-hoc signed and **not notarized**; automatic-update archives have independent cryptographic signatures. Source archives and dependency notices accompany the AGPLv3 release.
