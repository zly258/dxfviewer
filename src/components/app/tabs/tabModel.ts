import { createStableId, getFileNameFromUrl } from '@/utils/fileUtils';

export interface DxfTab {
  id: string;
  name: string;
  file?: File;
  url?: string;
}

export type DxfTabSource = File | string;

export const createDxfTab = (source: DxfTabSource): DxfTab => {
  if (typeof source === 'string') {
    return { id: createStableId('dxf_tab'), name: getFileNameFromUrl(source), url: source };
  }
  return { id: createStableId('dxf_tab'), name: source.name, file: source };
};
