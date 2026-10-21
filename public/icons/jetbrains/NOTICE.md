# JetBrains New UI file and folder icons

Source: https://github.com/fogio-org/vscode-jetbrains-file-icon-theme
Pinned revision: `26a200cb06e8f339a2ba610036bcc034d863a34a`

The 241 SVG files referenced by the upstream dark/light themes are copied without
modification. `SHA256SUMS` records their source hashes. The derived lookup catalog
in `src/icons/catalog.json` retains all upstream file/folder associations,
lowercases lookup keys, and omits the unused font declarations.

Theme mappings and additions: Copyright (c) 2025 fogio-org, MIT License.
JetBrains icon artwork: Copyright JetBrains s.r.o. and contributors, Apache
License 2.0; original copyright comments are retained in the SVG files.
Full license texts ship in `/licenses/JetBrains-File-Icons-MIT.txt` and
`/licenses/JetBrains-Icons-Apache-2.0.txt`.

Islet adds filename-pattern matching for environment variants, Dockerfiles and
Python/Go tests. Package `__init__.py` files use the Python icon. These are lookup
changes only; the artwork is unchanged. The icons identify file types and folder
roles; Islet retains its own application identity.
