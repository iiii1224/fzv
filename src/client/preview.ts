import type { ProjectFile } from '../shared.js';
import { icon } from './icons.js';
import { markdownView, sourceView } from './text.js';

export type PreviewMode = 'viewer' | 'source';

export function hasViewer(file: ProjectFile): boolean {
  return (
    file.kind === 'html' || (file.kind === 'text' && /\.md$/i.test(file.name))
  );
}

export function defaultPreviewMode(file: ProjectFile): PreviewMode {
  return file.kind === 'text' && !hasViewer(file) ? 'source' : 'viewer';
}

export interface PreviewPane {
  element: HTMLElement;
  setActive(active: boolean): void;
  setMode?(mode: PreviewMode): void;
  dispose(): void;
}
export function fileUrl(
  file: ProjectFile,
  revision = 0,
  standalone = false,
): string {
  const endpoint =
    file.kind === 'html' && !standalone ? '/preview-html' : '/file';
  return `${endpoint}?${new URLSearchParams({ path: file.path, revision: String(revision) })}`;
}
function errorMessage(pane: HTMLElement, message: string): void {
  pane.classList.add('preview-error');
  const text = document.createElement('p');
  text.textContent = message;
  pane.replaceChildren(text);
}

export function createPreview(
  file: ProjectFile,
  revision = 0,
  mode: PreviewMode = defaultPreviewMode(file),
  copySource: (content: string) => void = () => {},
): PreviewPane {
  const element = document.createElement('section');
  element.className = 'preview-pane';
  element.hidden = true;
  element.setAttribute('role', 'tabpanel');
  element.setAttribute('aria-label', file.path);
  const controller = new AbortController();
  let active = false;
  const signal = controller.signal;
  const url = fileUrl(file, revision);
  let setMode: PreviewPane['setMode'];
  if (file.kind === 'text' || file.kind === 'html') {
    const viewer = document.createElement('div');
    viewer.className = 'viewer-surface';
    const source = document.createElement('div');
    source.className = 'source-surface';
    source.textContent = 'Loading…';
    const dualMode = hasViewer(file);
    if (dualMode) element.append(viewer);
    element.append(source);
    if (!dualMode) mode = 'source';
    let currentMode = mode;
    let content: string | undefined;
    let sourceRendered = false;
    let viewerRendered = false;
    const renderText = () => {
      if (content === undefined || signal.aborted) return;
      if (currentMode === 'source' && !sourceRendered) {
        source.replaceChildren(
          sourceView(content, file.name, signal, copySource),
        );
        sourceRendered = true;
      }
      if (currentMode === 'viewer' && file.kind === 'text' && !viewerRendered) {
        viewer.replaceChildren(markdownView(content, file.path));
        viewerRendered = true;
      }
    };
    let textRequest: Promise<void> | undefined;
    const loadText = () => {
      textRequest ??= fetch(fileUrl(file, revision, true), { signal })
        .then((response) => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return response.text();
        })
        .then((text) => {
          content = text;
          renderText();
        })
        .catch((error) => {
          if (signal.aborted) return;
          const message = `Could not load ${file.path}: ${error}`;
          errorMessage(source, message);
          if (file.kind === 'text') errorMessage(viewer, message);
        });
    };
    if (file.kind === 'html') {
      const frame = document.createElement('iframe');
      frame.title = file.path;
      frame.setAttribute('sandbox', 'allow-scripts');
      viewer.append(frame);
      // Load HTML only when its viewer is requested; retain the frame on mode switches.
      setMode = (next) => {
        currentMode = next;
        viewer.hidden = next !== 'viewer';
        source.hidden = next !== 'source';
        if (next === 'source') {
          loadText();
          renderText();
        } else if (!frame.hasAttribute('src')) {
          frame.src = url;
          void fetch(url, { method: 'HEAD', signal })
            .then((response) => {
              if (!response.ok)
                errorMessage(
                  viewer,
                  `Could not load ${file.path} (HTTP ${response.status}).`,
                );
            })
            .catch((error) => {
              if (!signal.aborted) errorMessage(viewer, String(error));
            });
        }
      };
    } else {
      viewer.textContent = 'Loading…';
      loadText();
      setMode = (next) => {
        if (!dualMode) next = 'source';
        currentMode = next;
        viewer.hidden = next !== 'viewer';
        source.hidden = next !== 'source';
        renderText();
      };
    }
    setMode(mode);
  } else if (file.kind === 'pdf') {
    element.textContent = 'Loading…';
    void import('./pdf.js')
      .then(({ mountPdf }) => {
        if (!signal.aborted)
          return mountPdf(element, url, signal, () => active);
      })
      .catch((error) => {
        if (!signal.aborted)
          errorMessage(element, `Could not load ${file.path}: ${error}`);
      });
  } else if (file.kind === 'image') {
    const stage = document.createElement('div');
    stage.className = 'image-stage';
    const image = document.createElement('img');
    image.src = url;
    image.alt = file.path;
    image.draggable = false;
    image.addEventListener(
      'error',
      () => errorMessage(element, `Could not load ${file.path}.`),
      { signal },
    );
    stage.append(image);
    const toolbar = document.createElement('div');
    toolbar.className = 'image-toolbar';
    toolbar.setAttribute('role', 'group');
    toolbar.setAttribute('aria-label', 'Image zoom');
    const zoomValue = document.createElement('span');
    zoomValue.className = 'image-zoom-value';
    zoomValue.textContent = '100%';
    let zoom = 1,
      x = 0,
      y = 0,
      dragging = false,
      dragX = 0,
      dragY = 0;
    const update = () => {
      image.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${zoom})`;
      zoomValue.textContent = `${Math.round(zoom * 100)}%`;
      stage.classList.toggle('zoomed', zoom > 1.001);
    };
    const setZoom = (next: number, clientX?: number, clientY?: number) => {
      const value = Math.max(0.1, Math.min(12, next));
      const ratio = value / zoom;
      if (clientX !== undefined && clientY !== undefined) {
        const rect = stage.getBoundingClientRect();
        const anchorX = clientX - rect.left - rect.width / 2,
          anchorY = clientY - rect.top - rect.height / 2;
        x = anchorX - (anchorX - x) * ratio;
        y = anchorY - (anchorY - y) * ratio;
      } else {
        x *= ratio;
        y *= ratio;
      }
      zoom = value;
      update();
    };
    const button = (label: string, text: string, action: () => void) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.title = label;
      el.setAttribute('aria-label', label);
      el.textContent = text;
      el.addEventListener('click', action, { signal });
      return el;
    };
    const out = button('Zoom out', '', () => setZoom(zoom / 1.25));
    out.append(icon('remove'));
    out.className = 'image-zoom-out';
    const fit = button('Fit image to viewer', 'Fit', () => {
      x = 0;
      y = 0;
      setZoom(1);
    });
    fit.className = 'image-fit';
    const into = button('Zoom in', '', () => setZoom(zoom * 1.25));
    into.append(icon('add'));
    into.className = 'image-zoom-in';
    toolbar.append(out, zoomValue, fit, into);
    stage.addEventListener(
      'wheel',
      (event) => {
        if (!event.ctrlKey) return;
        event.preventDefault();
        setZoom(
          zoom * Math.exp(-event.deltaY * 0.002),
          event.clientX,
          event.clientY,
        );
      },
      { passive: false, signal },
    );
    stage.addEventListener(
      'pointerdown',
      (event) => {
        if (event.button !== 0 || zoom <= 1.001) return;
        dragging = true;
        dragX = event.clientX;
        dragY = event.clientY;
        stage.classList.add('dragging');
        stage.setPointerCapture(event.pointerId);
      },
      { signal },
    );
    stage.addEventListener(
      'pointermove',
      (event) => {
        if (!dragging) return;
        x += event.clientX - dragX;
        y += event.clientY - dragY;
        dragX = event.clientX;
        dragY = event.clientY;
        update();
      },
      { signal },
    );
    const stop = () => {
      dragging = false;
      stage.classList.remove('dragging');
    };
    stage.addEventListener('pointerup', stop, { signal });
    stage.addEventListener('pointercancel', stop, { signal });
    stage.addEventListener('lostpointercapture', stop, { signal });
    element.append(stage, toolbar);
  }
  return {
    element,
    setActive: (value) => {
      active = value;
    },
    setMode,
    dispose: () => {
      controller.abort();
      element.querySelectorAll('iframe').forEach((frame) => frame.remove());
      element.remove();
    },
  };
}
