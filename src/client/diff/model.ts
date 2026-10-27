import { DefaultLinesDiffComputer } from '../vendor/vscode/src/vs/editor/common/diff/defaultLinesDiffComputer/defaultLinesDiffComputer.js';

export interface DiffOptions {
  ignoreTrimWhitespace: boolean;
  maxComputationTimeMs: number;
}
/** Start line, start column, end line, end column; 1-based like VS Code ranges. */
export type CharRange = [number, number, number, number];
export interface CharChange {
  original: CharRange;
  modified: CharRange;
}
/** 1-based line numbers with an exclusive end, like VS Code's LineRange. */
export interface LineChange {
  original: [number, number];
  modified: [number, number];
  inner: CharChange[];
}
export interface DiffResult {
  changes: LineChange[];
  /** The algorithm stopped early and reported a coarser diff. */
  quitEarly: boolean;
}

export function splitLines(text: string): string[] {
  return text.split(/\r\n|\r|\n/);
}

/** Runs VS Code's default diff algorithm and returns plain, serializable data. */
export function computeDiff(
  original: string[],
  modified: string[],
  options: DiffOptions,
): DiffResult {
  const result = new DefaultLinesDiffComputer().computeDiff(
    original,
    modified,
    { ...options, computeMoves: false, extendToSubwords: false },
  );
  const range = (value: {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  }): CharRange => [
    value.startLineNumber,
    value.startColumn,
    value.endLineNumber,
    value.endColumn,
  ];
  return {
    quitEarly: result.hitTimeout,
    changes: result.changes.map((change) => ({
      original: [
        change.original.startLineNumber,
        change.original.endLineNumberExclusive,
      ],
      modified: [
        change.modified.startLineNumber,
        change.modified.endLineNumberExclusive,
      ],
      inner: (change.innerChanges ?? []).map((inner) => ({
        original: range(inner.originalRange),
        modified: range(inner.modifiedRange),
      })),
    })),
  };
}

export type DiffLayout = 'side-by-side' | 'inline';
/** A rendered line. A missing side is a filler in side-by-side layout. */
export interface LineRow {
  type: 'line';
  original?: number;
  modified?: number;
  /** Index of the change this row belongs to. */
  change?: number;
}
export interface HiddenRow {
  type: 'hidden';
  /** Index into the unchanged regions passed to buildRows. */
  region: number;
  count: number;
}
export type DiffRow = LineRow | HiddenRow;

/** Unchanged lines that can be collapsed; both sides have the same length. */
export interface UnchangedRegion {
  original: number;
  modified: number;
  length: number;
}

/** Port of VS Code's UnchangedRegion.fromDiffs with its default 3 context and 3 minimum lines. */
export function unchangedRegions(
  changes: LineChange[],
  originalLineCount: number,
  modifiedLineCount: number,
  minimumLineCount = 3,
  contextLineCount = 3,
): UnchangedRegion[] {
  const result: UnchangedRegion[] = [];
  let original = 1;
  let modified = 1;
  const visit = (originalEnd: number) => {
    let length = originalEnd - original;
    let originalStart = original;
    let modifiedStart = modified;
    const atStart = originalStart === 1 && modifiedStart === 1;
    const atEnd =
      originalStart + length === originalLineCount + 1 &&
      modifiedStart + length === modifiedLineCount + 1;
    if ((atStart || atEnd) && length >= contextLineCount + minimumLineCount) {
      if (atStart && !atEnd) length -= contextLineCount;
      if (atEnd && !atStart) {
        originalStart += contextLineCount;
        modifiedStart += contextLineCount;
        length -= contextLineCount;
      }
      result.push({
        original: originalStart,
        modified: modifiedStart,
        length,
      });
    } else if (length >= contextLineCount * 2 + minimumLineCount) {
      result.push({
        original: originalStart + contextLineCount,
        modified: modifiedStart + contextLineCount,
        length: length - contextLineCount * 2,
      });
    }
  };
  for (const change of changes) {
    visit(change.original[0]);
    original = change.original[1];
    modified = change.modified[1];
  }
  visit(originalLineCount + 1);
  return result;
}

/** Port of VS Code's side-by-side inner hunk alignment from diffEditorViewZones.ts:
 * unchanged text inside a change keeps its lines level on both sides. */
export function alignChange(
  change: LineChange,
  originalLines: string[],
): [number, number, number, number][] {
  const result: [number, number, number, number][] = [];
  let first = true;
  let lastOriginal = change.original[0];
  let lastModified = change.modified[0];
  const emit = (original: number, modified: number, force = false) => {
    if (original < lastOriginal || modified < lastModified) return;
    if (first) first = false;
    else if (!force && (original === lastOriginal || modified === lastModified))
      return;
    if (original === lastOriginal && modified === lastModified) return;
    result.push([lastOriginal, original, lastModified, modified]);
    lastOriginal = original;
    lastModified = modified;
  };
  for (const inner of change.inner) {
    if (inner.original[1] > 1 && inner.modified[1] > 1)
      emit(inner.original[0], inner.modified[0]);
    const maxColumn =
      inner.original[2] <= originalLines.length
        ? originalLines[inner.original[2] - 1].length + 1
        : Number.MAX_SAFE_INTEGER;
    if (inner.original[3] < maxColumn)
      emit(inner.original[2], inner.modified[2]);
  }
  emit(change.original[1], change.modified[1], true);
  return result;
}

export function buildRows(
  changes: LineChange[],
  originalLines: string[],
  layout: DiffLayout,
  hidden: UnchangedRegion[] = [],
): DiffRow[] {
  const rows: DiffRow[] = [];
  const hiddenAt = new Map(
    hidden.map((region, index) => [region.original, index]),
  );
  let original = 1;
  let modified = 1;
  const unchanged = (originalEnd: number) => {
    while (original < originalEnd) {
      const region = hiddenAt.get(original);
      if (region !== undefined) {
        const { length } = hidden[region];
        rows.push({ type: 'hidden', region, count: length });
        original += length;
        modified += length;
        continue;
      }
      rows.push({ type: 'line', original: original++, modified: modified++ });
    }
  };
  changes.forEach((change, index) => {
    unchanged(change.original[0]);
    if (layout === 'inline') {
      for (let line = change.original[0]; line < change.original[1]; line++)
        rows.push({ type: 'line', original: line, change: index });
      for (let line = change.modified[0]; line < change.modified[1]; line++)
        rows.push({ type: 'line', modified: line, change: index });
    } else {
      for (const [os, oe, ms, me] of alignChange(change, originalLines))
        for (let offset = 0; offset < Math.max(oe - os, me - ms); offset++)
          rows.push({
            type: 'line',
            original: os + offset < oe ? os + offset : undefined,
            modified: ms + offset < me ? ms + offset : undefined,
            change: index,
          });
    }
    original = change.original[1];
    modified = change.modified[1];
  });
  unchanged(originalLines.length + 1);
  return rows;
}

/** A highlighted span on one line; start and end are 0-based UTF-16 offsets. */
export interface LineHighlight {
  start: number;
  end: number;
}
export interface SideDecorations {
  /** Lines inside a change. */
  changed: Set<number>;
  /** Inserted or deleted lines with no counterpart; VS Code highlights them as whole-line text. */
  whole: Set<number>;
  /** Inner character changes by line. An empty span marks an insertion point. */
  chars: Map<number, LineHighlight[]>;
}

/** Mirrors VS Code's diffEditorDecorations: line backgrounds and inner character ranges. */
export function decorations(
  changes: LineChange[],
  originalLines: string[],
  modifiedLines: string[],
): { original: SideDecorations; modified: SideDecorations } {
  const empty = (): SideDecorations => ({
    changed: new Set(),
    whole: new Set(),
    chars: new Map(),
  });
  const original = empty();
  const modified = empty();
  const add = (
    side: SideDecorations,
    lines: string[],
    [startLine, startColumn, endLine, endColumn]: CharRange,
  ) => {
    for (let line = startLine; line <= endLine; line++) {
      const start = line === startLine ? startColumn - 1 : 0;
      const end =
        line === endLine ? endColumn - 1 : (lines[line - 1]?.length ?? 0);
      // A range ending at column 1 only covers the preceding line break.
      if (line > startLine && line === endLine && end === 0) continue;
      const list = side.chars.get(line) ?? [];
      list.push({ start, end });
      side.chars.set(line, list);
    }
  };
  for (const change of changes) {
    const [os, oe] = change.original;
    const [ms, me] = change.modified;
    for (let line = os; line < oe; line++) original.changed.add(line);
    for (let line = ms; line < me; line++) modified.changed.add(line);
    if (os === oe || ms === me) {
      for (let line = os; line < oe; line++) original.whole.add(line);
      for (let line = ms; line < me; line++) modified.whole.add(line);
      continue;
    }
    for (const inner of change.inner) {
      if (inner.original[0] >= os && inner.original[0] < oe)
        add(original, originalLines, inner.original);
      if (inner.modified[0] >= ms && inner.modified[0] < me)
        add(modified, modifiedLines, inner.modified);
    }
  }
  return { original, modified };
}
