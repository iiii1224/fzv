import { icon } from './icons.js';

export interface SidebarView {
  id: string;
  title: string;
  icon: string;
  /** Shown in the activity bar tooltip, like VS Code's keybinding labels. */
  keybinding: string;
  element: HTMLElement;
  actions?: HTMLElement[];
  focus(): void;
}

interface SidebarState {
  view?: string;
  visible?: boolean;
  width?: number;
}

const STORAGE_KEY = 'fzv:sidebar';
// VS Code's side bar minimum width and a default close to its first-run width.
const MIN_WIDTH = 170;
const DEFAULT_WIDTH = 300;
const NARROW = '(max-width: 700px)';

function readState(): SidebarState {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

/** VS Code's activity bar and primary side bar, with one visible view at a time. */
export class Sidebar {
  private views: SidebarView[] = [];
  private buttons = new Map<string, HTMLButtonElement>();
  private badges = new Map<string, HTMLElement>();
  private active: SidebarView | null = null;
  private state = readState();
  private narrow = window.matchMedia(NARROW);

  constructor(
    private activityBar: HTMLElement,
    private sidebar: HTMLElement,
    private title: HTMLElement,
    private actions: HTMLElement,
    private content: HTMLElement,
    private sash: HTMLElement,
  ) {
    this.setWidth(this.state.width ?? DEFAULT_WIDTH, false);
    this.installSash();
    this.narrow.addEventListener('change', () => {
      this.setVisible(
        !this.narrow.matches && (this.state.visible ?? true),
        false,
      );
    });
    document.addEventListener(
      'pointerdown',
      (event) => {
        const target = event.target as Node;
        if (
          this.narrow.matches &&
          this.visible &&
          !this.sidebar.contains(target) &&
          !this.activityBar.contains(target)
        )
          this.setVisible(false, false);
      },
      { capture: true },
    );
    this.sidebar.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.narrow.matches) {
        event.preventDefault();
        this.setVisible(false, false);
      }
    });
  }

  get visible(): boolean {
    return !this.sidebar.hidden;
  }
  get activeView(): string | null {
    return this.visible ? (this.active?.id ?? null) : null;
  }

  add(view: SidebarView): void {
    if (this.buttons.has(view.id)) return;
    this.views.push(view);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'activity-item';
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-label', view.title);
    button.title = `${view.title} (${view.keybinding})`;
    button.dataset.view = view.id;
    const badge = document.createElement('span');
    badge.className = 'activity-badge';
    badge.hidden = true;
    button.append(icon(view.icon), badge);
    button.addEventListener('click', () => {
      // Clicking the active view's icon hides the side bar, as in VS Code.
      if (this.activeView === view.id) this.setVisible(false);
      else this.show(view.id, false);
    });
    this.buttons.set(view.id, button);
    this.badges.set(view.id, badge);
    this.activityBar.append(button);
    this.activityBar.hidden = false;
    view.element.hidden = true;
    this.content.append(view.element);
    // Restore the saved view; until it is added, show the first one.
    if (this.state.view === view.id || !this.active) {
      this.select(view, false);
      // A narrow window starts with the overlay closed; wide ones restore it.
      this.setVisible(
        !this.narrow.matches && (this.state.visible ?? true),
        false,
      );
    }
  }

  setBadge(id: string, count: number, label: string): void {
    const badge = this.badges.get(id);
    if (!badge) return;
    badge.hidden = count === 0;
    badge.textContent = count > 99 ? '99+' : String(count);
    const view = this.views.find((item) => item.id === id)!;
    const button = this.buttons.get(id)!;
    button.setAttribute(
      'aria-label',
      count ? `${view.title} (${label})` : view.title,
    );
  }

  /** Shows a view. With focus, the view takes keyboard focus like VS Code's view shortcuts. */
  show(id: string, focus = true): void {
    const view = this.views.find((item) => item.id === id);
    if (!view) return;
    this.select(view);
    this.setVisible(true);
    if (focus) view.focus();
  }

  /** Ctrl+Shift+<key>: open and focus a view, or hide the bar when that view has focus. */
  toggleFocus(id: string): void {
    const view = this.views.find((item) => item.id === id);
    if (!view) return;
    if (this.activeView === id && view.element.contains(document.activeElement))
      this.setVisible(false);
    else this.show(id);
  }

  toggle(): void {
    if (this.visible || !this.active) this.setVisible(false);
    else this.setVisible(true);
  }

  /** Narrow layouts overlay the editor, so opening an item gives the space back. */
  afterOpen(): void {
    if (this.narrow.matches) this.setVisible(false, false);
  }

  private select(view: SidebarView, persist = true): void {
    if (this.active === view) return;
    if (this.active) this.active.element.hidden = true;
    this.active = view;
    view.element.hidden = false;
    this.title.textContent = view.title;
    this.actions.replaceChildren(...(view.actions ?? []));
    for (const [id, button] of this.buttons)
      button.setAttribute('aria-selected', String(id === view.id));
    if (persist) this.save({ view: view.id });
  }

  private setVisible(visible: boolean, persist = true): void {
    visible &&= this.active !== null;
    const hadFocus = this.sidebar.contains(document.activeElement);
    this.sidebar.hidden = !visible;
    this.sash.hidden = !visible;
    this.activityBar.classList.toggle('sidebar-hidden', !visible);
    for (const [id, button] of this.buttons)
      button.classList.toggle('checked', visible && id === this.active?.id);
    // Leaving a hidden side bar would drop focus on the body.
    if (!visible && hadFocus) document.getElementById('main')?.focus();
    if (persist) this.save({ visible });
  }

  private setWidth(width: number, persist = true): void {
    const max = Math.max(MIN_WIDTH, window.innerWidth - 300);
    const value = Math.round(Math.min(max, Math.max(MIN_WIDTH, width)));
    this.sidebar.style.setProperty('--sidebar-width', `${value}px`);
    if (persist) this.save({ width: value });
  }

  private installSash(): void {
    this.sash.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      this.sash.setPointerCapture(event.pointerId);
      const start = event.clientX;
      const width = this.sidebar.getBoundingClientRect().width;
      document.body.classList.add('sash-dragging');
      const move = (next: PointerEvent) =>
        this.setWidth(width + next.clientX - start, false);
      const end = (next: PointerEvent) => {
        this.sash.removeEventListener('pointermove', move);
        this.sash.removeEventListener('pointerup', end);
        this.sash.removeEventListener('pointercancel', end);
        document.body.classList.remove('sash-dragging');
        this.setWidth(width + next.clientX - start);
      };
      this.sash.addEventListener('pointermove', move);
      this.sash.addEventListener('pointerup', end);
      this.sash.addEventListener('pointercancel', end);
    });
    // VS Code restores the default size on a sash double-click.
    this.sash.addEventListener('dblclick', () => this.setWidth(DEFAULT_WIDTH));
  }

  private save(change: SidebarState): void {
    this.state = { ...this.state, ...change };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      /* Storage is optional. */
    }
  }
}
