import React from 'react';

export type ViewerIconName =
  | 'open'
  | 'previous'
  | 'next'
  | 'fit'
  | 'search'
  | 'view'
  | 'about'
  | 'layers'
  | 'properties'
  | 'theme'
  | 'language'
  | 'monochrome'
  | 'layout'
  | 'close'
  | 'checkboxChecked'
  | 'checkboxEmpty'
  | 'chevronRight'
  | 'chevronLeft'
  | 'chevronUp'
  | 'chevronDown'
  | 'sortAsc'
  | 'sortDesc'
  | 'filterEmpty'
  | 'sortName'
  | 'sortCount';

const ICON_PATHS: Record<ViewerIconName, React.ReactNode> = {
  open: (
    <>
      <path d="M3 6h5l2 2h11v10H3z" />
    </>
  ),
  previous: (
    <>
      <path d="M10 6 4 12l6 6" />
      <path d="M5 12h15" />
    </>
  ),
  next: (
    <>
      <path d="m14 6 6 6-6 6" />
      <path d="M19 12H4" />
    </>
  ),
  fit: (
    <>
      <path d="M5 9V5h4" />
      <path d="M15 5h4v4" />
      <path d="M19 15v4h-4" />
      <path d="M9 19H5v-4" />
      <path d="M9 12h6" />
      <path d="M12 9v6" />
    </>
  ),
  search: (
    <>
      <circle cx="10.7" cy="10.7" r="5.8" />
      <path d="m15 15 4.7 4.7" />
    </>
  ),
  view: (
    <>
      <path d="M4 7h16" />
      <path d="M4 12h16" />
      <path d="M4 17h16" />
      <path d="M9 5v4" />
      <path d="M15 10v4" />
      <path d="M11 15v4" />
    </>
  ),
  about: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 11v5" />
      <path d="M12 8h.01" />
    </>
  ),
  layers: (
    <>
      <path d="m12 4 8 4-8 4-8-4Z" />
      <path d="m4 12 8 4 8-4" />
      <path d="m4 16 8 4 8-4" />
    </>
  ),
  properties: (
    <>
      <path d="M4 5h16v14H4z" />
      <path d="M8 10h8" />
      <path d="M8 14h5" />
    </>
  ),
  theme: (
    <>
      <circle cx="12" cy="12" r="7" />
      <path d="M12 5a7 7 0 0 0 0 14Z" />
    </>
  ),
  language: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3v18" />
      <path d="M3 12h18" />
      <path d="M12 3c3 0 5 4 5 9s-2 9-5 9-5-4-5-9 2-9 5-9z" />
    </>
  ),
  monochrome: (
    <>
      <rect x="4.5" y="5.5" width="15" height="13" rx="2" />
      <path d="M12 5.5v13" />
      <path d="M7.5 9h2" />
      <path d="M14.5 15h2" />
    </>
  ),
  layout: (
    <>
      <rect x="4" y="5" width="16" height="14" rx="2" />
      <path d="M8 9h8" />
      <path d="M8 13h5" />
    </>
  ),
  close: (
    <>
      <path d="M6 6l12 12" />
      <path d="M18 6 6 18" />
    </>
  ),
  checkboxChecked: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="3" fill="var(--accent-blue)" stroke="var(--accent-blue)" />
      <path d="m8 12.2 2.7 2.7L16.5 9" stroke="#ffffff" strokeWidth="2.8" />
    </>
  ),
  checkboxEmpty: <rect x="4" y="4" width="16" height="16" rx="3" stroke="var(--border-strong)" />,
  chevronRight: <path d="m9 6 6 6-6 6" />,
  chevronLeft: <path d="m15 6-6 6 6 6" />,
  chevronUp: <path d="m6 15 6-6 6 6" />,
  chevronDown: <path d="m6 9 6 6 6-6" />,
  sortAsc: <path d="m7 14 5-5 5 5" />,
  sortDesc: <path d="m7 10 5 5 5-5" />,
  filterEmpty: (
    <>
      <rect x="4" y="7" width="6" height="10" rx="1.5" />
      <rect x="14" y="7" width="6" height="10" rx="1.5" />
      <path d="M15 5 20 19" />
    </>
  ),
  sortName: (
    <>
      <path d="M5 7h9" />
      <path d="M5 12h7" />
      <path d="M5 17h4" />
    </>
  ),
  sortCount: (
    <>
      <path d="M5 7h14" />
      <path d="M5 12h10" />
      <path d="M5 17h6" />
    </>
  ),
};

type ViewerIconProps = React.SVGAttributes<SVGSVGElement> & {
  name: ViewerIconName;
};

/** 查看器统一 SVG 图标，桌面端与移动端共用同一套线性风格。 */
const ViewerIcon: React.FC<ViewerIconProps> = ({ name, ...svgProps }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...svgProps}>
    {ICON_PATHS[name]}
  </svg>
);

export default ViewerIcon;
