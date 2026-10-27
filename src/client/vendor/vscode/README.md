# VS Code UI assets

These assets come from Microsoft VS Code **1.106.0** (MIT license).
Copyright (c) Microsoft Corporation. All rights reserved.
The license is distributed in `licenses/vscode-MIT.txt`.

- `quickInput.css` is the original [Quick Input stylesheet](https://github.com/microsoft/vscode/blob/1.106.0/src/vs/platform/quickinput/browser/media/quickInput.css), unchanged. The application uses its widget, titlebar, input box, and list row classes, with layout adaptations in `src/client/style.css` for a native HTML dialog.
- `tabs.css` selects basic container, tab, label, and active/inactive color rules from [multieditortabscontrol.css](https://github.com/microsoft/vscode/blob/1.106.0/src/vs/workbench/browser/parts/editor/media/multieditortabscontrol.css). Workbench selectors are scoped to `.workspace`; keyboard navigation and closing remain application code.
- `light_modern.jsonc` is the original [Light Modern theme](https://github.com/microsoft/vscode/blob/1.106.0/extensions/theme-defaults/themes/light_modern.json). `theme.css` converts its explicit color entries into `--vscode-*` CSS custom properties. The theme's inherited token colors come from Shiki's bundled VS Code Light+ theme.
- `dark_modern.jsonc` is the original [Dark Modern theme](https://github.com/microsoft/vscode/blob/1.106.0/extensions/theme-defaults/themes/dark_modern.json). Its colors are converted in `theme.css` under `:root[data-theme='dark']`. Inherited list/input colors are taken from VS Code's [listColors.ts](https://github.com/microsoft/vscode/blob/1.106.0/src/vs/platform/theme/common/colors/listColors.ts) and [inputColors.ts](https://github.com/microsoft/vscode/blob/1.106.0/src/vs/platform/theme/common/colors/inputColors.ts) dark defaults. Syntax token colors use Shiki's bundled VS Code Dark+ theme.

## Diff algorithm

`src/` mirrors the upstream `src/vs` layout for the [default lines diff computer](https://github.com/microsoft/vscode/tree/1.106.0/src/vs/editor/common/diff/defaultLinesDiffComputer) and the files it imports. Files in `editor/common/diff/defaultLinesDiffComputer/`, `editor/common/diff/linesDiffComputer.ts`, `editor/common/core/position.ts`, `editor/common/core/range.ts`, and `editor/common/core/ranges/` are original except for these changes:

- Type-only imports use `import type` / `type` specifiers, as required by the client's `verbatimModuleSyntax`.
- `removeShortMatches` in `heuristicSequenceOptimizations.ts` prefixes its two unused parameters with `_`.

Reduced files:

- `editor/common/diff/rangeMapping.ts` omits `TextEdit` conversions (`toTextEdit`, `fromEdit`, `fromEditJoin`) and the legacy `lineRangeMappingFromChange`.
- `editor/common/core/text/abstractText.ts` keeps only the line count and line length used by `lineRangeMappingFromRangeMappings`, with `ArrayText` implementing them.
- `base/common/arrays.ts`, `arraysFind.ts`, `assert.ts`, `errors.ts`, and `map.ts` contain only the declarations the diff code imports, copied unchanged. `onUnexpectedError` reports to the console instead of VS Code's error handler, and the unused `CompareResult` namespace is omitted.

`src/client/diff/model.ts` ports `UnchangedRegion.fromDiffs` from [diffEditorViewModel.ts](https://github.com/microsoft/vscode/blob/1.106.0/src/vs/editor/browser/widget/diffEditor/diffEditorViewModel.ts) and `computeRangeAlignment` from [diffEditorViewZones.ts](https://github.com/microsoft/vscode/blob/1.106.0/src/vs/editor/browser/widget/diffEditor/components/diffEditorViewZones/diffEditorViewZones.ts) without editor view-zone heights, and follows the decoration rules in [diffEditorDecorations.ts](https://github.com/microsoft/vscode/blob/1.106.0/src/vs/editor/browser/widget/diffEditor/components/diffEditorDecorations.ts). `src/client/diff.css` adapts class rules from the diff editor's [style.css](https://github.com/microsoft/vscode/blob/1.106.0/src/vs/editor/browser/widget/diffEditor/style.css) and uses the `diffEditor.*` color defaults from [editorColors.ts](https://github.com/microsoft/vscode/blob/1.106.0/src/vs/platform/theme/common/colors/editorColors.ts).

## Side bar and Source Control

`src/client/sidebar.css` adapts layout and color rules from [activitybarpart.css](https://github.com/microsoft/vscode/blob/1.106.0/src/vs/workbench/browser/parts/activitybar/media/activitybarpart.css), [activityaction.css](https://github.com/microsoft/vscode/blob/1.106.0/src/vs/workbench/browser/parts/activitybar/media/activityaction.css), [sidebarpart.css](https://github.com/microsoft/vscode/blob/1.106.0/src/vs/workbench/browser/parts/sidebar/media/sidebarpart.css), and [scm.css](https://github.com/microsoft/vscode/blob/1.106.0/src/vs/workbench/contrib/scm/browser/media/scm.css), and uses the `gitDecoration.*` color defaults from the git extension's [package.json](https://github.com/microsoft/vscode/blob/1.106.0/extensions/git/package.json). `src/client/scm.ts` follows the status letters, labels, colors, resource groups, and count badge in the git extension's [repository.ts](https://github.com/microsoft/vscode/blob/1.106.0/extensions/git/src/repository.ts). `src/client/explorer.ts` applies decorations like the git extension's [decorationProvider.ts](https://github.com/microsoft/vscode/blob/1.106.0/extensions/git/src/decorationProvider.ts) (later resource groups win) and bubbles them to folders like [decorationsService.ts](https://github.com/microsoft/vscode/blob/1.106.0/src/vs/workbench/services/decorations/browser/decorationsService.ts), whose folder badge is the `circle-filled` codicon at 40% opacity. Explorer rows use the tree widget's 8px indent, twistie, and indent-guide geometry and the `tree.indentGuidesStroke` defaults.

All assets are bundled locally. Updating or building the package requires no download from VS Code at runtime.
