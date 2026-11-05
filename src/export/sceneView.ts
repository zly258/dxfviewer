/**
 * 导出取景：布局解析 + 适配视口计算。
 *
 * PNG（WebGL 栅格）与 SVG / PDF 矢量导出共用，保证同一份图纸在
 * 各导出格式里的取景与留白完全一致。与渲染后端无关。
 */
import {
  DxfData,
  DxfLayout,
  AnyEntity,
  ViewPort,
} from '@/types';
import { fitExtentsToBox, fitPaperLayoutToBox } from '@/render/viewportFitting';

/**
 * 按布局名/id 查找布局；找不到时回退到模型空间，再回退到首个布局。
 */
export const resolveLayout = (data: DxfData, name?: string): DxfLayout | undefined => {
  const layouts = data.layouts ?? [];
  if (name) {
    const target = name.trim();
    const matched = layouts.find(layout =>
      layout.name === target
      || layout.id === target
      || layout.displayName === target,
    );
    if (matched) return matched;
  }
  const active = layouts.find(layout => layout.name === data.activeLayoutName);
  if (active) return active;
  return layouts.find(layout => layout.isModel) ?? layouts[0];
};

/**
 * 取布局可用的包围盒：布局自带 extents 优先，其次 paper 范围，最后退回整图 extents。
 */
export const resolveLayoutExtents = (
  data: DxfData,
  layout: DxfLayout | undefined,
): DxfLayout['extents'] | DxfData['extents'] => layout?.extents ?? data.extents;

export interface SceneView {
  layout: DxfLayout | undefined;
  entities: AnyEntity[];
  viewPort: ViewPort;
  /** 布局旋转角度（度）：v2 恒为 0，保留字段兼容既有调用方。 */
  rotation: number;
}

/**
 * 解析布局 + 计算适配视口。
 *
 * 纸张空间布局优先用布局实体范围取景（fitPaperLayoutToBox），
 * 模型空间用整图范围（fitExtentsToBox）；显式 viewPort（导出当前视图）时跳过适配。
 */
export const resolveSceneView = (
  data: DxfData,
  options: {
    layout?: string;
    width: number;
    height: number;
    padding?: number;
    /** 显式视口（导出当前视图）：提供时跳过 fit 适配 */
    viewPort?: ViewPort;
  },
): SceneView => {
  const layout = resolveLayout(data, options.layout);
  const extents = resolveLayoutExtents(data, layout);
  const viewPort = options.viewPort
    ?? (layout && !layout.isModel
      ? fitPaperLayoutToBox(layout, options.width, options.height, { padding: options.padding })
      : fitExtentsToBox(extents, options.width, options.height, { padding: options.padding }));

  const entities = layout?.entities?.length
    ? layout.entities
    : (data.entities ?? []);

  return { layout, entities, viewPort, rotation: 0 };
};

