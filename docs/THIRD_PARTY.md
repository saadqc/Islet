# Third-party material

Islet's application identity and icons use its own name and the Lucide icon library. The Islands palette follows public upstream theme definitions; no IDE binaries or artwork are redistributed.

Inter and JetBrains Mono are bundled through Fontsource, under the SIL Open Font License. Their complete notices ship at `public/licenses/Inter-OFL.txt` and `public/licenses/JetBrains-Mono-OFL.txt` and are copied into the frontend distribution. CodeMirror, React and highlight.js notices are included alongside them.

The bundled Node runtime includes `NODE-LICENSE`. Bundled basedpyright, TypeScript, typescript-language-server and their dependencies retain their package license files in `resources/runtime/node_modules`; remote archives retain the same licenses. Exact versions are recorded in `resources/runtime/versions.json` and dependency lockfiles.

Additional dependencies include Tauri, CodeMirror/Lezer, markdown-it, DOMPurify, Lucide, Vite and their transitive packages. Refer to the lockfiles and original package distributions for the complete version/license provenance. No user project dependencies are copied into Islet's distribution.
