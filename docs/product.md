# fzv: product and implementation decisions

## Product

- Name: `fzv` (fuzzy viewer).
- Description: The file viewer for agent-driven development.
- Motivation: developers using coding agents in a CLI or desktop application still need to inspect project files and generated artifacts. Opening an IDE solely for that task introduces a separate development environment.
- Initial scope: a local, read-only browser workspace for finding project files and previewing PDF, HTML, images, and text in persistent tabs.
- Search opens as a modal with `/`, listing immediate root entries when empty. Directory selection fills its path and lists its immediate children; other queries fuzzy-match file and directory paths. File selection closes the modal. `r` reloads the active preview.
- `?` opens keyboard help. `f` shows Vimium-style hints for visible links and controls, including numbered editor-group focus buttons when split. Selecting a group keeps its selected tab and moves keyboard focus to it. Typing a label focuses and activates its target; Escape cancels and Backspace edits the prefix. `hjkl` scroll the active preview, `gg` goes to the top, and `G` goes to the bottom. Editable fields, composition, and modifier shortcuts retain their native behavior. HTML previews run the same navigation bindings inside their sandbox; pressing `f` while an HTML preview has focus opens workspace hints, and choosing the HTML surface then opens its local hints.
- A toolbar button switches between Light Modern and Dark Modern. The initial theme follows the system; manual selection is saved per origin. Syntax tokens carry both Light+ and Dark+ colors, so changing themes does not refetch or recreate previews.
- HTML and Markdown default to Viewer and offer Viewer / Source buttons. Other text opens in Source only. Source displays exact text with line numbers and syntax highlighting. Each tab retains its mode while switching tabs or reloading its file.
- Source views copy the complete original text, the active file path has a nearby copy control, and the active file can be downloaded from the toolbar.
- Tabs support native drag reordering, four-direction splits, moving between groups and Ctrl-drag (Option-drag on macOS) copying. Each group has its own selected tab and toolbar; search opens files in the focused group. Split buttons duplicate the current file. Sashes resize by pointer or arrow keys and reset to equal sizes on double-click. Empty groups close automatically; up to 32 groups are supported.
- Initial distribution: one npm package invoked with `npx`; no Python, native addon, secondary download, or install-time build.

## Stack

Node.js 24+, TypeScript strict mode, the Node HTTP/filesystem/CLI APIs, Vanilla TypeScript, CSS, and Vite. Server code is compiled with tsc. Client assets are built before publication. There are no production npm dependencies.

The existing viewer's search scoring is ported with attribution. PDF.js Viewer components render PDFs in the application's own scroll container, sharing Vim navigation with the other previews. PDF.js is loaded on the first PDF preview; text selection, links, width fitting, zoom and document search are supported. UI components keep separate responsibilities for search, session serialization, preview lifecycle, and workspace interactions.

VS Code Codicons, Marked, DOMPurify, and Shiki are development dependencies bundled into the client at build time. Icons, fonts, TextMate grammars, and the VS Code Light+/Dark+ syntax themes are served locally. Shiki uses its JavaScript regex engine and creates text nodes with token colors; it does not inject source as HTML or loosen the app CSP. Unknown formats and sources over 512 Ki characters remain plain text to keep the UI responsive. Source line endings are preserved.

Tabs use a scoped subset of VS Code's tab CSS. The search popup uses its Quick Input CSS, with application-specific dialog positioning and event handling. Official Light Modern and Dark Modern theme colors are converted to CSS custom properties. Pinned source links and adaptation details are in `src/client/vendor/vscode/README.md`. Third-party licenses are included in the package.

The workspace stores groups in a binary split tree with orientation and size ratios. Group headers and preview panes share one stable positioned host: moving a tab updates its ownership and geometry without reparenting its preview DOM, preserving sandboxed HTML state and loaded PDF instances. A drag overlay covers iframe surfaces. Version 2 local sessions persist the layout, focused group, per-group tab order and selection, and preview modes; legacy version 1 sessions migrate into one group. Missing files are omitted and empty branches collapse on restore.

On startup, the saved tab paths are resolved through the same validated project catalog before the full search index is ready. This lets the workspace restore its tabs while the broader file scan continues.

Marked output is sanitized before insertion; local Markdown image and link paths use the existing validated asset route. External Markdown images remain blocked by the app CSP.

PDF.js is a pinned development dependency, bundled into the client. Its worker, CMaps, standard fonts, image/color decoders and ICC profile are included in the built package and served locally. Only the UI policy permits WebAssembly compilation and same-origin workers; JavaScript eval and inline scripts remain blocked. The HTML preview policy is unchanged. PDF scripts, interactive forms, annotation editing and XFA are disabled. External PDF links open separately with `noopener noreferrer`; encrypted documents use the existing Open separately fallback. Closing or reloading a PDF aborts its requests and destroys its worker and observers.

## Boundaries

All project file and HTML resource requests pass through the same catalog validation. Both lexical and resolved paths must be visible and inside the root. The open descriptor is checked against the resolved file. Directory symlinks are not followed; visible in-root file aliases are allowed only when their preview kind agrees with their target. Files over 20 MiB are not served.

HTML and SVG responses use sandbox/CSP. HTML may run inline scripts but cannot access the parent application's origin or storage. External resources allowed by the existing preview policy can still make requests. The app's own assets are bundled locally.

HTML rendering injects the same self-contained navigation handler used by the main application. Scrolling operates inside the sandbox; fixed `/`, `r`, and workspace-hint `f` shortcut messages and a focus notification cross to the parent. The parent accepts focus notifications only from visible HTML viewers' opaque frames, and shortcut messages only from the focused group's active HTML viewer. The parent sends fixed scroll and local-hints commands to HTML frames; the injected handler accepts these only from its parent window. The bridge does not expose project data or storage. PDF rendering runs in the main application's DOM, so its focused keyboard events use the existing navigation handler directly. PDF search and zoom shortcuts apply only to the focused group's active tab. PDF bytes are fetched through the same validated file route as other project files.

The HTTP server defaults to loopback, checks request Host names against the bound/local addresses, rejects cross-origin API requests, and supports GET/HEAD only. LAN access is opt-in and unauthenticated.

## Deferred

Editing, IDE integration, project-wide content search, file watching, gitignore interpretation, plugins, and server-side state storage are outside the initial scope. Search can move into a Web Worker if measurements show that scoring interrupts input.
