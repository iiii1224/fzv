import type { GitChange, GitStatus } from '../shared.js';
import { fileIcon, icon } from './icons.js';
import { tabKey } from './session.js';
import { handleTreeKey } from './tree.js';

type GroupId = 'merge' | 'index' | 'workingTree';
interface Group {
  id: GroupId;
  label: string;
  changes: GitChange[];
}

// Letters, labels, and colors follow VS Code's git extension Resource class.
// fzv reports untracked files as '?' and conflicts as 'U' (porcelain codes),
// which VS Code shows as 'U' and '!'.
export function statusLetter(change: GitChange): string {
  return change.status === '?'
    ? 'U'
    : change.status === 'U'
      ? '!'
      : change.status;
}
export function statusText(change: GitChange): string {
  const index = change.stage === 'index';
  switch (change.status) {
    case 'M':
      return index ? 'Index Modified' : 'Modified';
    case 'A':
      return index ? 'Index Added' : 'Intent to Add';
    case 'D':
      return index ? 'Index Deleted' : 'Deleted';
    case 'R':
      return index ? 'Index Renamed' : 'Intent to Rename';
    case 'C':
      return 'Index Copied';
    case 'T':
      return 'Type Changed';
    case '?':
      return 'Untracked';
    case 'U':
      return 'Conflict';
  }
}
export function statusColor(change: GitChange): string {
  switch (change.status) {
    case 'M':
      return change.stage === 'index' ? 'stage-modified' : 'modified';
    case 'T':
      return 'modified';
    case 'D':
      return change.stage === 'index' ? 'stage-deleted' : 'deleted';
    case 'A':
      return 'added';
    case 'R':
    case 'C':
      return 'renamed';
    case '?':
      return 'untracked';
    case 'U':
      return 'conflicting';
  }
}

export interface SourceControlActions {
  openChange(change: GitChange): void;
  openFile(path: string): void;
  refresh(): void;
}

/** VS Code's Source Control view in list mode, without write actions. */
export class SourceControlView {
  readonly element = document.createElement('section');
  readonly actions: HTMLElement[];
  private tree = document.createElement('div');
  private message = document.createElement('p');
  private status: GitStatus | null = null;
  private activeKey: string | null = null;
  private collapsed = new Set<GroupId>();
  private focusedKey: string | null = null;

  constructor(private handlers: SourceControlActions) {
    this.element.className = 'scm-view';
    this.element.setAttribute('aria-label', 'Source Control');
    this.tree.className = 'scm-tree';
    this.tree.setAttribute('role', 'tree');
    this.tree.setAttribute('aria-label', 'Source Control Changes');
    this.message.className = 'sidebar-message';
    this.message.textContent = 'Loading changes…';
    this.element.append(this.message, this.tree);
    this.tree.addEventListener('keydown', (event) =>
      handleTreeKey(event, this.tree, (row, expanded) =>
        this.toggle(row.dataset.group as GroupId, expanded),
      ),
    );
    this.tree.addEventListener('focusin', (event) => {
      const row = (event.target as HTMLElement).closest<HTMLElement>(
        '.scm-row',
      );
      if (row) this.setFocused(row);
    });
    const refresh = document.createElement('button');
    refresh.type = 'button';
    refresh.className = 'toolbar-button';
    refresh.setAttribute('aria-label', 'Refresh');
    refresh.title = 'Refresh';
    refresh.append(icon('refresh'));
    refresh.addEventListener('click', () => handlers.refresh());
    this.actions = [refresh];
  }

  /** Number of changes for the activity bar badge, like git.countBadge "all". */
  get count(): number {
    return this.status?.available ? this.status.changes.length : 0;
  }

  setStatus(status: GitStatus): void {
    this.status = status;
    this.render();
  }

  setActive(key: string | null): void {
    if (key === this.activeKey) return;
    this.activeKey = key;
    for (const row of this.rows())
      row.setAttribute('aria-selected', String(row.dataset.key === key));
  }

  focus(): void {
    const rows = this.rows();
    (
      rows.find((row) => row.tabIndex === 0) ??
      rows[0] ??
      this.element.closest<HTMLElement>('.sidebar')
    )?.focus();
  }

  private groups(): Group[] {
    if (!this.status?.available) return [];
    const groups: Record<GroupId, Group> = {
      merge: { id: 'merge', label: 'Merge Changes', changes: [] },
      index: { id: 'index', label: 'Staged Changes', changes: [] },
      workingTree: { id: 'workingTree', label: 'Changes', changes: [] },
    };
    for (const change of this.status.changes)
      groups[
        change.status === 'U'
          ? 'merge'
          : change.stage === 'index'
            ? 'index'
            : 'workingTree'
      ].changes.push(change);
    for (const group of Object.values(groups))
      group.changes.sort((a, b) => a.path.localeCompare(b.path));
    // Merge and staged groups hide when empty; Changes is always shown.
    return Object.values(groups).filter(
      (group) => group.id === 'workingTree' || group.changes.length,
    );
  }

  private render(): void {
    const status = this.status;
    const hadFocus = this.tree.contains(document.activeElement);
    this.message.hidden = status?.available === true;
    if (status && !status.available)
      this.message.textContent =
        'The project is not in a git repository, so there are no changes to show.';
    const rows: HTMLElement[] = [];
    for (const group of this.groups()) {
      rows.push(this.groupRow(group));
      if (!this.collapsed.has(group.id))
        for (const change of group.changes)
          rows.push(this.resourceRow(group, change));
    }
    this.tree.replaceChildren(...rows);
    const focused =
      rows.find((row) => row.dataset.key === this.focusedKey) ?? rows[0];
    if (focused) {
      focused.tabIndex = 0;
      if (hadFocus) focused.focus();
    }
  }

  private groupRow(group: Group): HTMLElement {
    const row = document.createElement('div');
    const expanded = !this.collapsed.has(group.id);
    row.className = 'scm-row scm-group';
    row.dataset.key = `group:${group.id}`;
    row.dataset.group = group.id;
    row.setAttribute('role', 'treeitem');
    row.setAttribute('aria-level', '1');
    row.setAttribute('aria-expanded', String(expanded));
    row.setAttribute('aria-label', `${group.label}, ${group.changes.length}`);
    row.tabIndex = -1;
    const twistie = icon(expanded ? 'chevron-down' : 'chevron-right');
    twistie.classList.add('scm-twistie');
    const name = document.createElement('span');
    name.className = 'scm-group-name';
    name.textContent = group.label;
    const count = document.createElement('span');
    count.className = 'scm-count';
    count.textContent = String(group.changes.length);
    row.append(twistie, name, count);
    row.addEventListener('click', () => this.toggle(group.id));
    return row;
  }

  private resourceRow(group: Group, change: GitChange): HTMLElement {
    const row = document.createElement('div');
    const name = change.path.split('/').at(-1)!;
    const directory = change.path.slice(0, -name.length - 1);
    const key = tabKey(change.path, change);
    row.className = `scm-row scm-resource git-${statusColor(change)}`;
    row.classList.toggle('deleted', change.status === 'D');
    row.dataset.key = key;
    row.dataset.group = group.id;
    row.setAttribute('role', 'treeitem');
    row.setAttribute('aria-level', '2');
    row.setAttribute('aria-selected', String(key === this.activeKey));
    row.setAttribute('aria-label', `${change.path}, ${statusText(change)}`);
    row.title = `${change.originalPath ? `${change.originalPath} → ` : ''}${change.path} • ${statusText(change)}`;
    row.tabIndex = -1;
    const label = document.createElement('span');
    label.className = 'scm-label';
    const title = document.createElement('span');
    title.className = 'scm-name';
    title.textContent = name;
    const description = document.createElement('span');
    description.className = 'scm-description';
    description.textContent = directory;
    label.append(title, description);
    const actions = document.createElement('span');
    actions.className = 'scm-actions';
    if (change.status !== 'D') {
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'toolbar-button';
      open.tabIndex = -1;
      open.setAttribute('aria-label', `Open File ${change.path}`);
      open.title = 'Open File';
      open.append(icon('go-to-file'));
      open.addEventListener('click', (event) => {
        event.stopPropagation();
        this.handlers.openFile(change.path);
      });
      actions.append(open);
    }
    const letter = document.createElement('span');
    letter.className = 'scm-letter';
    letter.textContent = statusLetter(change);
    row.append(
      fileIcon({
        path: change.path,
        name,
        kind: change.kind ?? 'text',
        size: 0,
      }),
      label,
      actions,
      letter,
    );
    row.addEventListener('click', () => this.open(change));
    return row;
  }

  private open(change: GitChange): void {
    // A conflicted file has no single index version to compare against.
    if (change.status === 'U') this.handlers.openFile(change.path);
    else this.handlers.openChange(change);
  }

  private toggle(id: GroupId, expand?: boolean): void {
    const expanded = !this.collapsed.has(id);
    if (expand === expanded) return;
    if (expanded) this.collapsed.add(id);
    else this.collapsed.delete(id);
    this.focusedKey = `group:${id}`;
    this.render();
  }

  private rows(): HTMLElement[] {
    return [...this.tree.querySelectorAll<HTMLElement>('.scm-row')];
  }

  private setFocused(row: HTMLElement): void {
    this.focusedKey = row.dataset.key ?? null;
    for (const item of this.rows()) item.tabIndex = item === row ? 0 : -1;
  }
}
