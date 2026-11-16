import React from 'react';

/**
 * 线性内联 SVG 图标（web-ui-style R8 / P12）。
 *
 * 契约：
 * - 只用内联 SVG，禁止 emoji 与图标字体；
 * - `fill="none"` + `stroke="currentColor"`，颜色自动继承宿主前景色，
 *   因此按钮/面板任何状态（hover / active / disabled）都不需要为图标单独改色；
 * - viewBox 固定 0 0 24 24，线宽 1.8，`stroke-linecap/linejoin: round`；
 * - 尺寸完全由宿主 CSS 控制（--icon-size 14px / --icon-size-sm 12px）；
 * - 纯图标按钮必须自带 title 或 aria-label（由调用方负责）。
 */

export type ViewerIconName =
  // ── 文件操作 ──
  | 'open'
  | 'export'
  // ── 导航 ──
  | 'previous'
  | 'next'
  | 'chevronRight'
  | 'chevronLeft'
  | 'chevronUp'
  | 'chevronDown'
  | 'more'
  // ── 视图工具 ──
  | 'fit'
  | 'search'
  | 'view'
  | 'layers'
  | 'properties'
  // ── 设置 ──
  | 'about'
  | 'theme'
  | 'language'
  | 'monochrome'
  | 'layout'
  // ── 列表面板 ──
  | 'checkboxChecked'
  | 'checkboxEmpty'
  | 'sortAsc'
  | 'sortDesc'
  | 'sortName'
  | 'sortCount'
  | 'filterEmpty'
  // ── 通用 ──
  | 'close'
  | 'check'
  | 'download';

/** 每个图标由若干条 <path> / <circle> / <rect> 组成。 */
type IconShape =
  | { d: string }
  | { circle: { cx: number; cy: number; r: number } }
  | { rect: { x: number; y: number; width: number; height: number; rx?: number } };

const ICONS: Record<ViewerIconName, IconShape[]> = {
  // 文件夹（打开）
  open: [
    { d: 'M3 8.5A2.5 2.5 0 0 1 5.5 6h3.4l2 2.2h7.6A2.5 2.5 0 0 1 21 10.7v6.8A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5z' },
  ],

  // 导出 / 下载
  export: [
    { d: 'M12 3v11' },
    { d: 'm7.5 10 4.5 4.5 4.5-4.5' },
    { d: 'M4 17.5v1A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5v-1' },
  ],

  // 导航
  previous: [{ d: 'M15 18 9 12l6-6' }],
  next: [{ d: 'M9 6l6 6-6 6' }],
  chevronLeft: [{ d: 'M15 18 9 12l6-6' }],
  chevronRight: [{ d: 'M9 6l6 6-6 6' }],
  chevronUp: [{ d: 'M6 15l6-6 6 6' }],
  chevronDown: [{ d: 'M6 9l6 6 6-6' }],
  more: [
    { circle: { cx: 12, cy: 5.5, r: 1.4 } },
    { circle: { cx: 12, cy: 12, r: 1.4 } },
    { circle: { cx: 12, cy: 18.5, r: 1.4 } },
  ],

  // 充满视图（四角扩展）
  fit: [
    { d: 'M9 3.5H5.5A2 2 0 0 0 3.5 5.5V9' },
    { d: 'M15 3.5h3.5a2 2 0 0 1 2 2V9' },
    { d: 'M9 20.5H5.5a2 2 0 0 1-2-2V15' },
    { d: 'M15 20.5h3.5a2 2 0 0 0 2-2V15' },
  ],

  // 搜索
  search: [
    { circle: { cx: 10.5, cy: 10.5, r: 6.5 } },
    { d: 'm15.4 15.4 4.1 4.1' },
  ],

  // 视图设置（滑杆）
  view: [
    { d: 'M4 7h6' },
    { d: 'M14 7h6' },
    { d: 'M4 12h10' },
    { d: 'M18 12h2' },
    { d: 'M4 17h3' },
    { d: 'M11 17h9' },
    { circle: { cx: 12, cy: 7, r: 2 } },
    { circle: { cx: 16, cy: 12, r: 2 } },
    { circle: { cx: 9, cy: 17, r: 2 } },
  ],

  // 图层
  layers: [
    { d: 'm12 3 8.5 4.6L12 12.2 3.5 7.6z' },
    { d: 'm3.5 12.4 8.5 4.6 8.5-4.6' },
    { d: 'm3.5 16.9 8.5 4.6 8.5-4.6' },
  ],

  // 属性 / 关于（信息）
  properties: [
    { circle: { cx: 12, cy: 12, r: 8.5 } },
    { d: 'M12 11v5.5' },
    { d: 'M12 7.6h.01' },
  ],
  about: [
    { circle: { cx: 12, cy: 12, r: 8.5 } },
    { d: 'M12 11v5.5' },
    { d: 'M12 7.6h.01' },
  ],

  // 主题（月亮）
  theme: [
    { d: 'M20.5 13.4A8.6 8.6 0 1 1 10.6 3.5a7 7 0 0 0 9.9 9.9z' },
  ],

  // 语言（地球）
  language: [
    { circle: { cx: 12, cy: 12, r: 8.5 } },
    { d: 'M3.5 12h17' },
    { d: 'M12 3.5c2.4 2.4 3.6 5.3 3.6 8.5S14.4 18.1 12 20.5c-2.4-2.4-3.6-5.3-3.6-8.5S9.6 5.9 12 3.5z' },
  ],

  // 黑白模式（对比）
  monochrome: [
    { circle: { cx: 12, cy: 12, r: 8.5 } },
    { d: 'M12 3.5a8.5 8.5 0 0 0 0 17z' },
  ],

  // 布局（网格）
  layout: [
    { rect: { x: 3.5, y: 3.5, width: 7, height: 7, rx: 1.5 } },
    { rect: { x: 13.5, y: 3.5, width: 7, height: 7, rx: 1.5 } },
    { rect: { x: 3.5, y: 13.5, width: 7, height: 7, rx: 1.5 } },
    { rect: { x: 13.5, y: 13.5, width: 7, height: 7, rx: 1.5 } },
  ],

  // 复选框
  checkboxChecked: [
    { rect: { x: 3.5, y: 3.5, width: 17, height: 17, rx: 2 } },
    { d: 'm8 12.2 2.8 2.8L16.4 9' },
  ],
  checkboxEmpty: [
    { rect: { x: 3.5, y: 3.5, width: 17, height: 17, rx: 2 } },
  ],

  // 排序
  sortAsc: [
    { d: 'M12 20V4' },
    { d: 'm6 10 6-6 6 6' },
  ],
  sortDesc: [
    { d: 'M12 4v16' },
    { d: 'm6 14 6 6 6-6' },
  ],
  sortName: [
    { d: 'M4 7h9' },
    { d: 'M4 12h6' },
    { d: 'M4 17h4' },
    { d: 'm16 6 4 12' },
    { d: 'm20 6-4 12' },
  ],
  sortCount: [
    { d: 'M4 6h16' },
    { d: 'M4 12h10' },
    { d: 'M4 18h6' },
  ],

  // 过滤空图层（禁止）
  filterEmpty: [
    { circle: { cx: 12, cy: 12, r: 8.5 } },
    { d: 'm6.2 17.8 11.6-11.6' },
  ],

  // 通用
  close: [
    { d: 'M18 6 6 18' },
    { d: 'm6 6 12 12' },
  ],
  check: [{ d: 'M20 6 9 17l-5-5' }],
  download: [
    { d: 'M12 3v11' },
    { d: 'm7.5 10 4.5 4.5 4.5-4.5' },
    { d: 'M4 17.5v1A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5v-1' },
  ],
};

type ViewerIconProps = React.SVGAttributes<SVGSVGElement> & {
  name: ViewerIconName;
};

/**
 * 线性图标组件。颜色由 `currentColor` 继承，尺寸由宿主 CSS 决定。
 */
const ViewerIcon: React.FC<ViewerIconProps> = ({ name, ...svgProps }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
    {...svgProps}
  >
    {ICONS[name].map((shape, index) => {
      if ('circle' in shape) {
        return <circle key={index} cx={shape.circle.cx} cy={shape.circle.cy} r={shape.circle.r} />;
      }
      if ('rect' in shape) {
        return (
          <rect
            key={index}
            x={shape.rect.x}
            y={shape.rect.y}
            width={shape.rect.width}
            height={shape.rect.height}
            rx={shape.rect.rx}
          />
        );
      }
      return <path key={index} d={shape.d} />;
    })}
  </svg>
);

export default ViewerIcon;
