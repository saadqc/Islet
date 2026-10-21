# Islet application icon

The original Islet icon depicts a seafoam island above turquoise and cobalt
waves on a midnight navy macOS tile. It was generated with the built-in image
generation tool, then resized and encoded with macOS `sips` and `iconutil`.

The master image is `src-tauri/icons/icon.png` (1024 × 1024, RGBA). The macOS
`icon.icns` includes standard and Retina representations from 16 to 1024 pixels.
Tauri explicitly declares the icon in `src-tauri/tauri.conf.json`.

Both package verification and DMG creation check `CFBundleIconFile`, every
required representation, and the packaged icon's exact bytes against source.
This prevents another release with a missing or stale Dock icon.

## Generation prompt

Create ONE production-quality macOS application icon for Islet, a calm lightweight
code editor. Square 1024x1024 image, genuine transparent background outside the
icon. Main tile is a perfectly front-facing macOS rounded square (squircle),
centered with about 7% transparent margin on all sides, not tilted or in
perspective. Deep midnight navy ceramic tile, subtle polished bevel and gentle
dimensional highlight. Inside, a bold beautifully simple abstract islet: a small
smooth luminous seafoam teal land shape floating above two broad curved ocean
bands in turquoise and cobalt, forming a distinctive balanced symbol that also
quietly suggests layered code lines. Modern refined native macOS visual quality,
tactile but restrained, exceptional clarity at 32 pixels. Large simple forms,
strong silhouette, generous negative space. No letters, no text, no code glyphs,
no brackets, no palm tree, no sun, no scenery, no busy texture, no photographic
landscape, no border decorations, no watermark, no reference to any other brand.
One icon only, no mockup, no contact sheet. Keep corners genuinely transparent,
preserve alpha; any shadow extremely subtle and within canvas.
