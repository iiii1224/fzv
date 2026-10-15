import './style.css';
import { PRODUCT_NAME } from '../shared.js';
import type { FileIndex, ProjectEntry, ProjectFile } from '../shared.js';
import { FuzzyIndex } from './search.js';
import { readSession, writeSession } from './session.js';
import type { SessionStorage } from './session.js';
import { createPreview, fileUrl } from './preview.js';
import type { PreviewPane } from './preview.js';

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing UI element: ${id}`);
  return element as T;
}
const search = byId<HTMLInputElement>('search');
const searchPanel = byId<HTMLDialogElement>('search-panel');
const results = byId('results');
const count = byId('result-count');
const tabbar = byId('tabbar');
const preview = byId('preview');
const empty = byId('empty-state');
const noTabs = byId('no-tabs');
const currentPath = byId('current-path');
const reload = byId<HTMLButtonElement>('reload-file');
const open = byId<HTMLAnchorElement>('open-file');
const refresh = byId<HTMLButtonElement>('refresh-files');
const notification = byId('notification');
interface Tab {
  file: ProjectFile;
  pane: PreviewPane;
  element: HTMLElement;
  button: HTMLButtonElement;
}
let files: ProjectFile[] = [];
let index = new FuzzyIndex([]);
let projectId = '';
let visible: ProjectEntry[] = [];
let highlighted = 0;
let activePath: string | null = null;
const tabs: Tab[] = [];
let revision = 0;
let tabSequence = 0;
let notificationTimer: ReturnType<typeof setTimeout> | undefined;
let renderFrame = 0;
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
function save(): void {
  if (storage && projectId)
    writeSession(storage, projectId, {
      version: 1,
      tabs: tabs.map((tab) => tab.file.path),
      active: activePath,
    });
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
    button.className = 'result';
    button.title = file.path;
    button.setAttribute('aria-label', file.path);
    button.classList.toggle('active', file.path === activePath);
    button.classList.toggle(
      'keyboard-selected',
      i === highlighted && document.activeElement === search,
    );
    if (file.path === activePath) button.setAttribute('aria-current', 'true');
    const text = document.createElement('span');
    text.className = 'result-text';
    const name = document.createElement('span');
    name.className = 'result-name';
    name.textContent = file.name + (file.kind === 'directory' ? '/' : '');
    const path = document.createElement('span');
    path.className = 'result-path';
    path.textContent = file.path;
    text.append(name, path);
    button.append(text);
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
function setSearchOpen(show: boolean): void {
  if (show) {
    search.value = '';
    highlighted = 0;
    if (!searchPanel.open) searchPanel.showModal();
    search.focus();
    renderResults();
  } else searchPanel.close();
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
  openTab(entry);
  setSearchOpen(false);
}

function activate(path: string | null, persist = true): void {
  const active = tabs.find((tab) => tab.file.path === path);
  activePath = active?.file.path ?? null;
  for (const tab of tabs) {
    const selected = tab === active;
    tab.pane.element.hidden = !selected;
    tab.element.classList.toggle('active', selected);
    tab.button.setAttribute('aria-selected', String(selected));
    tab.button.tabIndex = selected ? 0 : -1;
  }
  empty.hidden = Boolean(active);
  noTabs.hidden = tabs.length > 0;
  currentPath.textContent = active?.file.path ?? 'Ready when you are';
  currentPath.title = active?.file.path ?? '';
  reload.disabled = !active;
  open.hidden = !active;
  if (active) {
    open.href = fileUrl(active.file, revision);
    active.element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    document.title = `${active.file.name} — ${PRODUCT_NAME}`;
  } else document.title = PRODUCT_NAME;
  byId('tab-count').textContent =
    `${tabs.length} open tab${tabs.length === 1 ? '' : 's'}`;
  renderResults();
  if (persist) save();
}
function makeTab(file: ProjectFile): Tab {
  const pane = createPreview(file);
  const id = `file-tab-${++tabSequence}`;
  pane.element.id = `${id}-panel`;
  pane.element.setAttribute('aria-labelledby', id);
  preview.append(pane.element);
  const element = document.createElement('div');
  element.className = 'tab';
  element.setAttribute('role', 'presentation');
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'tab-select';
  button.setAttribute('role', 'tab');
  button.id = id;
  button.textContent = file.name;
  button.title = file.path;
  button.setAttribute('aria-label', file.path);
  button.setAttribute('aria-controls', pane.element.id);
  button.addEventListener('click', () => activate(file.path));
  button.addEventListener('keydown', (event) => {
    let next = -1;
    const current = tabs.findIndex((tab) => tab.file.path === file.path);
    if (event.key === 'ArrowRight') next = (current + 1) % tabs.length;
    if (event.key === 'ArrowLeft')
      next = (current - 1 + tabs.length) % tabs.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = tabs.length - 1;
    if (event.key === 'Delete') {
      event.preventDefault();
      closeTab(file.path, true);
      return;
    }
    if (next >= 0) {
      event.preventDefault();
      activate(tabs[next].file.path);
      tabs[next].button.focus();
    }
  });
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'tab-close';
  close.textContent = '×';
  close.setAttribute('aria-label', `Close ${file.path}`);
  close.title = 'Close tab';
  close.addEventListener('click', () => closeTab(file.path, true));
  element.append(button, close);
  tabbar.append(element);
  return { file, pane, element, button };
}
function openTab(file: ProjectFile): void {
  if (!tabs.some((tab) => tab.file.path === file.path))
    tabs.push(makeTab(file));
  activate(file.path);
}
function closeTab(path: string, focus = false): void {
  const i = tabs.findIndex((tab) => tab.file.path === path);
  if (i < 0) return;
  const [removed] = tabs.splice(i, 1);
  removed.pane.dispose();
  removed.element.remove();
  activate(
    path === activePath
      ? (tabs[Math.min(i, tabs.length - 1)]?.file.path ?? null)
      : activePath,
  );
  if (focus)
    (
      tabs.find((tab) => tab.file.path === activePath)?.button ?? byId('main')
    ).focus();
}
function cycle(direction: number): void {
  if (!tabs.length) return;
  const i = tabs.findIndex((tab) => tab.file.path === activePath);
  activate(tabs[(i + direction + tabs.length) % tabs.length].file.path);
}
function reloadActive(): void {
  const tab = tabs.find((tab) => tab.file.path === activePath);
  if (!tab) return;
  const pane = createPreview(tab.file, ++revision);
  pane.element.id = tab.pane.element.id;
  pane.element.setAttribute('aria-labelledby', tab.button.id);
  tab.pane.dispose();
  tab.pane = pane;
  preview.append(pane.element);
  pane.element.hidden = false;
  open.href = fileUrl(tab.file, revision);
}
async function loadIndex(initial = false): Promise<void> {
  refresh.disabled = true;
  count.textContent = 'Loading files…';
  try {
    const response = await fetch('/api/files');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data: FileIndex = await response.json();
    projectId = data.project.id;
    files = data.files;
    index = new FuzzyIndex([...data.directories, ...files]);
    byId('project-name').textContent = data.project.name;
    byId('status-project').textContent = data.project.name;
    if (initial) {
      const saved = storage ? readSession(storage, projectId) : null;
      const byPath = new Map(files.map((file) => [file.path, file]));
      for (const path of saved?.tabs ?? []) {
        const file = byPath.get(path);
        if (file) tabs.push(makeTab(file));
      }
      activate(
        tabs.find((tab) => tab.file.path === saved?.active)?.file.path ??
          tabs[0]?.file.path ??
          null,
      );
    } else {
      const available = new Set(files.map((file) => file.path));
      for (const tab of [...tabs])
        if (!available.has(tab.file.path)) closeTab(tab.file.path);
      renderResults();
      notify('File list refreshed.');
    }
  } catch (error) {
    count.textContent = 'Could not load files';
    notify(`Could not load the project: ${error}`);
  } finally {
    refresh.disabled = false;
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
  (
    tabs.find((tab) => tab.file.path === activePath)?.button ?? byId('main')
  ).focus();
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
reload.addEventListener('click', reloadActive);
refresh.addEventListener('click', () => {
  void loadIndex();
});
window.addEventListener('keydown', (event) => {
  const typing = document.activeElement?.matches(
    'input,textarea,select,[contenteditable="true"]',
  );
  if (
    !typing &&
    !searchPanel.open &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    event.key.toLowerCase() === 'r'
  ) {
    event.preventDefault();
    reloadActive();
    return;
  }
  if (
    !typing &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    ['f', '/'].includes(event.key.toLowerCase())
  ) {
    event.preventDefault();
    focusSearch();
    return;
  }
  if (
    event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    ['j', 'k'].includes(event.key.toLowerCase())
  ) {
    event.preventDefault();
    cycle(event.key.toLowerCase() === 'j' ? 1 : -1);
    return;
  }
  if (event.ctrlKey && event.key === 'Tab') {
    event.preventDefault();
    cycle(event.shiftKey ? -1 : 1);
    return;
  }
  const active = tabs.find((tab) => tab.file.path === activePath);
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
void loadIndex(true);
