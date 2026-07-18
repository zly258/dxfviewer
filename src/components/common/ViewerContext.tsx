import { createContext, useContext } from 'react';
import { Language } from '@/config/i18n';
import { 
  UiTheme, 
  DrawingColorMode, 
  AnyEntity, 
  DxfLayer, 
  DxfBlock, 
  DxfStyle, 
  DxfLineType,
  CanvasTheme
} from '@/types';

export interface ViewerContextState {
  lang: Language;
  uiTheme: UiTheme;
  effectiveUiTheme: 'light' | 'dark';
  canvasTheme: CanvasTheme;
  drawingColorMode: DrawingColorMode;
  setLang: (lang: Language) => void;
  setUiTheme: (theme: UiTheme) => void;
  setDrawingColorMode: (mode: DrawingColorMode) => void;
  
  entities: AnyEntity[];
  displayEntities: AnyEntity[];
  layers: Record<string, DxfLayer>;
  blocks: Record<string, DxfBlock>;
  styles: Record<string, DxfStyle>;
  lineTypes: Record<string, DxfLineType>;
  
  hiddenLayers: Set<string>;
  hiddenEntityIds: Set<string>;
  isolatedEntityIds: Set<string> | null;
  toggleLayerVisibility: (layerName: string) => void;
  
  selectedEntityIds: Set<string>;
  setSelectedEntityIds: (ids: Set<string>) => void;
  
  activeLayoutName: string;
}

export const ViewerContext = createContext<ViewerContextState | null>(null);

export const useViewerContext = (): ViewerContextState => {
  const ctx = useContext(ViewerContext);
  if (!ctx) {
    throw new Error('useViewerContext must be used within a ViewerProvider');
  }
  return ctx;
};
