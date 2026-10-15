export interface SavedSession {
  version: 1;
  tabs: string[];
  active: string | null;
}
export interface SessionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export function sessionKey(projectId: string): string {
  return `fzv:project:${projectId}:v1`;
}
export function readSession(
  storage: SessionStorage,
  projectId: string,
): SavedSession | null {
  try {
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
    storage.setItem(sessionKey(projectId), JSON.stringify(session));
  } catch {
    /* Browser storage may be unavailable or full. Viewing still works. */
  }
}
