import { createHighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import lightPlus from '@shikijs/themes/light-plus';
import darkPlus from '@shikijs/themes/dark-plus';

// Bundle only languages supported by the file catalog, loading each locally on demand.
const languages = {
  bibtex: () => import('@shikijs/langs/bibtex'),
  c: () => import('@shikijs/langs/c'),
  cpp: () => import('@shikijs/langs/cpp'),
  csharp: () => import('@shikijs/langs/csharp'),
  css: () => import('@shikijs/langs/css'),
  csv: () => import('@shikijs/langs/csv'),
  dockerfile: () => import('@shikijs/langs/dockerfile'),
  go: () => import('@shikijs/langs/go'),
  html: () => import('@shikijs/langs/html'),
  ini: () => import('@shikijs/langs/ini'),
  java: () => import('@shikijs/langs/java'),
  javascript: () => import('@shikijs/langs/javascript'),
  json: () => import('@shikijs/langs/json'),
  jsx: () => import('@shikijs/langs/jsx'),
  latex: () => import('@shikijs/langs/latex'),
  lua: () => import('@shikijs/langs/lua'),
  make: () => import('@shikijs/langs/make'),
  markdown: () => import('@shikijs/langs/markdown'),
  python: () => import('@shikijs/langs/python'),
  r: () => import('@shikijs/langs/r'),
  ruby: () => import('@shikijs/langs/ruby'),
  rust: () => import('@shikijs/langs/rust'),
  scss: () => import('@shikijs/langs/scss'),
  shellscript: () => import('@shikijs/langs/shellscript'),
  sql: () => import('@shikijs/langs/sql'),
  toml: () => import('@shikijs/langs/toml'),
  tsx: () => import('@shikijs/langs/tsx'),
  typescript: () => import('@shikijs/langs/typescript'),
  xml: () => import('@shikijs/langs/xml'),
  yaml: () => import('@shikijs/langs/yaml'),
};
type Language = keyof typeof languages;
const extensions: Record<string, Language> = {
  bib: 'bibtex',
  bst: 'latex',
  c: 'c',
  cc: 'cpp',
  cfg: 'ini',
  cpp: 'cpp',
  cs: 'csharp',
  css: 'css',
  csv: 'csv',
  go: 'go',
  h: 'c',
  hpp: 'cpp',
  htm: 'html',
  html: 'html',
  ini: 'ini',
  java: 'java',
  js: 'javascript',
  json: 'json',
  jsx: 'jsx',
  lua: 'lua',
  md: 'markdown',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  r: 'r',
  rb: 'ruby',
  rs: 'rust',
  scss: 'scss',
  sh: 'shellscript',
  sql: 'sql',
  sty: 'latex',
  tex: 'latex',
  toml: 'toml',
  ts: 'typescript',
  tsx: 'tsx',
  xml: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
};
const highlighter = createHighlighterCore({
  themes: [lightPlus, darkPlus],
  langs: [],
  engine: createJavaScriptRegexEngine(),
});
const loading = new Map<Language, Promise<void>>();

export async function highlightSource(
  element: HTMLElement,
  content: string,
  filename: string,
  signal: AbortSignal,
): Promise<void> {
  const language =
    filename === 'Makefile'
      ? 'make'
      : filename === 'Dockerfile'
        ? 'dockerfile'
        : extensions[filename.split('.').at(-1)!.toLowerCase()];
  // Retain a responsive plain-text view for very large files and unknown formats.
  if (!language || content.length > 512 * 1024 || signal.aborted) return;
  const engine = await highlighter;
  let ready = loading.get(language);
  if (!ready) {
    ready = engine.loadLanguage(languages[language]());
    loading.set(language, ready);
  }
  await ready;
  if (signal.aborted) return;
  const tokens = engine.codeToTokensWithThemes(content, {
    lang: language,
    themes: { light: 'light-plus', dark: 'dark-plus' },
  });
  const fragment = document.createDocumentFragment();
  // Preserve original line endings and trailing newlines when replacing text with tokens.
  const endings = content.match(/\r\n|\r|\n/g) ?? [];
  tokens.forEach((line, index) => {
    if (index) fragment.append(endings[index - 1] ?? '\n');
    for (const token of line) {
      const span = document.createElement('span');
      span.className = 'syntax-token';
      span.textContent = token.content;
      for (const theme of ['light', 'dark']) {
        const variant = token.variants[theme];
        span.style.setProperty(`--syntax-${theme}`, variant.color ?? 'inherit');
        const style = variant.fontStyle ?? 0;
        span.style.setProperty(
          `--syntax-${theme}-style`,
          style & 1 ? 'italic' : 'normal',
        );
        span.style.setProperty(
          `--syntax-${theme}-weight`,
          style & 2 ? 'bold' : 'normal',
        );
        span.style.setProperty(
          `--syntax-${theme}-decoration`,
          style & 4 ? 'underline' : 'none',
        );
      }
      fragment.append(span);
    }
  });
  element.replaceChildren(fragment);
  element.dataset.language = language;
}
