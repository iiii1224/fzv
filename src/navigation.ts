export interface NavigationOptions {
  getScrollRoot?: () => HTMLElement | null;
  onSearch?: () => void;
  onReload?: () => void;
}

// Keep this function self-contained: the server also serializes it into sandboxed
// HTML previews. No parent DOM/storage access or external script is required.
export function installNavigation(options: NavigationOptions = {}): {
  cancel(): void;
  dispose(): void;
} {
  const lifecycle = new AbortController();
  const signal = lifecycle.signal;
  const alphabet = 'asdfghjkl';
  let pendingG = 0;
  let overlay: HTMLElement | null = null;
  let hints: { label: string; target: HTMLElement; badge: HTMLElement }[] = [];
  let prefix = '';

  const cancel = () => {
    overlay?.remove();
    overlay = null;
    hints = [];
    prefix = '';
    pendingG = 0;
  };
  const editable = (element: EventTarget | null) =>
    element instanceof HTMLElement &&
    (element.isContentEditable ||
      Boolean(element.closest('input, textarea, select, [role="textbox"]')));

  const showHints = () => {
    cancel();
    const root = document.querySelector('dialog[open]') ?? document.body;
    const targets = [
      ...root.querySelectorAll<HTMLElement>(
        'a[href], button:not(:disabled), input:not(:disabled):not([type="hidden"]), textarea:not(:disabled), select:not(:disabled), summary, [role="button"], [tabindex]:not([tabindex="-1"]), [contenteditable]:not([contenteditable="false"]), iframe',
      ),
    ].filter((target) => {
      if (
        target.matches(':disabled') ||
        target.closest('[hidden], [inert], [aria-disabled="true"]')
      )
        return false;
      const style = getComputedStyle(target);
      if (
        style.visibility !== 'visible' ||
        style.display === 'none' ||
        style.opacity === '0'
      )
        return false;
      const rect = target.getBoundingClientRect();
      const left = Math.max(0, rect.left),
        right = Math.min(innerWidth, rect.right);
      const top = Math.max(0, rect.top),
        bottom = Math.min(innerHeight, rect.bottom);
      if (left >= right || top >= bottom) return false;
      const atPoint = document.elementFromPoint(
        (left + right) / 2,
        (top + bottom) / 2,
      );
      return atPoint === target || Boolean(atPoint && target.contains(atPoint));
    });
    if (!targets.length) return;
    overlay = document.createElement('div');
    overlay.className = 'vim-hints';
    overlay.setAttribute(
      'aria-label',
      'Link hints; type a label to jump, Escape to cancel',
    );
    overlay.style.pointerEvents = 'none';
    const length = Math.max(
      1,
      Math.ceil(Math.log(targets.length) / Math.log(alphabet.length)),
    );
    hints = targets.map((target, index) => {
      let value = index;
      let label = '';
      for (let digit = 0; digit < length; digit++) {
        label = alphabet[value % alphabet.length] + label;
        value = Math.floor(value / alphabet.length);
      }
      const rect = target.getBoundingClientRect();
      const badge = document.createElement('span');
      badge.className = 'vim-hint';
      badge.dataset.hintTarget =
        target.id ||
        target.getAttribute('aria-label') ||
        target.textContent?.trim() ||
        target.tagName;
      badge.textContent = label.toUpperCase();
      badge.setAttribute('aria-hidden', 'true');
      // Individual style properties also work under the application's strict CSP.
      Object.assign(badge.style, {
        position: 'fixed',
        zIndex: '2147483647',
        pointerEvents: 'none',
        left: `${Math.max(0, Math.min(innerWidth - 32, rect.left))}px`,
        top: `${Math.max(0, Math.min(innerHeight - 20, rect.top))}px`,
        font: 'bold 12px/18px monospace',
        padding: '0 3px',
        color: '#1f1f1f',
        backgroundColor: '#ffdf80',
        border: '1px solid #b78618',
        borderRadius: '2px',
        boxShadow: '0 1px 2px #0003',
      });
      overlay!.append(badge);
      return { target, label, badge };
    });
    root.append(overlay);
  };

  const scrollRoot = (): HTMLElement | null => {
    const supplied = options.getScrollRoot?.();
    if (supplied) return supplied;
    let element = document.activeElement;
    while (element instanceof HTMLElement && element !== document.body) {
      const style = getComputedStyle(element);
      if (
        /(auto|scroll)/.test(style.overflowY + style.overflowX) &&
        (element.scrollHeight > element.clientHeight ||
          element.scrollWidth > element.clientWidth)
      )
        return element;
      element = element.parentElement;
    }
    return document.scrollingElement as HTMLElement | null;
  };

  window.addEventListener(
    'keydown',
    (event) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        editable(event.composedPath()[0] ?? event.target)
      ) {
        pendingG = 0;
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) {
        pendingG = 0;
        return;
      }
      const consume = () => {
        event.preventDefault();
        event.stopImmediatePropagation();
      };
      if (event.key === 'Escape') {
        if (overlay || pendingG) {
          cancel();
          consume();
        }
        return;
      }
      if (overlay) {
        consume();
        if (event.key === 'Backspace') prefix = prefix.slice(0, -1);
        else if (event.key.length === 1) prefix += event.key.toLowerCase();
        else return;
        const matches = hints.filter((hint) => hint.label.startsWith(prefix));
        for (const hint of hints)
          hint.badge.hidden = !hint.label.startsWith(prefix);
        if (!matches.length) {
          cancel();
          return;
        }
        const match = matches.find((hint) => hint.label === prefix);
        if (match) {
          const target = match.target;
          cancel();
          if (target.isConnected) {
            target.focus();
            target.click();
          }
        }
        return;
      }
      const wasG = pendingG;
      pendingG = 0;
      if (event.key === '/' && options.onSearch) {
        consume();
        options.onSearch();
        return;
      }
      if (event.key === 'r' && options.onReload) {
        consume();
        options.onReload();
        return;
      }
      if (event.key === 'f' && !event.repeat) {
        consume();
        showHints();
        return;
      }
      if (event.key === 'g') {
        consume();
        if (event.repeat) return;
        const now = performance.now();
        if (wasG && now - wasG < 800)
          scrollRoot()?.scrollTo({ top: 0, behavior: 'instant' });
        else pendingG = now;
        return;
      }
      if (!['h', 'j', 'k', 'l', 'G'].includes(event.key)) return;
      consume();
      const root = scrollRoot();
      if (event.key === 'G')
        root?.scrollTo({ top: root.scrollHeight, behavior: 'instant' });
      else
        root?.scrollBy({
          left: event.key === 'h' ? -64 : event.key === 'l' ? 64 : 0,
          top: event.key === 'j' ? 64 : event.key === 'k' ? -64 : 0,
          behavior: 'instant',
        });
    },
    { capture: true, signal },
  );
  window.addEventListener('blur', cancel, { signal });
  window.addEventListener('resize', cancel, { signal });
  document.addEventListener('pointerdown', cancel, { capture: true, signal });
  document.addEventListener(
    'scroll',
    () => {
      if (overlay) cancel();
    },
    { capture: true, signal },
  );
  document.addEventListener(
    'focusin',
    (event) => {
      pendingG = 0;
      if (editable(event.target)) cancel();
    },
    { signal },
  );
  return {
    cancel,
    dispose: () => {
      cancel();
      lifecycle.abort();
    },
  };
}
