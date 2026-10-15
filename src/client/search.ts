import type { ProjectFile } from '../shared.js';

interface IndexedFile {
  file: ProjectFile;
  chars: string[];
  lower: string[];
  bonuses: Int8Array;
}
interface Term {
  chars: string[];
  lower: string[];
  smartCase: boolean;
}
export interface SearchResults {
  files: ProjectFile[];
  total: number;
}

// Adapted from fzf's FuzzyMatchV2: optimal sequence alignment with match,
// gap, consecutive, word-boundary, camelCase, and path-separator scores.
// https://github.com/junegunn/fzf/blob/master/src/algo/algo.go
// Copyright (c) 2013-2026 Junegunn Choi. MIT; see THIRD_PARTY_NOTICES.md.
export class FuzzyIndex {
  private indexed: IndexedFile[];
  private a: Int32Array;
  private b: Int32Array;
  constructor(files: ProjectFile[]) {
    let maxLength = 0;
    const isWord = (char: string) => /[\p{L}\p{N}]/u.test(char);
    const isLower = (char: string) =>
      char &&
      char.toLocaleLowerCase() === char &&
      char.toLocaleUpperCase() !== char;
    const isUpper = (char: string) =>
      char &&
      char.toLocaleUpperCase() === char &&
      char.toLocaleLowerCase() !== char;
    this.indexed = files.map((file) => {
      const chars = Array.from(file.path);
      const lower = chars.map((char) => char.toLocaleLowerCase());
      const bonuses = new Int8Array(chars.length);
      for (let i = 0; i < chars.length; i++) {
        const current = chars[i],
          previous = chars[i - 1] ?? '';
        if (i === 0 || previous === '/' || previous === '\\') bonuses[i] = 8;
        else if (
          (['_', '-', '.'].includes(previous) || !isWord(previous)) &&
          isWord(current)
        )
          bonuses[i] = 8;
        else if (isLower(previous) && isUpper(current)) bonuses[i] = 7;
        else if (/\d/.test(current) && !/\d/.test(previous)) bonuses[i] = 7;
      }
      maxLength = Math.max(maxLength, chars.length);
      return { file, chars, lower, bonuses };
    });
    this.a = new Int32Array(maxLength);
    this.b = new Int32Array(maxLength);
  }

  private termScore(term: Term, file: IndexedFile): number {
    const { chars, lower, bonuses } = file;
    const length = chars.length;
    if (term.chars.length > length) return -1;
    const matches = (p: number, i: number) =>
      term.smartCase ? term.chars[p] === chars[i] : term.lower[p] === lower[i];
    let scan = 0;
    for (let p = 0; p < term.chars.length; p++) {
      let found = false;
      while (scan < length) {
        if (matches(p, scan++)) {
          found = true;
          break;
        }
      }
      if (!found) return -1;
    }
    const negative = -0x3fffffff;
    let previous = this.a,
      current = this.b;
    previous.fill(negative, 0, length);
    for (let i = 0; i < length; i++)
      if (matches(0, i)) previous[i] = 16 + 2 * bonuses[i];
    for (let p = 1; p < term.chars.length; p++) {
      current.fill(negative, 0, length);
      let bestGap = negative;
      for (let i = 0; i < length; i++) {
        if (i >= 2 && previous[i - 2] > negative)
          bestGap = Math.max(bestGap, previous[i - 2] + i - 2);
        if (!matches(p, i)) continue;
        const adjacent =
          i > 0 && previous[i - 1] > negative
            ? previous[i - 1] + 16 + bonuses[i] + 4
            : negative;
        const withGap =
          bestGap > negative
            ? bestGap + 16 + bonuses[i] - 3 - (i - 2)
            : negative;
        current[i] = Math.max(adjacent, withGap);
      }
      [previous, current] = [current, previous];
    }
    let best = negative;
    for (let i = 0; i < length; i++) best = Math.max(best, previous[i]);
    return best;
  }

  search(query: string, limit = 250): SearchResults {
    const terms = query
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((text) => {
        const chars = Array.from(text);
        return {
          chars,
          lower: chars.map((char) => char.toLocaleLowerCase()),
          smartCase: /[A-Z]/.test(text),
        };
      });
    if (!terms.length)
      return {
        files: this.indexed.slice(0, limit).map((item) => item.file),
        total: this.indexed.length,
      };
    const ranked: { file: ProjectFile; score: number }[] = [];
    for (const file of this.indexed) {
      let score = 0;
      for (const term of terms) {
        const next = this.termScore(term, file);
        if (next < 0) {
          score = -1;
          break;
        }
        score += next;
      }
      if (score >= 0) ranked.push({ file: file.file, score });
    }
    ranked.sort(
      (a, b) =>
        b.score - a.score ||
        a.file.path.length - b.file.path.length ||
        a.file.path.localeCompare(b.file.path),
    );
    return {
      files: ranked.slice(0, limit).map((item) => item.file),
      total: ranked.length,
    };
  }
}
