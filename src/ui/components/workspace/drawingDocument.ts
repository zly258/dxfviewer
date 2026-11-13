import { useCallback, useEffect, useState } from 'react';
import { createStableId, getFileIdentity, getFileNameFromUrl } from '@/utils/fileUtils';

/** 打开来源：本地文件或 URL。一次只保留一份图纸。 */
export type DxfOpenSource = File | string;

/** @deprecated 旧名。多标签已去掉，请用 DxfOpenSource。 */
export type DxfTabSource = DxfOpenSource;

export interface DxfDocument {
  id: string;
  name: string;
  file?: File;
  url?: string;
}

const createDocument = (source: DxfOpenSource): DxfDocument => {
  if (typeof source === 'string') {
    return { id: createStableId('dxf_doc'), name: getFileNameFromUrl(source), url: source };
  }
  return { id: createStableId('dxf_doc'), name: source.name, file: source };
};

/**
 * 单图纸状态。打开新文件直接替换，不为每张图再挂一套查看器。
 */
export const useDxfDocument = (editor: boolean, initialFiles: DxfOpenSource[] = []) => {
  const [document, setDocument] = useState<DxfDocument | null>(null);

  const openFiles = useCallback((files: File[]) => {
    if (!editor || files.length === 0) return;
    const file = files[0];
    setDocument(current => {
      if (current?.file && getFileIdentity(current.file) === getFileIdentity(file)) return current;
      return createDocument(file);
    });
  }, [editor]);

  const openUrl = useCallback((url: string) => {
    if (!editor || !url) return;
    setDocument(current => (current?.url === url ? current : createDocument(url)));
  }, [editor]);

  const closeDocument = useCallback(() => {
    if (!editor) return;
    setDocument(null);
  }, [editor]);

  useEffect(() => {
    if (!initialFiles.length) return;
    setDocument(createDocument(initialFiles[0]));
  }, [initialFiles]);

  return { document, openFiles, openUrl, closeDocument };
};
