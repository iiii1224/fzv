const ROW = '[role="treeitem"]';

function level(row: HTMLElement): number {
  return Number(row.getAttribute('aria-level'));
}

/** Gives one row the tab stop, like VS Code's lists. */
export function focusRow(tree: HTMLElement, row: HTMLElement): void {
  for (const item of tree.querySelectorAll<HTMLElement>(ROW))
    item.tabIndex = item === row ? 0 : -1;
  row.focus();
}

/** WAI-ARIA tree keys, which match VS Code's list and tree navigation. */
export function handleTreeKey(
  event: KeyboardEvent,
  tree: HTMLElement,
  setExpanded: (row: HTMLElement, expanded: boolean) => void,
): void {
  const row = (event.target as HTMLElement).closest<HTMLElement>(ROW);
  if (!row || event.altKey || event.ctrlKey || event.metaKey) return;
  const rows = [...tree.querySelectorAll<HTMLElement>(ROW)];
  const index = rows.indexOf(row);
  const expanded = row.getAttribute('aria-expanded');
  const move = (next: HTMLElement | undefined) => {
    if (next) focusRow(tree, next);
  };
  switch (event.key) {
    case 'ArrowDown':
      move(rows[index + 1]);
      break;
    case 'ArrowUp':
      move(rows[index - 1]);
      break;
    case 'Home':
      move(rows[0]);
      break;
    case 'End':
      move(rows.at(-1));
      break;
    case 'ArrowRight':
      if (expanded === 'false') setExpanded(row, true);
      else if (
        expanded === 'true' &&
        rows[index + 1] &&
        level(rows[index + 1]) > level(row)
      )
        move(rows[index + 1]);
      break;
    case 'ArrowLeft':
      if (expanded === 'true') setExpanded(row, false);
      else
        move(rows.slice(0, index).findLast((item) => level(item) < level(row)));
      break;
    case 'Enter':
    case ' ':
      row.click();
      break;
    default:
      return;
  }
  event.preventDefault();
}
