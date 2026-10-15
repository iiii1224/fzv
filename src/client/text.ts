import { marked } from 'marked';
import DOMPurify from 'dompurify';

// Local resources use the same validated route as HTML preview assets.
function resourceUrl(value: string, path: string): string | null {
  if (value.startsWith('#')) return value;
  const base = new URL(
    path.split('/').map(encodeURIComponent).join('/'),
    'https://project.invalid/',
  );
  const url = new URL(value, base);
  if (url.origin === base.origin)
    return `/asset${url.pathname}${url.search}${url.hash}`;
  return ['http:', 'https:', 'mailto:'].includes(url.protocol)
    ? url.href
    : null;
}

export function markdownView(content: string, path: string): HTMLElement {
  const article = document.createElement('article');
  article.className = 'markdown-preview';
  article.append(
    DOMPurify.sanitize(marked.parse(content, { async: false }), {
      USE_PROFILES: { html: true },
      FORBID_TAGS: ['style', 'form', 'button'],
      FORBID_ATTR: ['style', 'id', 'name', 'class'],
      RETURN_DOM_FRAGMENT: true,
    }),
  );
  for (const element of article.querySelectorAll('a, img')) {
    const attribute = element.tagName === 'A' ? 'href' : 'src';
    const value = element.getAttribute(attribute);
    element.removeAttribute('srcset');
    if (!value) continue;
    try {
      const url = resourceUrl(value, path);
      if (url) element.setAttribute(attribute, url);
      else element.removeAttribute(attribute);
    } catch {
      element.removeAttribute(attribute);
    }
    if (element instanceof HTMLAnchorElement) {
      element.target = '_blank';
      element.rel = 'noopener noreferrer';
    }
  }
  return article;
}

export function sourceView(
  content: string,
  filename: string,
  signal: AbortSignal,
): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'source-preview';
  const numbers = document.createElement('pre');
  numbers.className = 'line-numbers';
  numbers.setAttribute('aria-hidden', 'true');
  numbers.textContent = Array.from(
    { length: content.split(/\r\n|\r|\n/).length },
    (_, index) => String(index + 1),
  ).join('\n');
  const text = document.createElement('pre');
  text.className = 'text-preview source-text';
  text.textContent = content;
  wrapper.append(numbers, text);
  void import('./highlight.js')
    .then(({ highlightSource }) =>
      highlightSource(text, content, filename, signal),
    )
    .catch(() => {
      /* Keep exact source visible if a grammar cannot be loaded. */
    });
  return wrapper;
}
