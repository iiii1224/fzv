import { computeDiff } from './model.js';
import type { DiffOptions } from './model.js';

// Like VS Code's editor worker, keep the diff computation off the UI thread.
self.addEventListener(
  'message',
  (
    event: MessageEvent<{
      original: string[];
      modified: string[];
      options: DiffOptions;
    }>,
  ) => {
    const { original, modified, options } = event.data;
    self.postMessage(computeDiff(original, modified, options));
  },
);
