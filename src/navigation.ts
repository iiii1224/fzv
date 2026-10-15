export interface NavigationOptions {
  getScrollRoot?: () => HTMLElement | null;
  onScroll?: (
    key: 'h' | 'j' | 'k' | 'l' | 'top' | 'bottom',
  ) => boolean;
  onSearch?: () => void;
  onReload?: () => void;
  onFocus?: () => void;
  onHintActivate?: (target: HTMLElement) => boolean;
  bridgeWorkspace?: boolean;
}

// Keep this function self-contained: the server also serializes it into sandboxed
// HTML previews. No parent DOM/storage access or external script is required.
export function installNavigation(options: NavigationOptions = {}): {
  cancel(): void;
  showHints(): void;
  showHelp(): void;
  dispose(): void;
} {
  const lifecycle = new AbortController();
  const signal = lifecycle.signal;
  const alphabet = 'asdfghjkl';
  let pendingG = 0;
  let overlay: HTMLElement | null = null;
  let hints: { label: string; target: HTMLElement; badge: HTMLElement }[] = [];
  let prefix = '';
  let help: HTMLDialogElement | null = null;

  const cancel = () => {
    overlay?.remove();
    overlay = null;
    hints = [];
    prefix = '';
    pendingG = 0;
  };
  const closeHelp = () => {
    if (!help) return;
    const dialog = help;
    help = null;
    if (dialog.open) dialog.close();
    dialog.remove();
  };
  const showHelp = () => {
    if (help) return;
    cancel();
    const dialog = document.createElement('dialog');
    help = dialog;
    dialog.setAttribute('aria-labelledby', 'fzv-keyboard-help-title');
    Object.assign(dialog.style, {
      position: 'fixed',
      inset: '0',
      margin: 'auto',
      width: 'min(520px, calc(100vw - 28px))',
      maxHeight: 'min(80vh, 640px)',
      overflow: 'auto',
      padding: '20px 22px',
      border: '1px solid #8888',
      borderRadius: '8px',
      background: '#f8f8f8',
      color: '#202020',
      boxShadow: '0 12px 40px #0005',
      font: '13px/1.5 system-ui, sans-serif',
      zIndex: '2147483647',
    });
    const heading = document.createElement('div');
    Object.assign(heading.style, {
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      marginBottom: '14px',
    });
    const title = document.createElement('h2');
    title.id = 'fzv-keyboard-help-title';
    title.textContent = 'Keyboard shortcuts';
    Object.assign(title.style, { flex: '1', margin: '0', fontSize: '16px' });
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'Close';
    close.setAttribute('aria-label', 'Close keyboard shortcuts');
    Object.assign(close.style, {
      padding: '5px 9px',
      border: '1px solid #8888',
      borderRadius: '4px',
      background: '#fff',
      color: 'inherit',
      font: 'inherit',
      cursor: 'pointer',
    });
    close.addEventListener('click', closeHelp, { signal });
    heading.append(title, close);
    const bindings: [string, string][] = [
      ['/', 'Find a file'],
      ['r', 'Reload the active preview'],
      [
        'f',
        options.bridgeWorkspace
          ? 'Show workspace hints'
          : 'Show hints for links and controls',
      ],
      ['h j k l', 'Scroll the active preview'],
      ['gg', 'Scroll to the top'],
      ['G', 'Scroll to the bottom'],
      ['?', 'Show this keyboard help'],
      ['Escape', 'Cancel hints or close this help'],
    ];
    if (!options.bridgeWorkspace) {
      bindings.push(
        ['Ctrl/Cmd + Tab', 'Switch tabs in the focused group'],
        ['Alt + j / k', 'Switch tabs in the focused group'],
        ['Ctrl/Cmd + 1–9', 'Focus an editor group'],
        ['Ctrl/Cmd + \\', 'Split the editor to the right'],
        ['Ctrl/Cmd + Shift + \\', 'Split the editor below'],
        ['Ctrl/Cmd + f', 'Find in a PDF'],
        ['Ctrl/Cmd + + / − / 0', 'Zoom an image or PDF'],
      );
    }
    const list = document.createElement('div');
    Object.assign(list.style, {
      display: 'grid',
      gridTemplateColumns: 'minmax(125px, auto) minmax(0, 1fr)',
      gap: '7px 14px',
      alignItems: 'center',
    });
    for (const [keys, description] of bindings) {
      const label = document.createElement('kbd');
      label.textContent = keys;
      Object.assign(label.style, {
        justifySelf: 'start',
        padding: '2px 5px',
        border: '1px solid #aaa',
        borderRadius: '3px',
        background: '#eee',
        color: 'inherit',
        font: '11px ui-monospace, monospace',
        whiteSpace: 'nowrap',
      });
      const text = document.createElement('span');
      text.textContent = description;
      list.append(label, text);
    }
    dialog.append(heading, list);
    dialog.addEventListener(
      'cancel',
      (event) => {
        event.preventDefault();
        closeHelp();
      },
      { signal },
    );
    document.body.append(dialog);
    dialog.showModal();
    close.focus();
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
  const scroll = (key: 'h' | 'j' | 'k' | 'l' | 'top' | 'bottom') => {
    const root = scrollRoot();
    if (!root) return;
    if (key === 'top') root.scrollTo({ top: 0, behavior: 'instant' });
    else if (key === 'bottom')
      root.scrollTo({ top: root.scrollHeight, behavior: 'instant' });
    else
      root.scrollBy({
        left: key === 'h' ? -64 : key === 'l' ? 64 : 0,
        top: key === 'j' ? 64 : key === 'k' ? -64 : 0,
        behavior: 'instant',
      });
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
      if (help) {
        if (event.key === 'Escape') {
          closeHelp();
          consume();
        }
        return;
      }
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
            if (!options.onHintActivate?.(target)) target.click();
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
      if (event.key === '?') {
        consume();
        showHelp();
        return;
      }
      if (event.key === 'r' && options.onReload) {
        consume();
        options.onReload();
        return;
      }
      if (event.key === 'f' && !event.repeat) {
        consume();
        if (options.bridgeWorkspace)
          parent.postMessage({ type: 'fzv:shortcut', key: 'f' }, '*');
        else showHints();
        return;
      }
      if (event.key === 'g') {
        consume();
        if (event.repeat) return;
        const now = performance.now();
        if (wasG && now - wasG < 800) {
          if (!options.onScroll?.('top')) scroll('top');
        } else pendingG = now;
        return;
      }
      if (!['h', 'j', 'k', 'l', 'G'].includes(event.key)) return;
      consume();
      const key: 'h' | 'j' | 'k' | 'l' | 'bottom' =
        event.key === 'G' ? 'bottom' : (event.key as 'h' | 'j' | 'k' | 'l');
      if (!options.onScroll?.(key)) scroll(key);
    },
    { capture: true, signal },
  );
  window.addEventListener('blur', cancel, { signal });
  window.addEventListener(
    'message',
    (event) => {
      if (
        !options.bridgeWorkspace ||
        parent === window ||
        event.source !== parent
      )
        return;
      if (event.data?.type === 'fzv:show-hints') showHints();
      if (
        event.data?.type === 'fzv:scroll' &&
        ['h', 'j', 'k', 'l', 'top', 'bottom'].includes(event.data.key)
      )
        scroll(event.data.key);
    },
    { signal },
  );
  window.addEventListener('resize', cancel, { signal });
  document.addEventListener('pointerdown', cancel, { capture: true, signal });
  document.addEventListener('pointerdown', () => options.onFocus?.(), {
    capture: true,
    signal,
  });
  document.addEventListener('focusin', () => options.onFocus?.(), { signal });
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
    showHints,
    showHelp,
    dispose: () => {
      cancel();
      closeHelp();
      lifecycle.abort();
    },
  };
}
