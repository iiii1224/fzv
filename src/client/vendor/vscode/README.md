# VS Code UI assets

These assets come from Microsoft VS Code **1.106.0** (MIT license).
Copyright (c) Microsoft Corporation. All rights reserved.
The license is distributed in `licenses/vscode-MIT.txt`.

- `quickInput.css` is the original [Quick Input stylesheet](https://github.com/microsoft/vscode/blob/1.106.0/src/vs/platform/quickinput/browser/media/quickInput.css), unchanged. The application uses its widget, titlebar, input box, and list row classes, with layout adaptations in `src/client/style.css` for a native HTML dialog.
- `tabs.css` selects basic container, tab, label, and active/inactive color rules from [multieditortabscontrol.css](https://github.com/microsoft/vscode/blob/1.106.0/src/vs/workbench/browser/parts/editor/media/multieditortabscontrol.css). Workbench selectors are scoped to `.workspace`; keyboard navigation and closing remain application code.
- `light_modern.jsonc` is the original [Light Modern theme](https://github.com/microsoft/vscode/blob/1.106.0/extensions/theme-defaults/themes/light_modern.json). `theme.css` converts its explicit color entries into `--vscode-*` CSS custom properties. The theme's inherited token colors come from Shiki's bundled VS Code Light+ theme.
- `dark_modern.jsonc` is the original [Dark Modern theme](https://github.com/microsoft/vscode/blob/1.106.0/extensions/theme-defaults/themes/dark_modern.json). Its colors are converted in `theme.css` under `:root[data-theme='dark']`. Inherited list/input colors are taken from VS Code's [listColors.ts](https://github.com/microsoft/vscode/blob/1.106.0/src/vs/platform/theme/common/colors/listColors.ts) and [inputColors.ts](https://github.com/microsoft/vscode/blob/1.106.0/src/vs/platform/theme/common/colors/inputColors.ts) dark defaults. Syntax token colors use Shiki's bundled VS Code Dark+ theme.

All assets are bundled locally. Updating or building the package requires no download from VS Code at runtime.
