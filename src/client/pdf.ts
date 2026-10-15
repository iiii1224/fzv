import {
  AnnotationEditorType,
  AnnotationMode,
  getDocument,
  GlobalWorkerOptions,
} from 'pdfjs-dist';
import {
  EventBus,
  FindState,
  LinkTarget,
  PDFFindController,
  PDFLinkService,
  PDFViewer,
} from 'pdfjs-dist/web/pdf_viewer.mjs';
import 'pdfjs-dist/web/pdf_viewer.css';
import './pdf.css';

GlobalWorkerOptions.workerSrc = '/pdfjs/build/pdf.worker.mjs';

interface FindUpdate {
  state?: number;
  matchesCount: { current: number; total: number };
}

export async function mountPdf(
  pane: HTMLElement,
  url: string,
  parentSignal: AbortSignal,
  isActive: () => boolean,
): Promise<void> {
  const lifecycle = new AbortController();
  const signal = AbortSignal.any([parentSignal, lifecycle.signal]);
  const toolbar = document.createElement('div');
  toolbar.className = 'pdf-toolbar';
  toolbar.setAttribute('role', 'group');
  toolbar.setAttribute('aria-label', 'PDF controls');
  const container = document.createElement('div');
  container.className = 'pdf-scroll';
  container.tabIndex = 0;
  container.setAttribute('role', 'region');
  container.setAttribute('aria-label', 'PDF document');
  const pages = document.createElement('div');
  pages.className = 'pdfViewer';
  container.append(pages);
  const status = document.createElement('span');
  status.className = 'pdf-status';
  status.textContent = 'Loading…';
  const zoom = document.createElement('span');
  zoom.className = 'pdf-zoom';
  const search = document.createElement('input');
  search.type = 'text';
  search.placeholder = 'Find in PDF';
  search.setAttribute('aria-label', 'Find in PDF');
  const matches = document.createElement('span');
  matches.className = 'pdf-matches';
  matches.setAttribute('role', 'status');
  const eventBus = new EventBus();
  const linkService = new PDFLinkService({
    eventBus,
    externalLinkTarget: LinkTarget.BLANK,
    externalLinkRel: 'noopener noreferrer',
  });
  const findController = new PDFFindController({ eventBus, linkService });
  pane.replaceChildren(toolbar, container);
  // abortSignal is supported by PDF.js 6.4; its distributed types omit it.
  const options = {
    container,
    viewer: pages,
    eventBus,
    linkService,
    findController,
    abortSignal: signal,
    annotationMode: AnnotationMode.ENABLE,
    annotationEditorMode: AnnotationEditorType.DISABLE,
    maxCanvasPixels: 16 * 1024 * 1024,
  };
  const viewer = new PDFViewer(options);
  linkService.setViewer(viewer);
  let ready = false;
  const button = (label: string, text: string, action: () => void) => {
    const control = document.createElement('button');
    control.type = 'button';
    control.textContent = text;
    control.title = label;
    control.setAttribute('aria-label', label);
    control.addEventListener('click', action, { signal });
    toolbar.append(control);
    return control;
  };
  const zoomBy = (factor: number, origin?: [number, number]) => {
    if (!ready) return;
    const scale = Math.min(5, Math.max(0.25, viewer.currentScale * factor));
    if (origin)
      viewer.updateScale({
        scaleFactor: scale / viewer.currentScale,
        origin,
        drawingDelay: 100,
      });
    else viewer.currentScale = scale;
  };
  container.addEventListener(
    'wheel',
    (event) => {
      if (
        !event.ctrlKey ||
        pane.hidden ||
        document.querySelector('dialog[open]')
      )
        return;
      event.preventDefault();
      if (!event.deltaY) return;
      const unit =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? 16
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? container.clientHeight
            : 1;
      const delta = Math.max(-300, Math.min(300, event.deltaY * unit));
      const rect = container.getBoundingClientRect();
      // PDF.js expects the origin in the container's offset-parent coordinates.
      zoomBy(Math.exp(-delta * 0.002), [
        event.clientX - rect.left + container.offsetLeft,
        event.clientY - rect.top + container.offsetTop,
      ]);
    },
    { passive: false, signal },
  );
  button('Zoom out PDF', '−', () => zoomBy(1 / 1.25));
  toolbar.append(zoom);
  button('Zoom in PDF', '+', () => zoomBy(1.25));
  button('Fit PDF to width', 'Fit', () => {
    if (ready) viewer.currentScaleValue = 'page-width';
  });
  toolbar.append(status, search);
  const find = (again = false, previous = false) => {
    if (!ready) return;
    eventBus.dispatch('find', {
      source: search,
      type: again ? 'again' : '',
      query: search.value,
      caseSensitive: false,
      entireWord: false,
      highlightAll: true,
      findPrevious: previous,
      matchDiacritics: false,
    });
  };
  button('Previous PDF match', '↑', () => find(true, true));
  button('Next PDF match', '↓', () => find(true));
  toolbar.append(matches);
  search.addEventListener('input', () => find(), { signal });
  search.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        find(true, event.shiftKey);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        container.focus();
      }
    },
    { signal },
  );
  window.addEventListener(
    'keydown',
    (event) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        pane.hidden ||
        !isActive() ||
        document.querySelector('dialog[open]') ||
        event.altKey ||
        !(event.ctrlKey || event.metaKey)
      )
        return;
      if (event.key.toLowerCase() === 'f') {
        event.preventDefault();
        search.focus();
        search.select();
      } else if (
        !event
          .composedPath()
          .some(
            (target) =>
              target instanceof HTMLElement &&
              target.matches('input,textarea,select,[contenteditable]'),
          )
      ) {
        if (['+', '='].includes(event.key)) {
          event.preventDefault();
          zoomBy(1.25);
        } else if (['-', '_'].includes(event.key)) {
          event.preventDefault();
          zoomBy(1 / 1.25);
        } else if (event.key === '0' && ready) {
          event.preventDefault();
          viewer.currentScaleValue = 'page-width';
        }
      }
    },
    { signal },
  );
  const listen = <T>(name: string, listener: (event: T) => void) => {
    eventBus.on(name, listener, { signal });
  };
  const updateStatus = () => {
    status.textContent = `${viewer.currentPageNumber} / ${viewer.pagesCount}`;
  };
  const resize = new ResizeObserver(() => {
    if (!ready || !container.clientWidth) return;
    if (!viewer.currentScaleValue || viewer.currentScaleValue === 'page-width')
      viewer.currentScaleValue = 'page-width';
    viewer.update();
  });
  resize.observe(container);
  listen('pagesinit', () => {
    ready = true;
    if (container.clientWidth) viewer.currentScaleValue = 'page-width';
    container.scrollTop = 0;
    updateStatus();
    if (search.value) find();
  });
  listen('pagechanging', updateStatus);
  listen('scalechanging', ({ scale }: { scale: number }) => {
    zoom.textContent = `${Math.round(scale * 100)}%`;
  });
  listen('updatefindmatchescount', ({ matchesCount }: FindUpdate) => {
    matches.textContent = `${matchesCount.current} / ${matchesCount.total}`;
  });
  listen('updatefindcontrolstate', ({ state, matchesCount }: FindUpdate) => {
    matches.textContent = !search.value
      ? ''
      : state === FindState.NOT_FOUND
        ? 'No matches'
        : `${matchesCount.current} / ${matchesCount.total}`;
  });
  const loading = getDocument({
    url,
    cMapUrl: '/pdfjs/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: '/pdfjs/standard_fonts/',
    useSystemFonts: false,
    wasmUrl: '/pdfjs/wasm/',
    iccUrl: '/pdfjs/iccs/',
    enableXfa: false,
  });
  const dispose = () => {
    ready = false;
    resize.disconnect();
    viewer.setDocument(null);
    linkService.setDocument(null);
    void viewer.l10n?.destroy();
    void loading.destroy().catch(() => {});
  };
  signal.addEventListener('abort', dispose, { once: true });
  try {
    const pdf = await loading.promise;
    if (signal.aborted) return;
    linkService.setDocument(pdf);
    viewer.setDocument(pdf);
  } catch (error) {
    lifecycle.abort();
    throw error;
  }
}
