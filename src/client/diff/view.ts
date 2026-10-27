import type { GitStage } from '../../shared.js';
import { icon } from '../icons.js';
import type { PreviewPane } from '../preview.js';
import type { SyntaxToken } from '../highlight.js';
import {
  buildRows,
  decorations,
  splitLines,
  unchangedRegions,
} from './model.js';
import type {
  DiffLayout,
  DiffResult,
  DiffRow,
  LineHighlight,
  SideDecorations,
} from './model.js';

export interface DiffTarget {
  path: string;
  name: string;
  stage: GitStage;
  /** Source path of a staged rename or copy. */
  originalPath?: string;
}
export interface DiffViewState {
  layout: DiffLayout;
  /** Collapse unchanged regions, like VS Code's hideUnchangedRegions. */
  collapse: boolean;
  ignoreTrimWhitespace: boolean;
}
export const DEFAULT_DIFF_STATE: DiffViewState = {
  layout: 'side-by-side',
  collapse: false,
  ignoreTrimWhitespace: false,
};
export interface DiffPane extends PreviewPane {
  update(state: DiffViewState): void;
  navigate(direction: 1 | -1): void;
  /** Scrolls to the first change once it is computed, like VS Code's revealFirstDiff. */
  revealFirstChange(): void;
}

const LINE_HEIGHT = 20;
// VS Code's diffEditor.maxComputationTime default.
const MAX_COMPUTATION_TIME = 5000;

export const STAGE_LABELS: Record<GitStage, [string, string]> = {
  index: ['HEAD', 'Index'],
  worktree: ['Index', 'Working Tree'],
};

/** Text for one side, or null when the file does not exist at that revision. */
async function readSide(
  url: string,
  signal: AbortSignal,
): Promise<string | null> {
  const response = await fetch(url, { signal });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

function sourceUrls(target: DiffTarget, revision: number): [string, string] {
  const git = (path: string, from: 'HEAD' | 'index') =>
    `/api/git/file?${new URLSearchParams({ path, revision: from, r: String(revision) })}`;
  return target.stage === 'index'
    ? [
        git(target.originalPath ?? target.path, 'HEAD'),
        git(target.path, 'index'),
      ]
    : [
        git(target.path, 'index'),
        `/file?${new URLSearchParams({ path: target.path, revision: String(revision) })}`,
      ];
}

function runDiff(
  original: string[],
  modified: string[],
  ignoreTrimWhitespace: boolean,
  signal: AbortSignal,
): Promise<DiffResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./worker.ts', import.meta.url), {
      type: 'module',
    });
    const stop = () => {
      worker.terminate();
      reject(signal.reason);
    };
    signal.addEventListener('abort', stop, { once: true });
    worker.addEventListener('message', (event: MessageEvent<DiffResult>) => {
      signal.removeEventListener('abort', stop);
      worker.terminate();
      resolve(event.data);
    });
    worker.addEventListener('error', (event) => {
      signal.removeEventListener('abort', stop);
      worker.terminate();
      reject(new Error(event.message || 'The diff worker failed.'));
    });
    worker.postMessage({
      original,
      modified,
      options: {
        ignoreTrimWhitespace,
        maxComputationTimeMs: MAX_COMPUTATION_TIME,
      },
    });
  });
}

async function tokenize(
  text: string,
  lineCount: number,
  name: string,
  signal: AbortSignal,
): Promise<SyntaxToken[][] | null> {
  try {
    const { tokenizeSource } = await import('../highlight.js');
    const tokens = await tokenizeSource(text, name, signal);
    // Lone CR line breaks can split differently; fall back to plain text.
    return tokens?.length === lineCount ? tokens : null;
  } catch {
    return null;
  }
}

/** Renders text with syntax tokens and inner change marks, without innerHTML. */
function renderCode(
  cell: HTMLElement,
  text: string,
  tokens: SyntaxToken[] | undefined,
  highlights: LineHighlight[] | undefined,
  className: 'char-insert' | 'char-delete',
  tokenSpan: ((token: SyntaxToken, text: string) => HTMLElement) | null,
): void {
  const marked = highlights?.length ? new Uint8Array(text.length) : null;
  const empty = new Set<number>();
  for (const { start, end } of highlights ?? [])
    if (start === end) empty.add(start);
    else marked!.fill(1, start, end);
  const marker = () => {
    const element = document.createElement('span');
    element.className = `${className} diff-range-empty`;
    return element;
  };
  const pieces =
    tokens && tokenSpan
      ? tokens.map((token) => ({ text: token.content, token }))
      : [{ text, token: undefined }];
  let offset = 0;
  for (const piece of pieces) {
    let index = 0;
    while (index < piece.text.length) {
      if (empty.delete(offset + index)) cell.append(marker());
      const on = marked?.[offset + index] ?? 0;
      let end = index + 1;
      while (
        end < piece.text.length &&
        (marked?.[offset + end] ?? 0) === on &&
        !empty.has(offset + end)
      )
        end++;
      const slice = piece.text.slice(index, end);
      const node: Node = piece.token
        ? tokenSpan!(piece.token, slice)
        : document.createTextNode(slice);
      if (on) {
        const mark = document.createElement('span');
        mark.className = className;
        mark.append(node);
        cell.append(mark);
      } else cell.append(node);
      index = end;
    }
    offset += piece.text.length;
  }
  if (empty.size) cell.append(marker());
}

export function createDiffPreview(
  target: DiffTarget,
  revision: number,
  initial: DiffViewState,
): DiffPane {
  const element = document.createElement('section');
  element.className = 'preview-pane diff-pane';
  element.hidden = true;
  element.setAttribute('role', 'tabpanel');
  element.setAttribute(
    'aria-label',
    `${target.path} (${STAGE_LABELS[target.stage][1]})`,
  );
  const controller = new AbortController();
  const signal = controller.signal;
  const editor = document.createElement('div');
  editor.className = 'diff-editor';
  const message = document.createElement('div');
  message.className = 'diff-message';
  message.setAttribute('role', 'status');
  message.textContent = 'Loading…';
  editor.append(message);
  element.append(editor);

  let state = { ...initial };
  let texts: [string[], string[]] | null = null;
  let exists: [boolean, boolean] = [true, true];
  let result: DiffResult | null = null;
  let tokens: [SyntaxToken[][] | null, SyntaxToken[][] | null] = [null, null];
  let tokenSpan: ((token: SyntaxToken, text: string) => HTMLElement) | null =
    null;
  let computing: AbortController | null = null;
  const expanded = new Set<number>();
  let rows: DiffRow[] = [];
  let scrollers: HTMLElement[] = [];
  let changeStarts: number[] = [];
  let revealPending = false;

  // Revealed changes sit a third of the way down the editor.
  const revealOffset = (scroller: HTMLElement) =>
    Math.floor(scroller.clientHeight / 3);
  const reveal = (row: number | undefined) => {
    const scroller = scrollers.at(-1);
    if (scroller && row !== undefined)
      scroller.scrollTop = row * LINE_HEIGHT - revealOffset(scroller);
  };

  const setMessage = (text: string) => {
    message.textContent = text;
    message.hidden = !text;
  };

  const render = () => {
    if (!texts || !result) return;
    const [originalLines, modifiedLines] = texts;
    const { changes } = result;
    const previousTop = scrollers.at(-1)?.scrollTop ?? 0;
    const regions = state.collapse
      ? unchangedRegions(changes, originalLines.length, modifiedLines.length)
      : [];
    const hidden = regions.filter((_, index) => !expanded.has(index));
    rows = buildRows(changes, originalLines, state.layout, hidden).map((row) =>
      row.type === 'hidden'
        ? { ...row, region: regions.indexOf(hidden[row.region]) }
        : row,
    );
    changeStarts = [];
    rows.forEach((row, index) => {
      if (
        row.type === 'line' &&
        row.change !== undefined &&
        changeStarts.length === row.change
      )
        changeStarts.push(index);
    });
    const decorated = decorations(changes, originalLines, modifiedLines);
    const [originalLabel, modifiedLabel] = STAGE_LABELS[target.stage];
    const sides: HTMLElement[] = [];
    const hiddenRow = (count: number, region: number) => {
      const row = document.createElement('div');
      row.className = 'diff-row diff-hidden-lines';
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'diff-hidden-lines-button';
      button.append(
        icon('unfold'),
        document.createTextNode(
          ` ${count} hidden line${count === 1 ? '' : 's'}`,
        ),
      );
      button.title = 'Show unchanged lines';
      button.addEventListener('click', () => {
        expanded.add(region);
        render();
      });
      row.append(button);
      return row;
    };
    const line = (
      number: number,
      side: 0 | 1,
      sideDecorations: SideDecorations,
      numbers: (number | undefined)[],
    ) => {
      const lines = side ? modifiedLines : originalLines;
      const changed = sideDecorations.changed.has(number);
      const row = document.createElement('div');
      row.className = 'diff-row';
      if (changed) row.classList.add(side ? 'line-insert' : 'line-delete');
      if (sideDecorations.whole.has(number))
        row.classList.add(side ? 'whole-insert' : 'whole-delete');
      const gutter = document.createElement('span');
      gutter.className = 'diff-gutter';
      if (changed)
        gutter.classList.add(side ? 'gutter-insert' : 'gutter-delete');
      for (const value of numbers) {
        const cell = document.createElement('span');
        cell.className = 'diff-line-number';
        cell.textContent = value === undefined ? '' : String(value);
        gutter.append(cell);
      }
      const sign = document.createElement('span');
      sign.className = 'diff-sign';
      if (changed) sign.append(icon(side ? 'add' : 'remove'));
      gutter.append(sign);
      const code = document.createElement('span');
      code.className = 'diff-code';
      renderCode(
        code,
        lines[number - 1],
        tokens[side]?.[number - 1],
        sideDecorations.chars.get(number),
        side ? 'char-insert' : 'char-delete',
        tokenSpan,
      );
      row.append(gutter, code);
      return row;
    };
    const filler = (columns: number) => {
      const row = document.createElement('div');
      row.className = 'diff-row';
      const gutter = document.createElement('span');
      gutter.className = 'diff-gutter';
      for (let index = 0; index < columns; index++) {
        const cell = document.createElement('span');
        cell.className = 'diff-line-number';
        gutter.append(cell);
      }
      const sign = document.createElement('span');
      sign.className = 'diff-sign';
      gutter.append(sign);
      const code = document.createElement('span');
      code.className = 'diff-code diagonal-fill';
      row.append(gutter, code);
      return row;
    };
    const makeSide = (className: string, label: string) => {
      const side = document.createElement('div');
      side.className = `diff-side ${className}`;
      side.setAttribute('role', 'region');
      side.setAttribute('aria-label', label);
      side.tabIndex = -1;
      const content = document.createElement('div');
      content.className = 'diff-lines';
      side.append(content);
      sides.push(side);
      return content;
    };
    if (state.layout === 'inline') {
      const content = makeSide(
        'inline diff-scroll',
        `${originalLabel} and ${modifiedLabel}`,
      );
      const fragment = document.createDocumentFragment();
      for (const row of rows) {
        if (row.type === 'hidden')
          fragment.append(hiddenRow(row.count, row.region));
        else if (row.modified === undefined)
          fragment.append(
            line(row.original!, 0, decorated.original, [
              row.original,
              undefined,
            ]),
          );
        else if (row.original === undefined || row.change !== undefined)
          fragment.append(
            line(row.modified, 1, decorated.modified, [
              undefined,
              row.modified,
            ]),
          );
        else
          fragment.append(
            line(row.modified, 1, decorated.modified, [
              row.original,
              row.modified,
            ]),
          );
      }
      content.append(fragment);
    } else {
      const left = makeSide('original', originalLabel);
      const right = makeSide('modified diff-scroll', modifiedLabel);
      const leftRows = document.createDocumentFragment();
      const rightRows = document.createDocumentFragment();
      for (const row of rows) {
        if (row.type === 'hidden') {
          leftRows.append(hiddenRow(row.count, row.region));
          rightRows.append(hiddenRow(row.count, row.region));
          continue;
        }
        leftRows.append(
          row.original === undefined
            ? filler(1)
            : line(row.original, 0, decorated.original, [row.original]),
        );
        rightRows.append(
          row.modified === undefined
            ? filler(1)
            : line(row.modified, 1, decorated.modified, [row.modified]),
        );
      }
      left.append(leftRows);
      right.append(rightRows);
    }
    const body = document.createElement('div');
    body.className = 'diff-sides';
    body.dataset.layout = state.layout;
    body.append(...sides, overview(decorated.original, decorated.modified));
    editor.replaceChildren(message, body);
    scrollers = sides;
    // Keep both sides on the same line, as VS Code's diff editor does.
    // Only the modified side has a vertical scrollbar.
    const main = sides.at(-1)!;
    main.addEventListener(
      'scroll',
      () => {
        for (const other of sides)
          if (other !== main) other.scrollTop = main.scrollTop;
      },
      { signal },
    );
    for (const side of sides.slice(0, -1))
      side.addEventListener(
        'wheel',
        (event) => {
          if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
          event.preventDefault();
          main.scrollBy({
            // Firefox can report wheel deltas in lines.
            top: event.deltaY * (event.deltaMode === 1 ? LINE_HEIGHT : 1),
            behavior: 'instant',
          });
        },
        { passive: false, signal },
      );
    main.scrollTop = previousTop;
  };

  /** Change markers along the right edge, like VS Code's diff overview ruler. */
  const overview = (original: SideDecorations, modified: SideDecorations) => {
    const ruler = document.createElement('div');
    ruler.className = 'diff-overview';
    ruler.setAttribute('aria-hidden', 'true');
    const total = Math.max(1, rows.length);
    rows.forEach((row, index) => {
      if (row.type !== 'line' || row.change === undefined) return;
      const marks: [string, boolean][] = [
        [
          'delete',
          row.original !== undefined && original.changed.has(row.original),
        ],
        [
          'insert',
          row.modified !== undefined && modified.changed.has(row.modified),
        ],
      ];
      for (const [kind, on] of marks) {
        if (!on) continue;
        const mark = document.createElement('span');
        mark.className = `diff-overview-mark ${kind}`;
        mark.style.top = `${(index / total) * 100}%`;
        mark.style.height = `max(2px, ${100 / total}%)`;
        ruler.append(mark);
      }
    });
    ruler.addEventListener(
      'pointerdown',
      (event) => {
        const rect = ruler.getBoundingClientRect();
        const scroller = scrollers.at(-1);
        if (!scroller) return;
        const ratio = (event.clientY - rect.top) / Math.max(1, rect.height);
        scroller.scrollTop =
          ratio * scroller.scrollHeight - scroller.clientHeight / 2;
      },
      { signal },
    );
    return ruler;
  };

  const compute = async () => {
    if (!texts) return;
    computing?.abort();
    const current = new AbortController();
    computing = current;
    const stop = () => current.abort();
    signal.addEventListener('abort', stop, { once: true });
    try {
      const next = await runDiff(
        texts[0],
        texts[1],
        state.ignoreTrimWhitespace,
        current.signal,
      );
      if (current.signal.aborted) return;
      result = next;
      expanded.clear();
      setMessage(
        !exists[0] && !exists[1]
          ? `${target.path} is not available in ${STAGE_LABELS[target.stage].join(' or ')}.`
          : next.quitEarly
            ? 'Diff computation stopped early after 5 seconds. The result may not be minimal.'
            : next.changes.length
              ? ''
              : 'No changes.',
      );
      render();
      if (revealPending) reveal(changeStarts[0]);
      revealPending = false;
    } catch (error) {
      if (!current.signal.aborted)
        setMessage(`Could not compare ${target.path}: ${error}`);
    } finally {
      signal.removeEventListener('abort', stop);
    }
  };

  const [originalUrl, modifiedUrl] = sourceUrls(target, revision);
  void Promise.all([
    readSide(originalUrl, signal),
    readSide(modifiedUrl, signal),
  ])
    .then(async ([original, modified]) => {
      exists = [original !== null, modified !== null];
      const sources = [original ?? '', modified ?? ''];
      // A missing side is an empty text, which VS Code's diff algorithm
      // requires to be one empty line, so an added or deleted file is one change.
      texts = [splitLines(sources[0]), splitLines(sources[1])];
      await compute();
      const [left, right, highlight] = await Promise.all([
        original === null
          ? null
          : tokenize(
              sources[0],
              texts[0].length,
              target.originalPath?.split('/').at(-1) ?? target.name,
              signal,
            ),
        modified === null
          ? null
          : tokenize(sources[1], texts[1].length, target.name, signal),
        import('../highlight.js').catch(() => null),
      ]);
      if (signal.aborted || (!left && !right) || !highlight) return;
      tokens = [left, right];
      tokenSpan = highlight.tokenSpan;
      render();
    })
    .catch((error) => {
      if (!signal.aborted)
        setMessage(`Could not load ${target.path}: ${error}`);
    });

  return {
    element,
    setActive: () => {},
    update: (next) => {
      const recompute =
        next.ignoreTrimWhitespace !== state.ignoreTrimWhitespace;
      state = { ...next };
      if (recompute) void compute();
      else render();
    },
    navigate: (direction) => {
      const scroller = scrollers.at(-1);
      if (!scroller || !changeStarts.length) return;
      const current = Math.round(
        (scroller.scrollTop + revealOffset(scroller)) / LINE_HEIGHT,
      );
      // Wrap around like VS Code.
      reveal(
        direction > 0
          ? (changeStarts.find((row) => row > current) ?? changeStarts[0])
          : (changeStarts.findLast((row) => row < current) ??
              changeStarts.at(-1)!),
      );
    },
    revealFirstChange: () => {
      if (result) reveal(changeStarts[0]);
      else revealPending = true;
    },
    dispose: () => {
      controller.abort();
      element.remove();
    },
  };
}
