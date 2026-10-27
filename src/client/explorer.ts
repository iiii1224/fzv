import type { GitChange, ProjectDirectory, ProjectFile } from '../shared.js';
import { fileIcon, icon } from './icons.js';
import { statusColor, statusLetter, statusText } from './scm.js';
import { focusRow, handleTreeKey } from './tree.js';

interface Folder {
  directories: Map<string, Folder>;
  files: ProjectFile[];
}
interface Decoration {
  color: string;
  letter?: string;
  tooltip: string;
}

// VS Code's default explorer sort: folders first, then natural,
// case-insensitive names (compareFileNamesDefault).
const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
});
// The git extension's Resource.priority: conflicts, then modifications.
const priority = (change: GitChange) =>
  change.status === 'U' ? 4 : ['M', 'T', 'C'].includes(change.status) ? 2 : 1;

export interface ExplorerActions {
  openFile(file: ProjectFile): void;
  refresh(): void;
}

/** VS Code's Explorer: the project's visible files as a tree with git decorations. */
export class ExplorerView {
  readonly element = document.createElement('section');
  readonly actions: HTMLElement[];
  private header = document.createElement('button');
  private tree = document.createElement('div');
  private message = document.createElement('p');
  private root: Folder | null = null;
  private expanded = new Set<string>();
  private open = true;
  private activePath: string | null = null;
  private focusedPath: string | null = null;
  private decorations = new Map<string, Decoration>();
  private storageKey = '';
  private projectName = '';

  constructor(private handlers: ExplorerActions) {
    this.element.className = 'explorer-view';
    this.element.setAttribute('aria-label', 'Explorer');
    this.header.type = 'button';
    this.header.className = 'pane-header';
    this.header.setAttribute('aria-expanded', 'true');
    this.header.addEventListener('click', () => {
      this.open = !this.open;
      this.render();
    });
    this.tree.className = 'explorer-tree';
    this.tree.setAttribute('role', 'tree');
    this.tree.setAttribute('aria-label', 'Files Explorer');
    this.message.className = 'sidebar-message';
    this.message.textContent = 'Loading files…';
    this.element.append(this.header, this.message, this.tree);
    this.tree.addEventListener('keydown', (event) =>
      handleTreeKey(event, this.tree, (row, expanded) =>
        this.setExpanded(row.dataset.path!, expanded),
      ),
    );
    this.tree.addEventListener('focusin', (event) => {
      const row = (event.target as HTMLElement).closest<HTMLElement>(
        '[role="treeitem"]',
      );
      if (row) this.focusedPath = row.dataset.path ?? null;
    });
    const button = (label: string, name: string, action: () => void) => {
      const element = document.createElement('button');
      element.type = 'button';
      element.className = 'toolbar-button';
      element.setAttribute('aria-label', label);
      element.title = label;
      element.append(icon(name));
      element.addEventListener('click', action);
      return element;
    };
    this.actions = [
      button('Refresh Explorer', 'refresh', () => handlers.refresh()),
      button('Collapse Folders in Explorer', 'collapse-all', () => {
        this.expanded.clear();
        this.saveExpanded();
        this.render();
      }),
    ];
  }

  /** Expanded folders are kept per project, like VS Code's workspace view state. */
  setProject(id: string, name: string): void {
    this.projectName = name;
    this.header.setAttribute('aria-label', `${name} folder`);
    const key = `fzv:explorer:${id}`;
    if (key === this.storageKey) return;
    this.storageKey = key;
    try {
      const saved = JSON.parse(localStorage.getItem(key) ?? '[]');
      this.expanded = new Set(Array.isArray(saved) ? saved : []);
    } catch {
      this.expanded = new Set();
    }
    this.render();
  }

  setEntries(files: ProjectFile[], directories: ProjectDirectory[]): void {
    const root: Folder = { directories: new Map(), files: [] };
    const folder = (path: string): Folder => {
      let current = root;
      if (path)
        for (const name of path.split('/')) {
          let next = current.directories.get(name);
          if (!next) {
            next = { directories: new Map(), files: [] };
            current.directories.set(name, next);
          }
          current = next;
        }
      return current;
    };
    for (const directory of directories) folder(directory.path);
    for (const file of files)
      folder(file.path.slice(0, -file.name.length - 1)).files.push(file);
    this.root = root;
    this.render();
  }

  /** Mirrors the git decoration provider: later groups win, folders inherit colors. */
  setGitChanges(changes: GitChange[]): void {
    const files = new Map<string, GitChange>();
    const order = (change: GitChange) =>
      change.status === 'U' ? 2 : change.stage === 'worktree' ? 1 : 0;
    for (const change of changes) {
      if (change.status === 'D') continue;
      const current = files.get(change.path);
      if (!current || order(change) >= order(current))
        files.set(change.path, change);
    }
    const folders = new Map<string, GitChange>();
    for (const change of files.values()) {
      const parts = change.path.split('/');
      for (let depth = 1; depth < parts.length; depth++) {
        const path = parts.slice(0, depth).join('/');
        const current = folders.get(path);
        if (!current || priority(change) > priority(current))
          folders.set(path, change);
      }
    }
    this.decorations = new Map();
    for (const [path, change] of files)
      this.decorations.set(path, {
        color: statusColor(change),
        letter: statusLetter(change),
        tooltip: statusText(change),
      });
    for (const [path, change] of folders)
      this.decorations.set(path, {
        color: statusColor(change),
        tooltip: 'Contains emphasized items',
      });
    this.render();
  }

  /** Like explorer.autoReveal: expands the active file's folders and selects it. */
  reveal(path: string | null): void {
    if (path === this.activePath) return;
    this.activePath = path;
    if (path) {
      const parts = path.split('/');
      for (let depth = 1; depth < parts.length; depth++)
        this.expanded.add(parts.slice(0, depth).join('/'));
      this.focusedPath = path;
    }
    this.render();
    this.tree
      .querySelector<HTMLElement>('[aria-selected="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }

  focus(): void {
    const row =
      this.tree.querySelector<HTMLElement>('[tabindex="0"]') ??
      this.tree.querySelector<HTMLElement>('[role="treeitem"]');
    if (row) focusRow(this.tree, row);
    else this.header.focus();
  }

  private setExpanded(path: string, expanded: boolean): void {
    if (expanded) this.expanded.add(path);
    else this.expanded.delete(path);
    this.focusedPath = path;
    this.saveExpanded();
    this.render();
  }

  private saveExpanded(): void {
    try {
      if (this.storageKey)
        localStorage.setItem(
          this.storageKey,
          JSON.stringify([...this.expanded]),
        );
    } catch {
      /* Storage is optional. */
    }
  }

  private render(): void {
    const hadFocus = this.tree.contains(document.activeElement);
    this.header.setAttribute('aria-expanded', String(this.open));
    this.header.replaceChildren(
      icon(this.open ? 'chevron-down' : 'chevron-right'),
      this.projectName,
    );
    this.tree.hidden = !this.open;
    const empty = this.root?.directories.size === 0 && !this.root.files.length;
    this.message.hidden = !this.open || (this.root !== null && !empty);
    if (empty)
      this.message.textContent =
        'No previewable files yet. Add a PDF, HTML, image, or text file.';
    const rows: HTMLElement[] = [];
    if (this.root && this.open) this.addRows(rows, this.root, '', 1);
    this.tree.replaceChildren(...rows);
    const focused =
      rows.find((row) => row.dataset.path === this.focusedPath) ?? rows[0];
    if (focused) {
      focused.tabIndex = 0;
      if (hadFocus) focused.focus();
    }
  }

  private addRows(
    rows: HTMLElement[],
    folder: Folder,
    prefix: string,
    level: number,
  ): void {
    const directories = [...folder.directories.keys()].sort(collator.compare);
    for (const name of directories) {
      const path = prefix + name;
      const expanded = this.expanded.has(path);
      const twistie = icon(expanded ? 'chevron-down' : 'chevron-right');
      twistie.classList.add('explorer-twistie');
      const row = this.row(path, name, level, [twistie]);
      row.setAttribute('aria-expanded', String(expanded));
      row.addEventListener('click', () => this.setExpanded(path, !expanded));
      rows.push(row);
      if (expanded)
        this.addRows(
          rows,
          folder.directories.get(name)!,
          `${path}/`,
          level + 1,
        );
    }
    const files = [...folder.files].sort((a, b) =>
      collator.compare(a.name, b.name),
    );
    for (const file of files) {
      const spacer = document.createElement('span');
      spacer.className = 'explorer-twistie';
      const row = this.row(file.path, file.name, level, [
        spacer,
        fileIcon(file),
      ]);
      row.setAttribute('aria-selected', String(file.path === this.activePath));
      row.addEventListener('click', () => this.handlers.openFile(file));
      rows.push(row);
    }
  }

  private row(
    path: string,
    name: string,
    level: number,
    lead: HTMLElement[],
  ): HTMLElement {
    const row = document.createElement('div');
    row.className = 'explorer-row';
    row.dataset.path = path;
    row.setAttribute('role', 'treeitem');
    row.setAttribute('aria-level', String(level));
    row.tabIndex = -1;
    const decoration = this.decorations.get(path);
    row.title = decoration ? `${path} • ${decoration.tooltip}` : path;
    // VS Code's tree indents 8px per level after an 8px base, with guides on hover.
    const indent = document.createElement('span');
    indent.className = 'explorer-indent';
    for (let depth = 1; depth < level; depth++) {
      const guide = document.createElement('span');
      guide.className = 'indent-guide';
      indent.append(guide);
    }
    lead[0].style.paddingLeft = `${8 * level}px`;
    row.append(indent);
    const label = document.createElement('span');
    label.className = 'explorer-label';
    label.textContent = name;
    row.append(...lead, label);
    if (decoration) {
      row.classList.add(`git-${decoration.color}`, 'decorated');
      const badge = decoration.letter
        ? document.createElement('span')
        : icon('circle-filled');
      badge.classList.add('explorer-badge');
      if (decoration.letter) badge.textContent = decoration.letter;
      row.append(badge);
    }
    return row;
  }
}
