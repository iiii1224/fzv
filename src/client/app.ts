import '@vscode/codicons/dist/codicon.css';
import './style.css';
import { PRODUCT_NAME } from '../shared.js';
import type {
  FileIndex,
  GitStatus,
  ProjectChange,
  ProjectEntry,
  ProjectFile,
  ProjectInfo,
} from '../shared.js';
import { FuzzyIndex } from './search.js';
import { readSession, tabKey, writeSession } from './session.js';
import type { SavedSession, SessionStorage } from './session.js';
import { Workspace } from './workspace.js';
import { fileIcon } from './icons.js';
import { initializeTheme } from './theme.js';
import { installNavigation } from '../navigation.js';
import { Sidebar } from './sidebar.js';
import { SourceControlView } from './scm.js';
import { ExplorerView } from './explorer.js';

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing UI element: ${id}`);
  return element as T;
}
const search = byId<HTMLInputElement>('search');
const searchPanel = byId<HTMLDialogElement>('search-panel');
const results = byId('results');
const count = byId('result-count');
const refresh = byId<HTMLButtonElement>('refresh-files');
const notification = byId('notification');
initializeTheme(byId<HTMLButtonElement>('theme-toggle'));
let files: ProjectFile[] = [];
let index = new FuzzyIndex([]);
let projectId = '';
let visible: ProjectEntry[] = [];
let highlighted = 0;
let notificationTimer: ReturnType<typeof setTimeout> | undefined;
let renderFrame = 0;
let indexSequence = 0;
let appliedSequence = 0;
let rescan: Promise<void> | undefined;
let rescanQueued = false;
let gitEnabled = false;
let pendingBracket = '';
let gitRequest: AbortController | undefined;
let gitSnapshot = '';
let storage: SessionStorage | undefined;
try {
  storage = window.localStorage;
} catch {
  /* Storage is optional. */
}

function notify(message: string): void {
  notification.textContent = message;
  notification.hidden = false;
  clearTimeout(notificationTimer);
  notificationTimer = setTimeout(() => {
    notification.hidden = true;
  }, 5000);
}
function copyWithBrowserCommand(text: string): boolean {
  const active = document.activeElement;
  const selection = window.getSelection();
  const ranges = selection
    ? Array.from({ length: selection.rangeCount }, (_, index) =>
        selection.getRangeAt(index).cloneRange(),
      )
    : [];
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;
  const field = document.createElement('textarea');
  field.value = text;
  field.readOnly = true;
  field.setAttribute('aria-hidden', 'true');
  Object.assign(field.style, {
    position: 'fixed',
    left: '-10000px',
    top: '0',
    width: '1px',
    height: '1px',
    opacity: '0',
    fontSize: '16px',
  });
  document.body.append(field);
  let copied = false;
  try {
    field.focus({ preventScroll: true });
    field.select();
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  }
  field.remove();
  if (active instanceof HTMLElement && active.isConnected)
    active.focus({ preventScroll: true });
  if (selection) {
    selection.removeAllRanges();
    for (const range of ranges) selection.addRange(range);
  }
  window.scrollTo(scrollX, scrollY);
  return copied;
}
async function copyToClipboard(text: string, label: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    notify(`${label} copied to clipboard.`);
  } catch {
    notify(
      copyWithBrowserCommand(text)
        ? `${label} copied to clipboard.`
        : `Could not copy ${label.toLowerCase()}.`,
    );
  }
}
function save(): void {
  if (storage && projectId)
    writeSession(storage, projectId, workspace.snapshot());
}
function renderResults(): void {
  const found = index.search(search.value);
  visible = found.files;
  highlighted = Math.min(
    Math.max(highlighted, 0),
    Math.max(0, visible.length - 1),
  );
  const nodes = visible.map((file, i) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'result monaco-list-row quick-input-list-entry';
    button.title = file.path;
    button.setAttribute('aria-label', file.path);
    button.classList.toggle(
      'active',
      file.path === workspace.activeTab?.file.path,
    );
    button.classList.toggle(
      'keyboard-selected',
      i === highlighted && document.activeElement === search,
    );
    if (file.path === workspace.activeTab?.file.path)
      button.setAttribute('aria-current', 'true');
    const text = document.createElement('span');
    text.className = 'result-text';
    const name = document.createElement('span');
    name.className = 'result-name';
    name.textContent = file.name + (file.kind === 'directory' ? '/' : '');
    const path = document.createElement('span');
    path.className = 'result-path';
    path.textContent = file.path;
    text.append(name, path);
    button.append(fileIcon(file), text);
    button.addEventListener('click', () => selectEntry(file));
    return button;
  });
  results.replaceChildren(...nodes);
  if (!visible.length) {
    const message = document.createElement('div');
    message.className = 'no-results';
    message.textContent = files.length
      ? 'No files match your search.'
      : 'No previewable files yet. Add a PDF, HTML, image, or text file, then refresh.';
    results.append(message);
  }
  count.textContent = search.value.trim()
    ? `${found.total} match${found.total === 1 ? '' : 'es'}`
    : `${found.total} item${found.total === 1 ? '' : 's'}`;
  if (found.total > visible.length)
    count.textContent += ` · showing ${visible.length}`;
}
function restorePreviewFocus(): void {
  workspace.focus();
}
function setSearchOpen(show: boolean): void {
  navigation.cancel();
  if (show) {
    search.value = '';
    highlighted = 0;
    if (!searchPanel.open) searchPanel.showModal();
    search.focus();
    renderResults();
    // Agents add files while the page is open. Search the current index
    // until the rescan replaces it.
    rescanIndex(false);
  } else {
    searchPanel.close();
    // Native dialog close events are queued. Restore focus now so a following
    // shortcut cannot be delivered to the search field after it is hidden.
    restorePreviewFocus();
  }
}
function focusSearch(): void {
  setSearchOpen(true);
}
function selectEntry(entry: ProjectEntry): void {
  if (entry.kind === 'directory') {
    search.value = `${entry.path}/`;
    highlighted = 0;
    search.focus();
    renderResults();
    return;
  }
  workspace.open(entry);
  setSearchOpen(false);
}

/** Opens a project file by path, validating it like a restored tab. */
async function openPath(path: string): Promise<void> {
  const known = files.find((file) => file.path === path);
  if (known) {
    workspace.open(known);
    return;
  }
  try {
    const response = await fetch(
      `/api/session-files?${new URLSearchParams({ path })}`,
    );
    const [file] = response.ok
      ? ((await response.json()) as ProjectFile[])
      : [];
    if (file) workspace.open(file);
    else notify(`${path} is not available.`);
  } catch (error) {
    notify(`Could not open ${path}: ${error}`);
  }
}

/** Refreshes Source Control status. Like VS Code, this runs on changes and focus. */
async function refreshGit(): Promise<void> {
  if (!gitEnabled) return;
  gitRequest?.abort();
  const request = new AbortController();
  gitRequest = request;
  try {
    const response = await fetch('/api/git/status', { signal: request.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const status = (await response.json()) as GitStatus;
    if (gitRequest !== request) return;
    const snapshot = JSON.stringify(status);
    const changed = gitSnapshot !== '' && snapshot !== gitSnapshot;
    gitSnapshot = snapshot;
    workspace.setGitChanges(status.available ? status.changes : []);
    explorer.setGitChanges(status.available ? status.changes : []);
    sourceControl.setStatus(status);
    const count = sourceControl.count;
    sidebar.setBadge(
      'scm',
      count,
      `${count} pending change${count === 1 ? '' : 's'}`,
    );
    const branch = status.available ? (status.branch ?? 'HEAD') : null;
    byId('status-branch').hidden = branch === null;
    byId('status-branch-name').textContent = branch ?? '';
    // Staging changes the compared contents without touching project files.
    if (changed) workspace.reloadDiffs();
  } catch {
    /* Keep the previous status; the next refresh can succeed. */
  }
}

function savedPaths(saved: SavedSession): string[] {
  return [
    ...new Set(
      saved.version === 1
        ? saved.tabs
        : saved.groups.flatMap((group) => group.tabs.map((tab) => tab.path)),
    ),
  ];
}

async function fetchSessionFiles(saved: SavedSession): Promise<ProjectFile[]> {
  const batches: string[][] = [];
  let batch: string[] = [];
  let queryLength = 0;
  for (const path of savedPaths(saved)) {
    const length = new URLSearchParams({ path }).toString().length + 7;
    if (length > 12_000) continue;
    if (
      batch.length === 32 ||
      (batch.length > 0 && queryLength + length > 12_000)
    ) {
      batches.push(batch);
      batch = [];
      queryLength = 0;
    }
    batch.push(path);
    queryLength += length;
  }
  if (batch.length) batches.push(batch);
  const responses = await Promise.all(
    batches.map(async (paths) => {
      const query = new URLSearchParams();
      for (const path of paths) query.append('path', path);
      const response = await fetch(`/api/session-files?${query}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return (await response.json()) as ProjectFile[];
    }),
  );
  return responses.flat();
}

// Scans can overlap. An older response must not replace a newer index.
function applyIndex(
  sequence: number,
  data: Pick<FileIndex, 'files' | 'directories'>,
): boolean {
  if (sequence < appliedSequence) return false;
  appliedSequence = sequence;
  files = data.files;
  index = new FuzzyIndex([...data.directories, ...files]);
  explorer.setEntries(files, data.directories);
  return true;
}

function watchProject(): void {
  let revision: string | undefined;
  let retryDelay = 1000;
  const connect = () => {
    const socket = new WebSocket(new URL('/api/events', location.href));
    socket.addEventListener('open', () => {
      retryDelay = 1000;
    });
    socket.addEventListener('message', (event) => {
      const change = JSON.parse(event.data) as ProjectChange;
      if (change.paths?.length !== 0) {
        workspace.projectChanged(change.paths);
      } else if (revision !== undefined && revision !== change.revision) {
        // The project changed while this tab was disconnected.
        workspace.projectChanged(null);
      }
      revision = change.revision;
      rescanIndex(true);
      void refreshGit();
    });
    socket.addEventListener('close', () => {
      setTimeout(connect, retryDelay);
      retryDelay = Math.min(retryDelay * 2, 10_000);
    });
  };
  connect();
}

function scanIndex(mode: 'initial' | 'background'): void {
  rescan = loadIndex(mode).finally(() => {
    rescan = undefined;
    if (!rescanQueued) return;
    rescanQueued = false;
    scanIndex('background');
  });
}
// A scan in progress is fresh enough for opening search, but it may have
// missed a reported change. Queue one follow-up instead of restarting it.
function rescanIndex(afterChange: boolean): void {
  if (!rescan) scanIndex('background');
  else if (afterChange) rescanQueued = true;
}

async function loadIndex(
  mode: 'initial' | 'refresh' | 'background' = 'refresh',
): Promise<void> {
  const sequence = ++indexSequence;
  if (mode !== 'background') {
    refresh.disabled = true;
    count.textContent = 'Loading files…';
  }
  try {
    if (mode === 'initial') {
      const indexRequest: Promise<{ data: FileIndex } | { error: unknown }> =
        fetch('/api/files').then(
          async (response) =>
            response.ok
              ? { data: (await response.json()) as FileIndex }
              : { error: new Error(`HTTP ${response.status}`) },
          (error: unknown) => ({ error }),
        );
      const projectResponse = await fetch('/api/project');
      if (!projectResponse.ok)
        throw new Error(`HTTP ${projectResponse.status}`);
      const project = (await projectResponse.json()) as ProjectInfo;
      if (project.watch) watchProject();
      projectId = project.id;
      explorer.setProject(project.id, project.name);
      gitEnabled = project.git === true;
      if (gitEnabled) sidebar.add(sourceControlView);
      void refreshGit();
      byId('project-name').textContent = project.name;
      byId('status-project').textContent = project.name;
      const saved = storage ? readSession(storage, projectId) : null;
      let restored = false;
      if (saved) {
        try {
          workspace.restore(saved, await fetchSessionFiles(saved));
          restored = true;
        } catch {
          // Fall back to the full index if the fast, validated lookup fails.
        }
      }
      const result = await indexRequest;
      if ('error' in result) throw result.error;
      const data = result.data;
      if (saved && !restored) workspace.restore(saved, data.files);
      applyIndex(sequence, data);
      renderResults();
    } else {
      const response = await fetch('/api/files');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as FileIndex;
      if (!applyIndex(sequence, data)) return;
      projectId = data.project.id;
      explorer.setProject(data.project.id, data.project.name);
      const available = new Set(data.files.map((file) => file.path));
      byId('project-name').textContent = data.project.name;
      byId('status-project').textContent = data.project.name;
      for (const tab of workspace.tabs)
        if (!tab.diff && !available.has(tab.file.path)) workspace.close(tab);
      renderResults();
      if (mode === 'refresh') notify('File list refreshed.');
    }
  } catch (error) {
    if (sequence !== indexSequence) return;
    count.textContent = 'Could not load files';
    notify(`Could not load the project: ${error}`);
  } finally {
    if (sequence === indexSequence) refresh.disabled = false;
  }
}

search.addEventListener('input', () => {
  highlighted = 0;
  cancelAnimationFrame(renderFrame);
  renderFrame = requestAnimationFrame(renderResults);
});
search.addEventListener('focus', renderResults);
search.addEventListener('blur', () => {
  for (const button of results.children)
    button.classList.remove('keyboard-selected');
});
search.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.preventDefault();
    setSearchOpen(false);
    return;
  }
  // A key can arrive before the next animation frame. Rank against the current query.
  if (['Enter', 'ArrowDown', 'ArrowUp'].includes(event.key)) {
    cancelAnimationFrame(renderFrame);
    renderResults();
  }
  if (event.key === 'Enter' && visible[highlighted]) {
    event.preventDefault();
    selectEntry(visible[highlighted]);
  }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    highlighted = Math.max(
      0,
      Math.min(
        visible.length - 1,
        highlighted + (event.key === 'ArrowDown' ? 1 : -1),
      ),
    );
    renderResults();
    results.children[highlighted]?.scrollIntoView({ block: 'nearest' });
  }
});
searchPanel.addEventListener('close', () => {
  if (!searchPanel.open) restorePreviewFocus();
});
searchPanel.addEventListener('cancel', (event) => {
  event.preventDefault();
  setSearchOpen(false);
});
searchPanel.addEventListener('click', (event) => {
  if (event.target !== searchPanel) return;
  const rect = searchPanel.getBoundingClientRect();
  if (
    event.clientX < rect.left ||
    event.clientX > rect.right ||
    event.clientY < rect.top ||
    event.clientY > rect.bottom
  )
    setSearchOpen(false);
});
byId('close-search').addEventListener('click', () => setSearchOpen(false));
byId('find-file').addEventListener('click', focusSearch);
refresh.addEventListener('click', () => {
  void loadIndex();
});
window.addEventListener('keydown', (event) => {
  if (event.defaultPrevented || event.isComposing) return;
  if (document.querySelector('dialog[open]')) return;
  const focused = document.activeElement;
  const typing =
    focused instanceof HTMLElement &&
    (focused.isContentEditable ||
      Boolean(focused.closest('input,textarea,select,[role="textbox"]')));
  if (
    event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    ['j', 'k'].includes(event.key.toLowerCase())
  ) {
    event.preventDefault();
    workspace.cycle(event.key.toLowerCase() === 'j' ? 1 : -1);
    return;
  }
  // VS Code's view shortcuts: Ctrl+Shift+E / G for Explorer / Source Control, Ctrl+B for the side bar.
  if ((event.ctrlKey || event.metaKey) && !event.altKey && !searchPanel.open) {
    const key = event.key.toLowerCase();
    if (event.shiftKey && key === 'e') {
      event.preventDefault();
      sidebar.toggleFocus('explorer');
      return;
    }
    if (event.shiftKey && key === 'g' && gitEnabled) {
      event.preventDefault();
      sidebar.toggleFocus('scm');
      return;
    }
    if (!event.shiftKey && key === 'b') {
      event.preventDefault();
      sidebar.toggle();
      return;
    }
  }
  if (event.ctrlKey && event.key === 'Tab') {
    event.preventDefault();
    workspace.cycle(event.shiftKey ? -1 : 1);
    return;
  }
  if (
    !typing &&
    (event.ctrlKey || event.metaKey) &&
    !event.altKey &&
    !searchPanel.open
  ) {
    if (event.code === 'Backslash') {
      event.preventDefault();
      workspace.splitActive(event.shiftKey ? 'down' : 'right');
      return;
    }
    if (/^[1-9]$/.test(event.key)) {
      event.preventDefault();
      workspace.focusGroup(Number(event.key) - 1);
      return;
    }
  }
  const active = workspace.activeTab;
  // VS Code's diff editor uses Alt+F5 / Shift+Alt+F5; ]c and [c follow Vim's diff mode.
  if (event.key === 'F5' && event.altKey && !event.ctrlKey && !event.metaKey) {
    if (workspace.navigateChange(event.shiftKey ? -1 : 1))
      event.preventDefault();
    return;
  }
  const bracket = pendingBracket;
  pendingBracket = '';
  if (
    !typing &&
    active?.diff &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey
  ) {
    if (bracket && event.key === 'c') {
      event.preventDefault();
      workspace.navigateChange(bracket === ']' ? 1 : -1);
      return;
    }
    if (event.key === ']' || event.key === '[') {
      event.preventDefault();
      pendingBracket = event.key;
      return;
    }
  }
  if (
    !typing &&
    (event.ctrlKey || event.metaKey) &&
    !event.altKey &&
    active?.file.kind === 'image'
  ) {
    const action = ['+', '='].includes(event.key)
      ? '.image-zoom-in'
      : ['-', '_'].includes(event.key)
        ? '.image-zoom-out'
        : event.key === '0'
          ? '.image-fit'
          : null;
    if (action) {
      event.preventDefault();
      active.pane.element.querySelector<HTMLButtonElement>(action)?.click();
    }
  }
});
const navigation = installNavigation({
  onSearch: focusSearch,
  onScroll: (key) => {
    const active = workspace.activeTab;
    if (!active || active.file.kind !== 'html' || active.mode !== 'viewer')
      return false;
    const frame = active.pane.element.querySelector('iframe');
    if (!frame?.contentWindow) return false;
    frame.contentWindow.postMessage({ type: 'fzv:scroll', key }, '*');
    return true;
  },
  onHintActivate: (target) => {
    if (
      !(target instanceof HTMLIFrameElement) ||
      !workspace.frameTab(target.contentWindow)
    )
      return false;
    workspace.activateFrame(target);
    target.contentWindow?.postMessage({ type: 'fzv:show-hints' }, '*');
    return true;
  },
  onReload: () => {
    if (!searchPanel.open) workspace.reload();
  },
  getScrollRoot: () => {
    if (searchPanel.open) return results;
    const active = workspace.activeTab;
    return (
      [
        ...(active?.pane.element.querySelectorAll<HTMLElement>(
          '.source-preview, .viewer-surface, .pdf-scroll, .diff-scroll',
        ) ?? []),
      ].find((element) => element.getClientRects().length > 0) ?? null
    );
  },
});
const explorer = new ExplorerView({
  openFile: (file) => {
    workspace.open(file);
    sidebar.afterOpen();
  },
  refresh: () => void loadIndex(),
});
const sourceControl = new SourceControlView({
  openChange: (change) => {
    workspace.openDiff(change);
    sidebar.afterOpen();
  },
  openFile: (path) => {
    void openPath(path);
    sidebar.afterOpen();
  },
  refresh: () => void refreshGit(),
});
const sourceControlView = {
  id: 'scm',
  title: 'Source Control',
  icon: 'source-control',
  keybinding: 'Ctrl+Shift+G',
  element: sourceControl.element,
  actions: sourceControl.actions,
  focus: () => sourceControl.focus(),
};
const sidebar = new Sidebar(
  byId('activity-bar'),
  byId('sidebar'),
  byId('sidebar-title'),
  byId('sidebar-actions'),
  byId('sidebar-content'),
  byId('sidebar-sash'),
);
const workspace = new Workspace(
  byId('preview'),
  () => {
    navigation.cancel();
    const active = workspace.activeTab;
    document.title = active
      ? `${active.file.name} — ${PRODUCT_NAME}`
      : PRODUCT_NAME;
    const count = workspace.tabs.length;
    byId('tab-count').textContent =
      `${count} open tab${count === 1 ? '' : 's'}`;
    renderResults();
    // Like explorer.autoReveal; staged diffs show index content, not the file.
    explorer.reveal(
      active && active.diff?.stage !== 'index' ? active.file.path : null,
    );
    sourceControl.setActive(
      active ? tabKey(active.file.path, active.diff) : null,
    );
    save();
  },
  (text, label) => void copyToClipboard(text, label),
  (path) => void openPath(path),
);
sidebar.add({
  id: 'explorer',
  title: 'Explorer',
  icon: 'files',
  keybinding: 'Ctrl+Shift+E',
  element: explorer.element,
  actions: explorer.actions,
  focus: () => explorer.focus(),
});
byId('status-branch').addEventListener('click', () => sidebar.show('scm'));
window.addEventListener('focus', () => void refreshGit());
window.addEventListener('message', (event) => {
  if (event.origin !== 'null') return;
  const tab = workspace.frameTab(event.source);
  if (!tab) return;
  if (event.data?.type === 'fzv:focus') {
    workspace.activateFrame(tab.pane.element.querySelector('iframe'));
    return;
  }
  if (tab !== workspace.activeTab || event.data?.type !== 'fzv:shortcut')
    return;
  if (event.data.key === '/') focusSearch();
  if (event.data.key === 'r') workspace.reload();
  if (event.data.key === 'f' && !searchPanel.open) {
    workspace.focus();
    navigation.showHints();
  }
});
scanIndex('initial');
