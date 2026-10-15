# Third-party notices

## fzf

`src/client/search.ts` adapts the FuzzyMatchV2 approach from fzf, via the original
project file viewer in `paper/tex/serve_viewer.py` supplied by the project owner.
The implementation is a TypeScript port of that viewer's JavaScript scorer;
it is not the fzf binary or an exact compatibility implementation.

Upstream: https://github.com/junegunn/fzf
Algorithm: https://github.com/junegunn/fzf/blob/master/src/algo/algo.go
License: https://github.com/junegunn/fzf/blob/master/LICENSE

The MIT License (MIT)

Copyright (c) 2013-2026 Junegunn Choi

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## VS Code Codicons

UI icons and the unmodified icon font come from Microsoft VS Code Codicons.
Copyright (c) Microsoft Corporation. All rights reserved.

Upstream: https://github.com/microsoft/vscode-codicons
Icons and content: Creative Commons Attribution 4.0 International (CC BY 4.0).
Code: MIT.
License copies: `licenses/codicons-CC-BY-4.0.txt` and `licenses/codicons-MIT.txt`.
The icons and font are bundled locally; no icon designs have been changed.

## Marked

Markdown rendering uses Marked, bundled into the browser client.
Copyright (c) 2018+, MarkedJS (https://github.com/markedjs/).
Copyright (c) 2011-2018, Christopher Jeffrey (https://github.com/chjj/).

Upstream: https://github.com/markedjs/marked
License: MIT; the upstream license file also includes the original Markdown notice.
License copy: `licenses/marked.txt`.

## DOMPurify

Rendered Markdown is sanitized with DOMPurify, bundled into the browser client.
Copyright (c) Cure53 and other contributors.

Upstream: https://github.com/cure53/DOMPurify
DOMPurify is dual-licensed under Apache-2.0 and MPL-2.0; fzv distributes it under Apache-2.0.
License copy: `licenses/dompurify-APACHE-2.0.txt`.

## Visual Studio Code

Tabs, Quick Input styling, and the Light Modern / Dark Modern UI palettes use assets from
Microsoft Visual Studio Code 1.106.0, adapted to the browser workspace.
Copyright (c) Microsoft Corporation. All rights reserved.

Upstream: https://github.com/microsoft/vscode/tree/1.106.0
License: MIT. License copy: `licenses/vscode-MIT.txt`.
Source paths and modifications: `src/client/vendor/vscode/README.md`.

## Shiki and syntax highlighting dependencies

Source highlighting uses Shiki, its JavaScript regex engine, TextMate grammars,
and the VS Code Light+ / Dark+ themes, bundled locally into the browser client.
Copyright (c) 2021 Pine Wu; Copyright (c) 2023 Anthony Fu.

Upstream: https://github.com/shikijs/shiki
License: MIT. Original license and dependency license copies are included under
`licenses/shiki/`. This includes Microsoft's vscode-textmate implementation,
Oniguruma-to-ES and its regex dependencies, and the supporting utilities.
