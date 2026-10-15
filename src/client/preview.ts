import type { ProjectFile } from '../shared.js';

export interface PreviewPane {
  element: HTMLElement;
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

export function createPreview(file: ProjectFile, revision = 0): PreviewPane {
  const element = document.createElement('section');
  element.className = 'preview-pane';
  element.hidden = true;
  element.setAttribute('role', 'tabpanel');
  element.setAttribute('aria-label', file.path);
  const controller = new AbortController();
  const signal = controller.signal;
  const url = fileUrl(file, revision);
  if (file.kind === 'html' || file.kind === 'pdf') {
    const frame = document.createElement('iframe');
    frame.title = file.path;
    if (file.kind === 'html') frame.setAttribute('sandbox', 'allow-scripts');
    frame.src = url;
    element.append(frame);
    // Verify availability separately: browser PDF plugins do not report useful iframe errors.
    void fetch(url, { method: 'HEAD', signal })
      .then((response) => {
        if (!response.ok)
          errorMessage(
            element,
            `Could not load ${file.path} (HTTP ${response.status}).`,
          );
      })
      .catch((error) => {
        if (!signal.aborted) errorMessage(element, String(error));
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
    const out = button('Zoom out', '−', () => setZoom(zoom / 1.25));
    out.className = 'image-zoom-out';
    const fit = button('Fit image to viewer', 'Fit', () => {
      x = 0;
      y = 0;
      setZoom(1);
    });
    fit.className = 'image-fit';
    const into = button('Zoom in', '+', () => setZoom(zoom * 1.25));
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
  } else {
    const text = document.createElement('pre');
    text.className = 'text-preview';
    text.textContent = 'Loading…';
    element.append(text);
    void fetch(url, { signal })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.text();
      })
      .then((content) => {
        text.textContent = content;
      })
      .catch((error) => {
        if (!signal.aborted)
          errorMessage(element, `Could not load ${file.path}: ${error}`);
      });
  }
  return {
    element,
    dispose: () => {
      controller.abort();
      element.querySelectorAll('iframe').forEach((frame) => frame.remove());
      element.remove();
    },
  };
}
