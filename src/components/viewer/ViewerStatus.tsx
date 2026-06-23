import { Language } from '@/config/i18n';
import { DxfLayout } from '@/types';

export interface SpaceSwitchBarProps {
  layouts: DxfLayout[];
  activeLayoutName: string;
  lang: Language;
  onSelect: (layoutName: string) => void;
}

export interface StatusBarProps {
  lang: Language;
  mouseCoords: { x: number; y: number };
  selectedCount: number;
  activeLayoutName: string;
  entityCount: number;
}

const getLayoutLabel = (layout: DxfLayout, lang: Language) => {
  if (layout.isModel) return lang === 'zh' ? '模型' : 'Model';
  return layout.displayName || layout.name;
};

export function SpaceSwitchBar({ layouts, activeLayoutName, lang, onSelect }: SpaceSwitchBarProps) {
  return (
    <div className="space-switch-bar" role="tablist" aria-label={lang === 'zh' ? '空间切换' : 'Space switch'}>
      {layouts.map(layout => {
        const label = getLayoutLabel(layout, lang);
        const active = activeLayoutName === layout.name;
        return (
          <button
            key={layout.name}
            type="button"
            role="tab"
            aria-selected={active}
            className={`space-tab ${active ? 'active' : ''}`}
            onClick={() => onSelect(layout.name)}
            title={`${label} · ${layout.entities.length}`}
          >
            <>
              <span className="space-tab-name">{label}</span>
              <span className="space-tab-count">{layout.entities.length}</span>
            </>
          </button>
        );
      })}
    </div>
  );
}

export function StatusBar({ lang, mouseCoords, selectedCount, activeLayoutName, entityCount }: StatusBarProps) {
  return (
    <div className="status-bar">
      <div className="status-left">
        <div className="status-coords">
          <span>X: <span className="status-value">{mouseCoords.x.toFixed(3)}</span></span>
          <span>Y: <span className="status-value">{mouseCoords.y.toFixed(3)}</span></span>
        </div>
      </div>

      <div className="status-center">
        {selectedCount === 0 ? (
          <span>{lang === 'zh' ? '未选择对象' : 'No objects selected'}</span>
        ) : (
          <div className="status-selection">
            <span>{lang === 'zh' ? `已选 ${selectedCount}` : `Selected ${selectedCount}`}</span>
          </div>
        )}
      </div>

      <div className="status-right">
        <div className="status-summary">
          <span>{lang === 'zh' ? '空间' : 'Space'}: <span className="status-value">{activeLayoutName}</span></span>
          <span>{lang === 'zh' ? '实体' : 'Entities'}: <span className="status-value">{entityCount}</span></span>
        </div>
      </div>
    </div>
  );
}
