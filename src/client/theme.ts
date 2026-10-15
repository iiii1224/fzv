import { icon } from './icons.js';

type Theme = 'light' | 'dark';
const key = 'fzv:theme';

export function initializeTheme(button: HTMLButtonElement): void {
  const preference = window.matchMedia('(prefers-color-scheme: dark)');
  let selected: Theme | null = null;
  try {
    const saved = localStorage.getItem(key);
    if (saved === 'light' || saved === 'dark') selected = saved;
  } catch {
    /* Theme selection works without storage. */
  }

  const apply = (theme: Theme) => {
    document.documentElement.dataset.theme = theme;
    const label =
      theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme';
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-pressed', String(theme === 'dark'));
    button.title = label;
    const text = document.createElement('span');
    text.textContent = theme === 'light' ? 'Dark' : 'Light';
    button.replaceChildren(icon('color-mode'), text);
  };
  apply(selected ?? (preference.matches ? 'dark' : 'light'));
  preference.addEventListener('change', () => {
    if (!selected) apply(preference.matches ? 'dark' : 'light');
  });
  button.addEventListener('click', () => {
    selected =
      document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    apply(selected);
    try {
      localStorage.setItem(key, selected);
    } catch {
      /* Storage is optional. */
    }
  });
}
