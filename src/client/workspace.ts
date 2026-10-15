import type { ProjectFile } from '../shared.js';
import { fileIcon, icon } from './icons.js';
import {
  groupIds,
  measureLayout,
  ratioLimits,
  removeFromLayout,
  splitLayout,
  SASH_SIZE,
} from './layout.js';
import type { Direction, LayoutNode, Rect } from './layout.js';
import {
  createPreview,
  defaultPreviewMode,
  fileUrl,
  hasViewer,
} from './preview.js';
import type { PreviewMode, PreviewPane } from './preview.js';
import type { SavedSession, WorkspaceSession } from './session.js';

export interface EditorTab {
  id: string;
  file: ProjectFile;
  pane: PreviewPane;
  element: HTMLElement;
  button: HTMLButtonElement;
  mode: PreviewMode;
  revision: number;
  group: EditorGroup;
}
interface EditorGroup {
  id: string;
  element: HTMLElement;
  header: HTMLElement;
  tabbar: HTMLElement;
  tabs: EditorTab[];
  active: EditorTab | null;
  control<T extends HTMLElement = HTMLElement>(name: string): T;
}
interface DropTarget {
  group: EditorGroup;
  direction?: Direction;
  index?: number;
}

function position(element: HTMLElement, box: Rect): void {
  Object.assign(element.style, {
    left: `${box.x}px`,
    top: `${box.y}px`,
    width: `${box.width}px`,
    height: `${box.height}px`,
  });
}

/** Preview DOM stays attached to this single host, even when tabs change groups.
 * Reparenting an iframe would reload its sandbox and lose its running state. */
export class Workspace {
  private groups = new Map<string, EditorGroup>();
  private tree: LayoutNode;
  private selectedGroup: EditorGroup;
  private sequence = 0;
  private tabSequence = 0;
  private revision = 0;
  private sashes = new Map<string, HTMLElement>();
  private measured: ReturnType<typeof measureLayout>;
  private dragged: EditorTab | null = null;
  private dragSurface = document.createElement('div');
  private highlight = document.createElement('div');
  private resizeSurface = document.createElement('div');
  private resizeObserver: ResizeObserver;

  constructor(
    private host: HTMLElement,
    private onChange: () => void,
    private copyToClipboard: (text: string, label: string) => void,
  ) {
    this.selectedGroup = this.makeGroup();
    this.tree = { type: 'group', id: this.selectedGroup.id };
    this.measured = measureLayout(this.tree, this.hostRect());
    this.dragSurface.className = 'editor-drag-surface';
    this.dragSurface.hidden = true;
    this.highlight.className = 'editor-drop-highlight';
    this.dragSurface.append(this.highlight);
    this.resizeSurface.className = 'editor-resize-surface';
    this.resizeSurface.hidden = true;
    host.append(this.dragSurface, this.resizeSurface);
    host.addEventListener('dragover', (event) => this.dragOver(event));
    host.addEventListener('drop', (event) => {
      if (!this.dragged) return;
      event.preventDefault();
      event.stopPropagation();
      const target = this.dropTarget(event);
      const tab = this.dragged;
      this.endDrag();
      if (target) this.transfer(tab, target, this.isCopy(event));
    });
    host.addEventListener('dragleave', (event) => {
      if (!host.contains(event.relatedTarget as Node | null))
        this.highlight.hidden = true;
    });
    window.addEventListener('dragend', () => this.endDrag());
    window.addEventListener('drop', () => this.endDrag());
    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') this.endDrag();
    });
    window.addEventListener('blur', () => {
      // Entering an opaque iframe does not dispatch focusin in the parent.
      setTimeout(() => this.activateFrame(document.activeElement), 0);
    });
    this.resizeObserver = new ResizeObserver(() => this.layout());
    this.resizeObserver.observe(host);
    this.render(false);
  }

  get activeTab(): EditorTab | null {
    return this.selectedGroup.active;
  }
  get tabs(): EditorTab[] {
    return groupIds(this.tree).flatMap((id) => this.groups.get(id)?.tabs ?? []);
  }
  private hostRect(): Rect {
    return {
      x: 0,
      y: 0,
      width: this.host.clientWidth,
      height: this.host.clientHeight,
    };
  }

  private makeGroup(): EditorGroup {
    let id: string;
    do {
      id = `group-${++this.sequence}`;
    } while (this.groups.has(id));
    const element = document.createElement('section');
    element.className = 'editor-group';
    element.dataset.groupId = id;
    element.setAttribute('role', 'region');
    const template = document.getElementById(
      'editor-group-template',
    ) as HTMLTemplateElement;
    element.append(template.content.cloneNode(true));
    for (const control of element.querySelectorAll<HTMLElement>('[id]')) {
      control.dataset.control = control.id;
      if (this.groups.size) control.id += `-${id}`;
    }
    const control = <T extends HTMLElement = HTMLElement>(name: string): T =>
      element.querySelector<T>(`[data-control="${name}"]`)!;
    control('current-path').classList.add('current-path');
    const group: EditorGroup = {
      id,
      element,
      header: element.querySelector('.group-header')!,
      tabbar: control('tabbar'),
      tabs: [],
      active: null,
      control,
    };
    element.addEventListener('pointerdown', () => this.selectGroup(group), {
      capture: true,
    });
    element.addEventListener('focusin', () => this.selectGroup(group));
    control('group-focus').addEventListener('click', () => {
      this.selectGroup(group);
      this.focus();
    });
    control('reload-file').addEventListener('click', () =>
      this.reload(group.active),
    );
    control('copy-path').addEventListener('click', () => {
      const path = group.active?.file.path;
      if (path) this.copyToClipboard(path, 'File path');
    });
    control('viewer-mode').addEventListener('click', () =>
      this.setMode(group.active, 'viewer'),
    );
    control('source-mode').addEventListener('click', () =>
      this.setMode(group.active, 'source'),
    );
    control('split-right').addEventListener('click', () =>
      this.split(group, 'right'),
    );
    control('split-down').addEventListener('click', () =>
      this.split(group, 'down'),
    );
    this.groups.set(id, group);
    this.host.append(element);
    return group;
  }

  private selectGroup(group: EditorGroup): void {
    if (this.selectedGroup === group) return;
    this.selectedGroup = group;
    this.render();
  }

  private activate(tab: EditorTab, focus = false): void {
    this.selectedGroup = tab.group;
    tab.group.active = tab;
    this.render();
    tab.element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    if (focus) tab.button.focus();
  }

  private mountPane(tab: EditorTab): void {
    const pane = tab.pane.element;
    pane.id = `${tab.id}-panel`;
    pane.setAttribute('aria-labelledby', tab.id);
    pane.addEventListener('pointerdown', () => this.selectGroup(tab.group), {
      capture: true,
    });
    pane.addEventListener('focusin', () => this.selectGroup(tab.group));
    this.host.append(pane);
  }

  private makeTab(
    file: ProjectFile,
    group: EditorGroup,
    mode = defaultPreviewMode(file),
  ): EditorTab {
    const id = `file-tab-${++this.tabSequence}`;
    const element = document.createElement('div');
    element.className = 'tab';
    element.setAttribute('role', 'presentation');
    element.draggable = true;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tab-select tab-label';
    button.setAttribute('role', 'tab');
    button.id = id;
    button.title = file.path;
    button.setAttribute('aria-label', file.path);
    button.setAttribute('aria-controls', `${id}-panel`);
    const name = document.createElement('span');
    name.textContent = file.name;
    button.append(fileIcon(file), name);
    const tab: EditorTab = {
      id,
      file,
      group,
      mode,
      element,
      button,
      pane: createPreview(file, 0, mode, (content) =>
        this.copyToClipboard(content, 'Source'),
      ),
      revision: 0,
    };
    button.addEventListener('click', () => this.activate(tab));
    button.addEventListener('keydown', (event) => {
      const tabs = tab.group.tabs;
      const current = tabs.indexOf(tab);
      const next =
        event.key === 'ArrowRight'
          ? (current + 1) % tabs.length
          : event.key === 'ArrowLeft'
            ? (current - 1 + tabs.length) % tabs.length
            : event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? tabs.length - 1
                : -1;
      if (event.key === 'Delete') {
        event.preventDefault();
        this.close(tab, true);
      } else if (next >= 0) {
        event.preventDefault();
        this.activate(tabs[next], true);
      }
    });
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'tab-close';
    close.title = 'Close tab';
    close.setAttribute('aria-label', `Close ${file.path}`);
    close.append(icon('close'));
    close.addEventListener('click', () => this.close(tab, true));
    element.append(button, close);
    element.addEventListener('dragstart', (event) => {
      if (!event.dataTransfer) return;
      this.dragged = tab;
      event.dataTransfer.effectAllowed = 'copyMove';
      event.dataTransfer.setData('application/x-fzv-tab', tab.id);
      this.host.classList.add('dragging-tab');
      requestAnimationFrame(() => {
        if (!this.dragged) return;
        this.dragSurface.hidden = false;
        this.highlight.hidden = true;
      });
    });
    this.mountPane(tab);
    group.tabs.push(tab);
    group.active = tab;
    return tab;
  }

  open(file: ProjectFile): void {
    const group = this.selectedGroup;
    this.activate(
      group.tabs.find((tab) => tab.file.path === file.path) ??
        this.makeTab(file, group),
    );
  }

  close(tab: EditorTab, focus = false): void {
    if (this.dragged === tab) this.endDrag();
    const group = tab.group;
    const index = group.tabs.indexOf(tab);
    if (index < 0) return;
    group.tabs.splice(index, 1);
    tab.pane.dispose();
    tab.element.remove();
    if (group.active === tab)
      group.active = group.tabs[Math.min(index, group.tabs.length - 1)] ?? null;
    this.removeEmptyGroup(group);
    this.render();
    if (focus) this.focus();
  }

  private removeEmptyGroup(group: EditorGroup): void {
    if (group.tabs.length || this.groups.size === 1) return;
    const order = groupIds(this.tree);
    const index = order.indexOf(group.id);
    this.tree = removeFromLayout(this.tree, group.id)!;
    this.groups.delete(group.id);
    group.element.remove();
    if (this.selectedGroup === group) {
      const remaining = groupIds(this.tree);
      this.selectedGroup = this.groups.get(
        remaining[Math.min(index, remaining.length - 1)],
      )!;
    }
  }

  focus(): void {
    (this.activeTab?.button ?? document.getElementById('main'))?.focus();
  }
  cycle(direction: number): void {
    const group = this.selectedGroup;
    if (!group.tabs.length) return;
    const index = group.active ? group.tabs.indexOf(group.active) : -1;
    this.activate(
      group.tabs[(index + direction + group.tabs.length) % group.tabs.length],
    );
  }
  focusGroup(index: number): void {
    const id = groupIds(this.tree)[index];
    const group = this.groups.get(id);
    if (group) {
      this.selectGroup(group);
      this.focus();
    }
  }
  splitActive(direction: Direction): void {
    this.split(this.selectedGroup, direction);
  }
  private split(group: EditorGroup, direction: Direction): void {
    if (group.active) this.transfer(group.active, { group, direction }, true);
  }

  private transfer(tab: EditorTab, target: DropTarget, copy: boolean): void {
    const source = tab.group;
    let group = target.group;
    if (target.direction) {
      if (
        this.groups.size >= 32 ||
        (!copy && source === group && source.tabs.length === 1)
      )
        return;
      const added = this.makeGroup();
      this.tree = splitLayout(
        this.tree,
        group.id,
        added.id,
        target.direction,
        `split-${++this.sequence}`,
      );
      group = added;
    }
    const duplicate = group.tabs.find(
      (item) => item.file.path === tab.file.path,
    );
    if (group === source) {
      if (target.index !== undefined) {
        group.tabs.splice(group.tabs.indexOf(tab), 1);
        group.tabs.splice(target.index, 0, tab);
      }
      this.activate(tab, true);
      return;
    }
    if (duplicate && target.index !== undefined) {
      group.tabs.splice(group.tabs.indexOf(duplicate), 1);
      group.tabs.splice(target.index, 0, duplicate);
    }
    if (copy) {
      const added = duplicate ?? this.makeTab(tab.file, group, tab.mode);
      if (!duplicate && target.index !== undefined) {
        group.tabs.splice(group.tabs.indexOf(added), 1);
        group.tabs.splice(target.index, 0, added);
      }
      this.activate(added, true);
      return;
    }
    const index = source.tabs.indexOf(tab);
    source.tabs.splice(index, 1);
    if (source.active === tab)
      source.active =
        source.tabs[Math.min(index, source.tabs.length - 1)] ?? null;
    if (duplicate) {
      tab.pane.dispose();
      tab.element.remove();
    } else {
      tab.group = group;
      group.tabs.splice(target.index ?? group.tabs.length, 0, tab);
    }
    this.selectedGroup = group;
    group.active = duplicate ?? tab;
    this.removeEmptyGroup(source);
    this.activate(duplicate ?? tab, true);
  }

  reload(tab = this.activeTab): void {
    if (!tab) return;
    tab.pane.dispose();
    tab.revision = ++this.revision;
    tab.pane = createPreview(tab.file, tab.revision, tab.mode, (content) =>
      this.copyToClipboard(content, 'Source'),
    );
    this.mountPane(tab);
    this.render();
  }
  private setMode(tab: EditorTab | null, mode: PreviewMode): void {
    if (!tab?.pane.setMode || !hasViewer(tab.file)) return;
    tab.mode = mode;
    tab.pane.setMode(mode);
    this.render();
  }

  frameTab(source: MessageEventSource | null): EditorTab | undefined {
    return this.tabs.find(
      (tab) =>
        tab.group.active === tab &&
        tab.file.kind === 'html' &&
        tab.mode === 'viewer' &&
        tab.pane.element.querySelector('iframe')?.contentWindow === source,
    );
  }
  activateFrame(element: Element | null): void {
    if (!(element instanceof HTMLIFrameElement)) return;
    const tab = this.frameTab(element.contentWindow);
    if (tab) this.selectGroup(tab.group);
  }

  snapshot(): WorkspaceSession {
    return {
      version: 2,
      layout: this.tree,
      activeGroup: this.selectedGroup.id,
      groups: groupIds(this.tree).map((id) => {
        const group = this.groups.get(id)!;
        return {
          id,
          tabs: group.tabs.map((tab) => ({
            path: tab.file.path,
            mode: tab.mode,
          })),
          active: group.active?.file.path ?? null,
        };
      }),
    };
  }

  restore(saved: SavedSession | null, files: ProjectFile[]): void {
    if (!saved) {
      this.render();
      return;
    }
    const byPath = new Map(files.map((file) => [file.path, file]));
    if (saved.version === 1) {
      for (const path of saved.tabs) {
        const file = byPath.get(path);
        if (file) this.makeTab(file, this.selectedGroup);
      }
      this.selectedGroup.active =
        this.selectedGroup.tabs.find((tab) => tab.file.path === saved.active) ??
        this.selectedGroup.tabs[0] ??
        null;
    } else {
      for (const group of this.groups.values()) group.element.remove();
      this.groups.clear();
      const ids = new Map<string, string>();
      for (const entry of saved.groups) {
        const group = this.makeGroup();
        ids.set(entry.id, group.id);
        for (const tab of entry.tabs) {
          const file = byPath.get(tab.path);
          if (file)
            this.makeTab(
              file,
              group,
              hasViewer(file) ? tab.mode : defaultPreviewMode(file),
            );
        }
        group.active =
          group.tabs.find((tab) => tab.file.path === entry.active) ??
          group.tabs[0] ??
          null;
      }
      const remap = (node: LayoutNode): LayoutNode =>
        node.type === 'group'
          ? { type: 'group', id: ids.get(node.id)! }
          : {
              ...node,
              id: `split-${++this.sequence}`,
              children: [remap(node.children[0]), remap(node.children[1])],
            };
      this.tree = remap(saved.layout);
      this.selectedGroup = this.groups.get(ids.get(saved.activeGroup)!)!;
      for (const group of [...this.groups.values()])
        this.removeEmptyGroup(group);
    }
    this.render();
  }

  private render(notify = true): void {
    let number = 0;
    for (const id of groupIds(this.tree)) {
      const group = this.groups.get(id)!;
      group.element.setAttribute('aria-label', `Editor group ${++number}`);
      group.element.classList.toggle('focused', group === this.selectedGroup);
      group.element.classList.toggle('multiple', this.groups.size > 1);
      const focus = group.control<HTMLButtonElement>('group-focus');
      focus.hidden = this.groups.size === 1;
      focus.textContent = String(number);
      focus.setAttribute('aria-label', `Focus editor group ${number}`);
      focus.setAttribute('aria-pressed', String(group === this.selectedGroup));
      focus.title = `Focus editor group ${number} (f)`;
      group.element.setAttribute(
        'aria-owns',
        group.tabs.map((tab) => tab.pane.element.id).join(' '),
      );
      const active = group.active;
      group.control('no-tabs').hidden = !!group.tabs.length;
      group.control('empty-state').hidden = !!active;
      group.control('current-path').textContent =
        active?.file.path ?? 'Ready when you are';
      group.control('current-path').title = active?.file.path ?? '';
      for (const name of ['reload-file', 'split-right', 'split-down'])
        group.control<HTMLButtonElement>(name).disabled =
          !active || (name.startsWith('split-') && this.groups.size >= 32);
      group.control<HTMLButtonElement>('copy-path').disabled = !active;
      group.control('open-file').hidden = !active;
      group.control('download-file').hidden = !active;
      if (active)
        group.control<HTMLAnchorElement>('open-file').href = fileUrl(
          active.file,
          active.revision,
        );
      if (active) {
        const download = group.control<HTMLAnchorElement>('download-file');
        download.href = fileUrl(active.file, active.revision, true);
        download.download = active.file.name;
      }
      group.control('preview-modes').hidden =
        !active || !hasViewer(active.file);
      group
        .control('viewer-mode')
        .setAttribute('aria-pressed', String(active?.mode === 'viewer'));
      group
        .control('source-mode')
        .setAttribute('aria-pressed', String(active?.mode === 'source'));
      group.tabs.forEach((tab, index) => {
        const before = group.tabbar.children[index];
        if (before !== tab.element)
          group.tabbar.insertBefore(tab.element, before ?? null);
        const selected = tab === active;
        tab.element.classList.toggle('active', selected);
        tab.button.setAttribute('aria-selected', String(selected));
        tab.button.tabIndex = selected ? 0 : -1;
        tab.pane.element.hidden = !selected;
        tab.pane.element.dataset.groupId = group.id;
        tab.pane.setActive(selected && group === this.selectedGroup);
      });
    }
    this.layout();
    if (notify) this.onChange();
  }

  private layout(): void {
    this.measured = measureLayout(this.tree, this.hostRect());
    for (const [id, box] of this.measured.groups) {
      const group = this.groups.get(id)!;
      position(group.element, box);
      const header = Math.min(box.height, group.header.offsetHeight);
      for (const tab of group.tabs)
        position(tab.pane.element, {
          ...box,
          y: box.y + header,
          height: Math.max(0, box.height - header),
        });
    }
    for (const [id, element] of this.sashes)
      if (!this.measured.splits.has(id)) {
        element.remove();
        this.sashes.delete(id);
      }
    for (const [id, { node, rect, sash }] of this.measured.splits) {
      let element = this.sashes.get(id);
      if (!element) {
        element = this.makeSash(id);
        this.sashes.set(id, element);
        this.host.append(element);
      }
      element.dataset.axis = node.axis;
      element.setAttribute(
        'aria-orientation',
        node.axis === 'x' ? 'vertical' : 'horizontal',
      );
      element.setAttribute(
        'aria-label',
        node.axis === 'x' ? 'Resize editor columns' : 'Resize editor rows',
      );
      const [min, max] = ratioLimits(
        node,
        node.axis === 'x' ? rect.width : rect.height,
      );
      element.setAttribute('aria-valuemin', String(Math.round(min * 100)));
      element.setAttribute('aria-valuemax', String(Math.round(max * 100)));
      element.setAttribute(
        'aria-valuenow',
        String(Math.round(Math.max(min, Math.min(max, node.ratio)) * 100)),
      );
      position(element, sash);
    }
  }

  private makeSash(id: string): HTMLElement {
    const element = document.createElement('div');
    element.className = 'editor-sash';
    element.setAttribute('role', 'separator');
    element.tabIndex = 0;
    let start: { ratio: number; pointer: number } | null = null;
    const stop = (cancel = false) => {
      if (!start) return;
      const split = this.measured.splits.get(id);
      if (cancel && split) split.node.ratio = start.ratio;
      const pointer = start.pointer;
      start = null;
      if (element.hasPointerCapture(pointer))
        element.releasePointerCapture(pointer);
      this.resizeSurface.hidden = true;
      element.classList.remove('resizing');
      this.layout();
      this.onChange();
    };
    element.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      const split = this.measured.splits.get(id)!;
      start = { ratio: split.node.ratio, pointer: event.pointerId };
      element.setPointerCapture(event.pointerId);
      element.focus();
      element.classList.add('resizing');
      this.resizeSurface.style.cursor =
        split.node.axis === 'x' ? 'col-resize' : 'row-resize';
      this.resizeSurface.hidden = false;
    });
    element.addEventListener('pointermove', (event) => {
      if (!start) return;
      const split = this.measured.splits.get(id)!;
      const host = this.host.getBoundingClientRect();
      const size =
        split.node.axis === 'x' ? split.rect.width : split.rect.height;
      const offset =
        split.node.axis === 'x'
          ? event.clientX - host.left - split.rect.x
          : event.clientY - host.top - split.rect.y;
      const [min, max] = ratioLimits(split.node, size);
      split.node.ratio = Math.max(
        min,
        Math.min(max, (offset - SASH_SIZE / 2) / Math.max(1, size - SASH_SIZE)),
      );
      this.layout();
    });
    element.addEventListener('pointerup', () => stop());
    element.addEventListener('pointercancel', () => stop(true));
    element.addEventListener('lostpointercapture', () => stop());
    element.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && start) {
        event.preventDefault();
        stop(true);
        return;
      }
      const split = this.measured.splits.get(id)!;
      const negative = split.node.axis === 'x' ? 'ArrowLeft' : 'ArrowUp';
      const positive = split.node.axis === 'x' ? 'ArrowRight' : 'ArrowDown';
      if (![negative, positive, 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const [min, max] = ratioLimits(
        split.node,
        split.node.axis === 'x' ? split.rect.width : split.rect.height,
      );
      split.node.ratio =
        event.key === 'Home'
          ? min
          : event.key === 'End'
            ? max
            : Math.max(
                min,
                Math.min(
                  max,
                  split.node.ratio + (event.key === negative ? -0.05 : 0.05),
                ),
              );
      this.layout();
      this.onChange();
    });
    element.addEventListener('dblclick', () => {
      this.measured.splits.get(id)!.node.ratio = 0.5;
      this.layout();
      this.onChange();
    });
    return element;
  }

  private isCopy(event: DragEvent): boolean {
    return /Mac|iPhone|iPad/.test(navigator.platform)
      ? event.altKey
      : event.ctrlKey;
  }
  private endDrag(): void {
    this.dragged = null;
    this.host.classList.remove('dragging-tab');
    this.dragSurface.hidden = true;
    this.highlight.hidden = true;
  }

  private dropTarget(event: DragEvent): DropTarget | null {
    const host = this.host.getBoundingClientRect();
    const x = event.clientX - host.left,
      y = event.clientY - host.top;
    for (const [id, box] of this.measured.groups) {
      if (
        x < box.x ||
        x > box.x + box.width ||
        y < box.y ||
        y > box.y + box.height
      )
        continue;
      const group = this.groups.get(id)!;
      const strip = group.tabbar.getBoundingClientRect();
      if (event.clientY < strip.bottom) {
        if (event.clientX < strip.left + 24) group.tabbar.scrollLeft -= 12;
        if (event.clientX > strip.right - 24) group.tabbar.scrollLeft += 12;
        const tabs = group.tabs.filter(
          (tab) => tab.file.path !== this.dragged?.file.path,
        );
        const index = tabs.findIndex((tab) => {
          const rect = tab.element.getBoundingClientRect();
          return event.clientX < rect.left + rect.width / 2;
        });
        return { group, index: index < 0 ? tabs.length : index };
      }
      const header = group.header.offsetHeight;
      const px = (x - box.x) / box.width;
      const py = (y - box.y - header) / Math.max(1, box.height - header);
      let direction: Direction | undefined;
      // Match VS Code's default: outer 10% offers a split, with left/right
      // preference at corners; the highlight occupies half of the target group.
      if (py >= 0 && (px < 0.1 || px > 0.9 || py < 0.1 || py > 0.9))
        direction =
          px < 1 / 3 ? 'left' : px > 2 / 3 ? 'right' : py < 0.5 ? 'up' : 'down';
      return { group, direction };
    }
    return null;
  }

  private dragOver(event: DragEvent): void {
    if (!this.dragged) return;
    event.preventDefault();
    if (event.dataTransfer)
      event.dataTransfer.dropEffect = this.isCopy(event) ? 'copy' : 'move';
    const target = this.dropTarget(event);
    this.highlight.hidden = !target;
    if (!target) return;
    const box = this.measured.groups.get(target.group.id)!;
    if (target.index !== undefined) {
      const tabs = target.group.tabs.filter(
        (tab) => tab.file.path !== this.dragged?.file.path,
      );
      const before = tabs[target.index]?.element.getBoundingClientRect();
      const after = tabs[target.index - 1]?.element.getBoundingClientRect();
      const strip = target.group.tabbar.getBoundingClientRect();
      const host = this.host.getBoundingClientRect();
      const x = Math.max(
        strip.left,
        Math.min(strip.right - 2, before?.left ?? after?.right ?? strip.left),
      );
      this.highlight.classList.add('tab-insertion');
      position(this.highlight, {
        x: x - host.left,
        y: box.y,
        width: 2,
        height: strip.height,
      });
      return;
    }
    this.highlight.classList.remove('tab-insertion');
    const header = target.group.header.offsetHeight;
    const rect = {
      ...box,
      y: box.y + header,
      height: Math.max(0, box.height - header),
    };
    if (target.direction === 'left' || target.direction === 'right') {
      rect.width /= 2;
      if (target.direction === 'right') rect.x += rect.width;
    }
    if (target.direction === 'up' || target.direction === 'down') {
      rect.height /= 2;
      if (target.direction === 'down') rect.y += rect.height;
    }
    position(this.highlight, rect);
  }
}
