# fzv: product and implementation decisions

## Product

- Name: `fzv` (fuzzy viewer).
- Description: The file viewer for agent-driven development.
- Motivation: developers using coding agents in a CLI or desktop application still need to inspect project files and generated artifacts. Opening an IDE solely for that task introduces a separate development environment.
- Initial scope: a local, read-only browser workspace for finding project files and previewing PDF, HTML, images, and text in persistent tabs.
- Initial distribution: one npm package invoked with `npx`; no Python, native addon, secondary download, or install-time build.

## Stack

Node.js 24+, TypeScript strict mode, the Node HTTP/filesystem/CLI APIs, Vanilla TypeScript, CSS, and Vite. Server code is compiled with tsc. Client assets are built before publication. There are no production npm dependencies.

The existing viewer's search scoring is ported with attribution. Browser-native PDF rendering avoids shipping a PDF engine in the initial release. UI components keep separate responsibilities for search, session serialization, preview lifecycle, and workspace interactions.

## Boundaries

All project file and HTML resource requests pass through the same catalog validation. Both lexical and resolved paths must be visible and inside the root. The open descriptor is checked against the resolved file. Directory symlinks are not followed; visible in-root file aliases are allowed only when their preview kind agrees with their target. Files over 20 MiB are not served.

HTML and SVG responses use sandbox/CSP. HTML may run inline scripts but cannot access the parent application's origin or storage. External resources allowed by the existing preview policy can still make requests. The app's own assets are bundled locally.

The HTTP server defaults to loopback, checks request Host names against the bound/local addresses, rejects cross-origin API requests, and supports GET/HEAD only. LAN access is opt-in and unauthenticated.

## Deferred

Editing, IDE integration, content search, file watching, gitignore interpretation, plugins, PDF.js, syntax highlighting, rendered Markdown, and server-side state storage are outside the initial scope. Search can move into a Web Worker if measurements show that scoring interrupts input.
