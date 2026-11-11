import { Language, t } from '@/ui/i18n';
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
  if (layout.isModel) return t(lang, 'modelSpace');
  return layout.displayName || layout.name;
};

/**
 * 模型/图纸空间切换页签（28px 过滤行，26px .filter-tab）。
 * active 用浅蓝底 + 蓝字（P16：与工具条开关态同一种表达）。
 */
export function SpaceSwitchBar({ layouts, activeLayoutName, lang, onSelect }: SpaceSwitchBarProps) {
  return (
    <div className="space-switch-bar" role="tablist" aria-label={t(lang, 'spaceSwitchAriaLabel')}>
      {layouts.map(layout => {
        const label = getLayoutLabel(layout, lang);
        const active = activeLayoutName === layout.name;
        return (
          <button
            key={layout.name}
            type="button"
            role="tab"
            aria-selected={active}
            className={`filter-tab ${active ? 'active' : ''}`}
            onClick={() => onSelect(layout.name)}
            title={`${label} · ${layout.entities.length}`}
          >
            <span className="filter-tab-name">{label}</span>
            <span className="filter-tab-count">{layout.entities.length}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * 底栏 30px（R9）：坐标 | 选择 | 空间与实体数。
 */
export function StatusBar({ lang, mouseCoords, selectedCount, activeLayoutName, entityCount }: StatusBarProps) {
  return (
    <div className="app-footer status-bar">
      <div className="status-left">
        <div className="status-coords">
          <span>X: <span className="status-value">{mouseCoords.x.toFixed(3)}</span></span>
          <span>Y: <span className="status-value">{mouseCoords.y.toFixed(3)}</span></span>
        </div>
      </div>

      <div className="status-center">
        {selectedCount === 0 ? (
          <span>{t(lang, 'noObjectsSelected')}</span>
        ) : (
          <div className="status-selection">
            <span>{t(lang, 'statusSelected', { count: selectedCount })}</span>
          </div>
        )}
      </div>

      <div className="status-right">
        <div className="status-summary">
          <span>{t(lang, 'statusSpace')}: <span className="status-value">{activeLayoutName}</span></span>
          <span>{t(lang, 'statusEntities')}: <span className="status-value">{entityCount}</span></span>
        </div>
      </div>
    </div>
  );
}
