export const createStableId = (prefix = 'id'): string =>
  `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;

export const getFileNameFromUrl = (url: string): string => url.split(/[\\/]/).pop() || url;

export const getFileIdentity = (file: File): string => `${file.name}_${file.size}_${file.lastModified}`;

export const isFile = (value: unknown): value is File => typeof File !== 'undefined' && value instanceof File;
