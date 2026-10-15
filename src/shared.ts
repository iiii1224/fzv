export const PRODUCT_NAME = 'fzv';
export const VERSION = '0.1.0';
export const MAX_FILE_SIZE = 20 * 1024 * 1024;

export type PreviewKind = 'pdf' | 'html' | 'image' | 'text';
export interface ProjectFile {
  path: string;
  name: string;
  kind: PreviewKind;
  size: number;
}
export interface ProjectInfo {
  id: string;
  name: string;
  maxFileSize: number;
}
export interface FileIndex {
  project: ProjectInfo;
  files: ProjectFile[];
}
