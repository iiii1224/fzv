import type { LayoutNode } from './layout.js';

interface LegacySession {
  version: 1;
  tabs: string[];
  active: string | null;
}
export interface WorkspaceSession {
  version: 2;
  layout: LayoutNode;
  groups: {
    id: string;
    tabs: { path: string; mode: 'viewer' | 'source' }[];
    active: string | null;
  }[];
  activeGroup: string;
}
export type SavedSession = LegacySession | WorkspaceSession;
export interface SessionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export function sessionKey(projectId: string, version = 1): string {
  return `fzv:project:${projectId}:v${version}`;
}

function parseWorkspace(value: unknown): WorkspaceSession | null {
  if (!value || typeof value !== 'object') return null;
  const saved = value as Partial<WorkspaceSession>;
  if (
    saved.version !== 2 ||
    !Array.isArray(saved.groups) ||
    !saved.groups.length ||
    saved.groups.length > 32
  )
    return null;
  const groups: WorkspaceSession['groups'] = [];
  const ids = new Set<string>();
  for (const group of saved.groups) {
    if (
      !group ||
      typeof group.id !== 'string' ||
      ids.has(group.id) ||
      !Array.isArray(group.tabs)
    )
      return null;
    ids.add(group.id);
    const paths = new Set<string>();
    const tabs: WorkspaceSession['groups'][number]['tabs'] = [];
    for (const tab of group.tabs) {
      if (!tab || typeof tab.path !== 'string' || paths.has(tab.path)) continue;
      paths.add(tab.path);
      tabs.push({
        path: tab.path,
        mode: tab.mode === 'source' ? 'source' : 'viewer',
      });
    }
    groups.push({
      id: group.id,
      tabs,
      active:
        typeof group.active === 'string' && paths.has(group.active)
          ? group.active
          : (tabs[0]?.path ?? null),
    });
  }
  const used = new Set<string>();
  const splitIds = new Set<string>();
  const parseLayout = (value: unknown, depth = 0): LayoutNode | null => {
    if (!value || typeof value !== 'object' || depth > 32) return null;
    const node = value as LayoutNode;
    if (typeof node.id !== 'string') return null;
    if (node.type === 'group') {
      if (!ids.has(node.id) || used.has(node.id)) return null;
      used.add(node.id);
      return { type: 'group', id: node.id };
    }
    if (
      node.type !== 'split' ||
      splitIds.has(node.id) ||
      !['x', 'y'].includes(node.axis) ||
      !Number.isFinite(node.ratio) ||
      node.ratio <= 0 ||
      node.ratio >= 1 ||
      !Array.isArray(node.children) ||
      node.children.length !== 2
    )
      return null;
    splitIds.add(node.id);
    const first = parseLayout(node.children[0], depth + 1);
    const second = parseLayout(node.children[1], depth + 1);
    return first && second
      ? {
          type: 'split',
          id: node.id,
          axis: node.axis,
          ratio: node.ratio,
          children: [first, second],
        }
      : null;
  };
  const layout = parseLayout(saved.layout);
  if (!layout || used.size !== ids.size) return null;
  return {
    version: 2,
    layout,
    groups,
    activeGroup:
      typeof saved.activeGroup === 'string' && ids.has(saved.activeGroup)
        ? saved.activeGroup
        : groups[0].id,
  };
}
export function readSession(
  storage: SessionStorage,
  projectId: string,
): SavedSession | null {
  try {
    const workspace = parseWorkspace(
      JSON.parse(storage.getItem(sessionKey(projectId, 2)) ?? 'null'),
    );
    if (workspace) return workspace;
    const saved: unknown = JSON.parse(
      storage.getItem(sessionKey(projectId)) ?? 'null',
    );
    if (
      !saved ||
      typeof saved !== 'object' ||
      !('version' in saved) ||
      saved.version !== 1 ||
      !('tabs' in saved) ||
      !Array.isArray(saved.tabs)
    )
      return null;
    const tabs = [
      ...new Set(
        saved.tabs.filter((item): item is string => typeof item === 'string'),
      ),
    ];
    const active =
      'active' in saved && typeof saved.active === 'string'
        ? saved.active
        : null;
    return { version: 1, tabs, active };
  } catch {
    return null;
  }
}
export function writeSession(
  storage: SessionStorage,
  projectId: string,
  session: SavedSession,
): void {
  try {
    storage.setItem(
      sessionKey(projectId, session.version),
      JSON.stringify(session),
    );
  } catch {
    /* Browser storage may be unavailable or full. Viewing still works. */
  }
}
