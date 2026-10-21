# Third-party material

Islet retains its own application identity. Interface actions use Lucide. File and folder icons use the JetBrains New UI file icon theme from [fogio-org](https://github.com/fogio-org/vscode-jetbrains-file-icon-theme), pinned to revision `26a200cb06e8f339a2ba610036bcc034d863a34a`. The complete dark/light asset set is bundled locally, with the theme's MIT license and the artwork's Apache 2.0 license in `public/licenses/`. Original SVG copyright comments are retained; `public/icons/jetbrains/NOTICE.md` records provenance and mapping changes, and `SHA256SUMS` records asset hashes. The Islands palette follows public upstream theme definitions.

Inter and JetBrains Mono are bundled through Fontsource, under the SIL Open Font License. Their complete notices ship at `public/licenses/Inter-OFL.txt` and `public/licenses/JetBrains-Mono-OFL.txt` and are copied into the frontend distribution. CodeMirror, React and highlight.js notices are included alongside them.

The bundled Node runtime includes `NODE-LICENSE`. Bundled basedpyright, TypeScript, typescript-language-server and their dependencies retain their package license files in `resources/runtime/node_modules`; remote archives retain the same licenses. Exact versions are recorded in `resources/runtime/versions.json` and dependency lockfiles.

Additional dependencies include Tauri, CodeMirror/Lezer, markdown-it, DOMPurify, Lucide, Vite and their transitive packages. Refer to the lockfiles and original package distributions for the complete version/license provenance. No user project dependencies are copied into Islet's distribution.
