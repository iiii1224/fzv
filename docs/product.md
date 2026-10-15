# fzv: product and implementation decisions

## Product

- Name: `fzv` (fuzzy viewer).
- Description: The file viewer for agent-driven development.
- Motivation: developers using coding agents in a CLI or desktop application still need to inspect project files and generated artifacts. Opening an IDE solely for that task introduces a separate development environment.
- Initial scope: a local, read-only browser workspace for finding project files and previewing PDF, HTML, images, and text in persistent tabs.
- Search opens as a modal with `/`, listing immediate root entries when empty. Directory selection fills its path and lists its immediate children; other queries fuzzy-match file and directory paths. File selection closes the modal. `r` reloads the active preview.
- `f` shows Vimium-style hints for visible links and controls. Typing a label focuses and activates its target; Escape cancels and Backspace edits the prefix. `hjkl` scroll the active preview, `gg` goes to the top, and `G` goes to the bottom. Editable fields, composition, and modifier shortcuts retain their native behavior.
- A toolbar button switches between Light Modern and Dark Modern. The initial theme follows the system; manual selection is saved per origin. Syntax tokens carry both Light+ and Dark+ colors, so changing themes does not refetch or recreate previews.
- HTML and Markdown default to Viewer and offer Viewer / Source buttons. Other text opens in Source only. Source displays exact text with line numbers and syntax highlighting. Each tab retains its mode while switching tabs or reloading its file.
- Initial distribution: one npm package invoked with `npx`; no Python, native addon, secondary download, or install-time build.

## Stack

Node.js 24+, TypeScript strict mode, the Node HTTP/filesystem/CLI APIs, Vanilla TypeScript, CSS, and Vite. Server code is compiled with tsc. Client assets are built before publication. There are no production npm dependencies.

The existing viewer's search scoring is ported with attribution. Browser-native PDF rendering avoids shipping a PDF engine in the initial release. UI components keep separate responsibilities for search, session serialization, preview lifecycle, and workspace interactions.

VS Code Codicons, Marked, DOMPurify, and Shiki are development dependencies bundled into the client at build time. Icons, fonts, TextMate grammars, and the VS Code Light+/Dark+ syntax themes are served locally. Shiki uses its JavaScript regex engine and creates text nodes with token colors; it does not inject source as HTML or loosen the app CSP. Unknown formats and sources over 512 Ki characters remain plain text to keep the UI responsive. Source line endings are preserved.

Tabs use a scoped subset of VS Code's tab CSS. The search popup uses its Quick Input CSS, with application-specific dialog positioning and event handling. Official Light Modern and Dark Modern theme colors are converted to CSS custom properties. Pinned source links and adaptation details are in `src/client/vendor/vscode/README.md`. Third-party licenses are included in the package.

Marked output is sanitized before insertion; local Markdown image and link paths use the existing validated asset route. External Markdown images remain blocked by the app CSP.

## Boundaries

All project file and HTML resource requests pass through the same catalog validation. Both lexical and resolved paths must be visible and inside the root. The open descriptor is checked against the resolved file. Directory symlinks are not followed; visible in-root file aliases are allowed only when their preview kind agrees with their target. Files over 20 MiB are not served.

HTML and SVG responses use sandbox/CSP. HTML may run inline scripts but cannot access the parent application's origin or storage. External resources allowed by the existing preview policy can still make requests. The app's own assets are bundled locally.

HTML rendering injects the same self-contained navigation handler used by the main application. Hints and scrolling operate inside the sandbox; only `/` and `r` shortcut messages cross to the parent. The parent accepts these messages only from the active HTML viewer's opaque frame. The bridge does not expose project data or storage. Browser-native PDF viewers handle focused keyboard input themselves.

The HTTP server defaults to loopback, checks request Host names against the bound/local addresses, rejects cross-origin API requests, and supports GET/HEAD only. LAN access is opt-in and unauthenticated.

## Deferred

Editing, IDE integration, content search, file watching, gitignore interpretation, plugins, PDF.js, and server-side state storage are outside the initial scope. Search can move into a Web Worker if measurements show that scoring interrupts input.
