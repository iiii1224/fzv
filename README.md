# fzv

[![npm](https://img.shields.io/npm/v/@aaa_iii/fzv)](https://www.npmjs.com/package/@aaa_iii/fzv)
[![CI](https://github.com/iiii1224/fzv/actions/workflows/ci.yml/badge.svg)](https://github.com/iiii1224/fzv/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](https://github.com/iiii1224/fzv/blob/main/LICENSE)

English | [日本語](https://github.com/iiii1224/fzv/blob/main/README.ja.md)

A read-only browser viewer for finding and reading the files your coding agent produces, without opening an IDE. Switch between PDFs, HTML, images, source code, and Office documents in the same tabs and split panes.

```console
$ npx --yes @aaa_iii/fzv@latest --watch

  fzv 0.2.0
  Project  ~/dev/fzv
  Viewer   http://127.0.0.1:29814/
  Office   ibisOffice (~/.local/bin/ibisOffice)

  Press Ctrl+C to stop.
```

Open the printed URL in your browser and press `/` to find a file.

## Why fzv

fzv is built for keeping an eye on generated output while you keep directing an agent from the terminal.

- **One `npx` command**: nothing is downloaded at runtime. The UI, PDF.js, and fonts ship inside the package, and there is no install-time build.
- **One workflow for every format**: PDFs, Markdown, and images all use the same tabs, splits, and keys.
- **Keyboard-driven**: `/` for fuzzy search, `hjkl` to scroll, `f` to jump to any link or button on screen.
- **Never modifies files**: there is no write path, and requests outside the project root are rejected.

**What it does not do**: edit files, search file contents, honor `.gitignore`, preview legacy Office formats (`.doc`, `.xls`, `.ppt`), or serve with authentication. Pair it with an editor or `rg` for editing and full-text search.

## Requirements

- Node.js 24 or later
- A current desktop browser
- For Office documents only: [ibisOffice](https://github.com/ibisjp/ibis-office) or [LibreOffice](https://www.libreoffice.org/)

## Start

```bash
# Open the current directory
npx --yes @aaa_iii/fzv@latest

# Watch for changes and refresh the search index and open tabs
npx --yes @aaa_iii/fzv@latest --watch

# Open another directory
npx --yes @aaa_iii/fzv@latest --root ~/projects/example
```

Press `Ctrl+C` to stop.

The port is derived from the project path, in the range 20000–29999. The same project always gets the same URL, so the tabs, splits, and theme saved in your browser come back on the next run. If that port is taken, fzv starts on a free port and prints a warning. The URL then differs, so the previous session is not restored.

## Usage

### Find files

Press `/` or click "Find a file" to open search. With an empty query, it lists the files and directories at the project root. Selecting a directory moves into it; typing fuzzy-matches paths. Space-separated terms narrow results to paths that contain all of them.

The file list is rescanned in the background each time search opens, so files created after the page loaded show up too. While the rescan runs, you can keep searching the previous list.

Hidden files and directories, `node_modules`, and `__pycache__` are not listed.

### Tabs and splits

Files open in tabs. Drag a tab to reorder it, or drop it on any edge to split the view. Hold `Ctrl` (`Option` on macOS) while dragging to copy the tab instead of moving it. Up to 32 split panes are supported, and the dividers can be dragged to resize them.

Open tabs, the split layout, and view modes are saved in the browser and restored on reload.

### Supported formats

| Format   | Extensions                                                                                             | View                                             |
| -------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| PDF      | `.pdf`                                                                                                 | Text selection, in-document search, zoom         |
| HTML     | `.html` `.htm`                                                                                         | Rendered in a sandbox; switchable to source      |
| Markdown | `.md`                                                                                                  | Rendered; switchable to source                   |
| Image    | `.png` `.jpg` `.jpeg` `.gif` `.webp` `.avif` `.bmp` `.svg` `.ico`                                      | Zoom and pan                                     |
| Office   | `.docx` `.xlsx` `.pptx`                                                                                | Converted to PDF                                 |
| Text     | `.ts` `.js` `.py` `.rs` `.go` `.json` `.yaml` `.toml` `.tex` `.csv`, and more; `Makefile` `Dockerfile` | Source with line numbers and syntax highlighting |

Files are limited to 20 MiB each. "Download" saves the current file in its original format.

### Changes

When the project is inside a git repository and `git` is on `PATH`, a text file with uncommitted changes shows an "Open Changes" button in its toolbar. It opens a diff in the style of VS Code: side by side, with changed lines and the changed characters within them highlighted. Working tree changes compare the index with the file on disk; staged-only changes compare `HEAD` with the index.

The diff toolbar moves between changes (also `]c` / `[c`), switches to an inline view, collapses unchanged regions, and toggles whether leading and trailing whitespace differences are shown. They are shown by default. fzv only reads from git: it never stages, commits, or takes the index lock.

## Keyboard shortcuts

| Keys                     | Action                                        |
| ------------------------ | --------------------------------------------- |
| `/`                      | Open file search                              |
| `?`                      | Show all shortcuts                            |
| `f`                      | Label links and buttons; type a label to jump |
| `h` `j` `k` `l`          | Scroll the preview                            |
| `gg` / `G`               | Go to the top / bottom                        |
| `r`                      | Reload the current file                       |
| `Alt+J` / `Alt+K`        | Next / previous tab in the same pane          |
| `Ctrl/Cmd+\`             | Split right                                   |
| `Ctrl/Cmd+Shift+\`       | Split down                                    |
| `Ctrl/Cmd+1`–`9`         | Focus a pane                                  |
| `Ctrl/Cmd+F`             | Search within a PDF                           |
| `Ctrl/Cmd` + `+` `-` `0` | Zoom images and PDFs (`0` fits to the view)   |
| `]c` / `[c`              | Next / previous change in a diff              |
| `Escape`                 | Close search, help, or labels                 |

Text fields keep their normal typing behavior. Shortcuts reserved by the browser take precedence.

## Office documents

`.docx`, `.xlsx`, and `.pptx` files are converted to PDF with a local ibisOffice or LibreOffice before display. At startup, fzv searches `PATH` for `ibisOffice`, `soffice`, and `libreoffice`, in that order, and also checks `/Applications` on macOS. The converter it finds is shown on the `Office` line of the startup message.

If the converter lives somewhere else, pass its path with `--office-converter`:

```bash
npx --yes @aaa_iii/fzv@latest --office-converter ~/Applications/ibisOffice-0.8.4-Linux.AppImage
```

Executables whose names start with `soffice` or `libreoffice` are run as LibreOffice; anything else is run as ibisOffice. Converted PDFs are cached by file content and regenerated when the content changes.

## Options

| Option                    | Default                 | Description                                                           |
| ------------------------- | ----------------------- | --------------------------------------------------------------------- |
| `--root PATH`             | Current directory       | Project root to open                                                  |
| `--host HOST`             | `127.0.0.1`             | Address to listen on                                                  |
| `--port PORT`             | Derived from the path   | `0` picks a free port. An explicit port that is in use stops startup  |
| `--watch`                 | Off                     | Watch for changes and refresh the search index and open tabs          |
| `--allow-html-network`    | Off                     | Let HTML previews load external scripts and make network requests     |
| `--office-converter PATH` | Auto-detected on `PATH` | ibisOffice or LibreOffice executable used to convert Office documents |
| `-h`, `--help`            |                         | Show help                                                             |
| `-v`, `--version`         |                         | Show the version                                                      |

## Security

By default fzv listens on `127.0.0.1` only, so it is reachable from this machine alone. To open it from another device on your LAN, set the listen address explicitly:

```bash
npx --yes @aaa_iii/fzv@latest --host 0.0.0.0 --port 8000
```

**Warning**: there is no authentication and no TLS. Anyone who can connect can read the viewable files in the project. Use it only on networks you trust.

- The server accepts only GET and HEAD and rejects cross-origin API requests.
- HTML previews run in a sandbox and cannot reach the fzv page or its storage. Inline scripts run, but external scripts and API requests are blocked by default. Images, CSS, and fonts may still load. Use `--allow-html-network` only for HTML you trust.
- Office documents are copied from the validated file into a temporary directory before conversion. The converter never reads project paths directly. The temporary directory is removed on exit.

## Status

fzv is in 0.x development. Options and shortcuts may change in minor releases.

## Run from source

```bash
npm ci
npm run build
node dist/server/cli.js --watch
```

To work on the UI, keep the server running, run `npm run dev:ui` in another terminal, and open the URL Vite prints. Run the tests with `npm test` and `npm run test:browser`.

## License

[MIT](https://github.com/iiii1224/fzv/blob/main/LICENSE). Licenses for bundled components and the attribution for the fuzzy search implementation are in [THIRD_PARTY_NOTICES.md](https://github.com/iiii1224/fzv/blob/main/THIRD_PARTY_NOTICES.md).
