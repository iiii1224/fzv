import type { ProjectEntry } from '../shared.js';

export function icon(name: string): HTMLElement {
  const element = document.createElement('i');
  element.className = `codicon codicon-${name}`;
  element.setAttribute('aria-hidden', 'true');
  return element;
}

export function fileIcon(file: ProjectEntry): HTMLElement {
  return icon(
    file.kind === 'directory'
      ? 'folder'
      : file.kind === 'pdf'
        ? 'file-pdf'
        : file.kind === 'image'
          ? 'file-media'
          : file.kind === 'html'
            ? 'file-code'
            : /\.md$/i.test(file.name)
              ? 'markdown'
              : /\.(?:[cm]?js|jsx|ts|tsx|py|rs|go|c|cc|cpp|h|hpp|cs|java|rb|lua|sh|json|ya?ml|toml|css|scss|xml|sql|tex|sty|bib|bst)$/i.test(
                    file.name,
                  ) || ['Makefile', 'Dockerfile'].includes(file.name)
                ? 'file-code'
                : 'file',
  );
}
