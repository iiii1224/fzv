export type Direction = 'left' | 'right' | 'up' | 'down';
export type LayoutNode =
  | { type: 'group'; id: string }
  | {
      type: 'split';
      id: string;
      axis: 'x' | 'y';
      ratio: number;
      children: [LayoutNode, LayoutNode];
    };
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export const SASH_SIZE = 4;

export function splitLayout(
  node: LayoutNode,
  target: string,
  added: string,
  direction: Direction,
  splitId: string,
): LayoutNode {
  if (node.type === 'split')
    return {
      ...node,
      children: node.children.map((child) =>
        splitLayout(child, target, added, direction, splitId),
      ) as [LayoutNode, LayoutNode],
    };
  if (node.id !== target) return node;
  const leaf: LayoutNode = { type: 'group', id: added };
  return {
    type: 'split',
    id: splitId,
    axis: direction === 'left' || direction === 'right' ? 'x' : 'y',
    ratio: 0.5,
    children:
      direction === 'left' || direction === 'up' ? [leaf, node] : [node, leaf],
  };
}

export function removeFromLayout(
  node: LayoutNode,
  id: string,
): LayoutNode | null {
  if (node.type === 'group') return node.id === id ? null : node;
  const first = removeFromLayout(node.children[0], id);
  const second = removeFromLayout(node.children[1], id);
  if (!first) return second;
  if (!second) return first;
  return { ...node, children: [first, second] };
}

export function groupIds(node: LayoutNode): string[] {
  return node.type === 'group' ? [node.id] : node.children.flatMap(groupIds);
}

function minimum(node: LayoutNode, axis: 'x' | 'y'): number {
  if (node.type === 'group') return axis === 'x' ? 220 : 140;
  const sizes = node.children.map((child) => minimum(child, axis));
  return node.axis === axis
    ? sizes[0] + sizes[1] + SASH_SIZE
    : Math.max(...sizes);
}

export function ratioLimits(
  node: Extract<LayoutNode, { type: 'split' }>,
  size: number,
): [number, number] {
  const available = Math.max(0, size - SASH_SIZE);
  const first = minimum(node.children[0], node.axis);
  const second = minimum(node.children[1], node.axis);
  if (available <= first + second) {
    const ratio = first / (first + second);
    return [ratio, ratio];
  }
  return [first / available, 1 - second / available];
}

export function measureLayout(
  node: LayoutNode,
  rect: Rect,
): {
  groups: Map<string, Rect>;
  splits: Map<
    string,
    { node: Extract<LayoutNode, { type: 'split' }>; rect: Rect; sash: Rect }
  >;
} {
  const groups = new Map<string, Rect>();
  const splits = new Map<
    string,
    { node: Extract<LayoutNode, { type: 'split' }>; rect: Rect; sash: Rect }
  >();
  const visit = (current: LayoutNode, box: Rect) => {
    if (current.type === 'group') {
      groups.set(current.id, box);
      return;
    }
    const horizontal = current.axis === 'x';
    const size = horizontal ? box.width : box.height;
    const gap = Math.min(SASH_SIZE, size);
    const [min, max] = ratioLimits(current, size);
    const ratio = Math.max(min, Math.min(max, current.ratio));
    const firstSize = Math.max(0, size - gap) * ratio;
    const secondSize = Math.max(0, size - gap - firstSize);
    const first = { ...box, [horizontal ? 'width' : 'height']: firstSize };
    const second = horizontal
      ? { ...box, x: box.x + firstSize + gap, width: secondSize }
      : { ...box, y: box.y + firstSize + gap, height: secondSize };
    const sash = horizontal
      ? { ...box, x: box.x + firstSize, width: gap }
      : { ...box, y: box.y + firstSize, height: gap };
    splits.set(current.id, { node: current, rect: box, sash });
    visit(current.children[0], first);
    visit(current.children[1], second);
  };
  visit(node, rect);
  return { groups, splits };
}
