export const PRODUCT_NAME = 'fzv';
export const VERSION = '0.5.0';
export const MAX_FILE_SIZE = 20 * 1024 * 1024;

export type PreviewKind = 'pdf' | 'html' | 'image' | 'text' | 'office';
export interface ProjectFile {
  path: string;
  name: string;
  kind: PreviewKind;
  size: number;
}
export interface ProjectDirectory {
  path: string;
  name: string;
  kind: 'directory';
}
export type ProjectEntry = ProjectFile | ProjectDirectory;
export interface ProjectInfo {
  id: string;
  name: string;
  maxFileSize: number;
  watch?: boolean;
  git?: boolean;
}
export interface FileIndex {
  project: ProjectInfo;
  files: ProjectFile[];
  directories: ProjectDirectory[];
}
export interface ProjectChange {
  revision: string;
  /** Empty on connection. Null means any file may have changed. */
  paths: string[] | null;
}

/** `index` compares HEAD with the index; `worktree` compares the index with files. */
export type GitStage = 'index' | 'worktree';
/** Porcelain status letters, as shown by VS Code's Source Control view. */
export type GitStatusCode = 'M' | 'A' | 'D' | 'R' | 'C' | 'T' | 'U' | '?';
export interface GitChange {
  path: string;
  /** Source path of a rename or copy, when it is inside the project. */
  originalPath?: string;
  stage: GitStage;
  status: GitStatusCode;
  kind: PreviewKind | null;
}
export type GitStatus =
  | { available: false }
  | { available: true; branch: string | null; changes: GitChange[] };
