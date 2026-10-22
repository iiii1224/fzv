export const PRODUCT_NAME = 'fzv';
export const VERSION = '0.1.1';
export const MAX_FILE_SIZE = 20 * 1024 * 1024;

export type PreviewKind = 'pdf' | 'html' | 'image' | 'text';
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
}
export interface FileIndex {
  project: ProjectInfo;
  files: ProjectFile[];
  directories: ProjectDirectory[];
}
/** Watch-mode change notification; null paths means any file may have changed. */
export interface ProjectChange {
  paths: string[] | null;
}
