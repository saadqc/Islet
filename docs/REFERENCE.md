# Islet visual specification

This document records Islet’s Islands theme tokens and public upstream typography references.

## UI theme values

The product palette follows the public [Islands Dark](https://raw.githubusercontent.com/JetBrains/intellij-community/master/platform/platform-resources/src/themes/islands/ManyIslandsDark.theme.json) and [Islands Light](https://raw.githubusercontent.com/JetBrains/intellij-community/master/platform/platform-resources/src/themes/islands/ManyIslandsLight.theme.json) definitions.

| Role | Islands Dark | Islands Light |
| --- | --- | --- |
| Outer window canvas | `#26282C` | `#E9EAEE` |
| Editor surface | `#191A1C` | `#FFFFFF` |
| Tool window surface | `#191A1C` | `#FFFFFF` |
| Alternate tool window surface | `#212326` | `#F7F6F8` |
| Popup surface | `#26282C` | `#FFFFFF` |
| Popup border | `#33353B` | `#E9EAEE` |
| UI text | `#D1D3D9` | `#000000` |
| Muted UI text | `#9FA2A8` | `#5F6269` |
| Brand accent | `#3871E1` | `#3871E1` |
| Active tab surface | `#233558` | `#E3EBFE` |
| Active tab border | `#2E4D89` | `#A7C5FF` |
| Active UI selection | `#2A4371` | `#D0DFFE` |

Both definitions specify `Island.arc=20`, compact arc 16, border arc length 14/10, and border width 6/4. These are Java painting parameters; do not translate an arc diameter directly into a CSS radius. Measure the rendered geometry before fixing CSS values.

Dark inherits `ExperimentalDark` and selects the `Islands Dark` editor scheme. Light inherits `ExperimentalLightWithLightHeader` and selects `Light`. The public [Islands Dark definition](https://raw.githubusercontent.com/JetBrains/intellij-community/master/platform/platform-resources/src/themes/islands/ManyIslandsDark.theme.json) provides a source reference; upstream main can change.

## Editor scheme starting values

Read from `themes/islands/IslandSchemeDark.xml` and `themes/expUI/expUI_lightScheme.xml`. Short hexadecimal values are padded to six digits here. These are general scheme attributes; Python and JavaScript overrides and inherited attributes must be resolved separately.

| Attribute | Dark | Light |
| --- | --- | --- |
| Default editor text | `#BCBEC4` | `#080808` |
| Keyword | `#CF8E6D` | `#0033B3` |
| String | `#6AAB73` | `#067D17` |
| Number | `#2AACB8` | `#1750EB` |
| Line comment | `#7A7E85` | `#8C8C8C`, italic |
| Function declaration | `#56A8F5` | `#00627A` |
| Instance field | `#C77DBB` | `#871094` |
| Metadata | `#B3AE60` | `#9E880D` |
| Caret row | `#1F2024` | `#F5F8FE` |
| Line number | `#4B5059` | `#AEB3C2` |

Do not use the UI-selection color as the code-selection color. For example, the public Light editor scheme explicitly defines selection background `#A6D2FF`.

## Fonts

JetBrains' [typography specification](https://plugins.jetbrains.com/docs/intellij/typography.html) identifies Inter, default UI size 13, and JetBrains Mono for editor text. Its [FontPreferences source](https://raw.githubusercontent.com/JetBrains/intellij-community/master/platform/editor-ui-api/src/com/intellij/openapi/editor/colors/FontPreferences.java) declares default size 13 when JetBrains Mono is selected and line spacing 1.2. Runtime scaling and scheme-specific overrides still require measurement.

For Islet, begin with UI Inter 13/400 and semibold headings; code JetBrains Mono 13/400 with actual italic/bold faces. Match actual reference line height, gutter sizing, ligatures, weight, and antialiasing visually before calling the typography complete.

## Reference capture checklist

Capture these during the first implementation milestone, using disposable fixtures and a fixed reference profile:

- Both themes at a fixed window size and display scale, with default and compact density.
- Python and JavaScript/JSX examples covering syntax and semantic roles.
- Active/inactive tabs, project-tree selection, focus, hover, and unsaved state.
- Completion popup, selected item, type information, documentation, and parameter help.
- Caret, selection, matching braces, search matches, diagnostics, folding, and indentation guides.
- Scrollbar idle/hover/drag, keyboard navigation, trackpad momentum, and long-line scrolling.
- Native window controls, menus, modal dialogs, and keyboard focus order.

Record font family/version, point size, physical glyph dimensions, line-box height, UI scale, window geometry, theme, editor scheme, display resolution, and refresh rate. Distinguish measured values from proposed CSS values in subsequent revisions.
