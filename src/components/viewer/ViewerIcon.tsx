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
  | 'close';

/** 查看器统一 SVG 图标，桌面端与移动端共用同一套线性风格。 */
const ViewerIcon: React.FC<{ name: ViewerIconName }> = ({ name }) => {
  switch (name) {
    case 'open':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M4 7.2h5.1l1.9 2h9v8.6a1.8 1.8 0 0 1-1.8 1.8H5.8A1.8 1.8 0 0 1 4 17.8Z" />
          <path d="M4 7.2V5.8C4 4.8 4.8 4 5.8 4h4l1.9 2h6.5c1 0 1.8.8 1.8 1.8v1.4" />
        </svg>
      );
    case 'previous':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M10 6 4 12l6 6" />
          <path d="M5 12h15" />
        </svg>
      );
    case 'next':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="m14 6 6 6-6 6" />
          <path d="M19 12H4" />
        </svg>
      );
    case 'fit':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M5 9V5h4" />
          <path d="M15 5h4v4" />
          <path d="M19 15v4h-4" />
          <path d="M9 19H5v-4" />
          <path d="M9 12h6" />
          <path d="M12 9v6" />
        </svg>
      );
    case 'search':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <circle cx="10.7" cy="10.7" r="5.8" />
          <path d="m15 15 4.7 4.7" />
        </svg>
      );
    case 'view':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M4 7h16" />
          <path d="M4 12h16" />
          <path d="M4 17h16" />
          <path d="M9 5v4" />
          <path d="M15 10v4" />
          <path d="M11 15v4" />
        </svg>
      );
    case 'about':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <circle cx="12" cy="12" r="8" />
          <path d="M12 11v5" />
          <path d="M12 8h.01" />
        </svg>
      );
    case 'layers':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="m12 4 8 4-8 4-8-4Z" />
          <path d="m4 12 8 4 8-4" />
          <path d="m4 16 8 4 8-4" />
        </svg>
      );
    case 'properties':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <rect x="5" y="4" width="14" height="16" rx="2" />
          <path d="M8 8h8" />
          <path d="M8 12h8" />
          <path d="M8 16h5" />
        </svg>
      );
    case 'theme':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <circle cx="12" cy="12" r="7" />
          <path d="M12 5a7 7 0 0 0 0 14Z" />
        </svg>
      );
    case 'language':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M4 5.5h9.5" />
          <path d="M8.8 4v1.5" />
          <path d="M13 5.5c-.8 2.5-2.3 4.7-4.7 6.8" />
          <path d="M6.2 8.2c1.1 2 3 3.6 5.6 4.8" />
          <path d="M15 20l3-8 3 8" />
          <path d="M16.1 17h3.8" />
        </svg>
      );
    case 'monochrome':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <rect x="4.5" y="5.5" width="15" height="13" rx="2" />
          <path d="M12 5.5v13" />
          <path d="M7.5 9h2" />
          <path d="M14.5 15h2" />
        </svg>
      );
    case 'layout':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <rect x="4" y="5" width="16" height="14" rx="2" />
          <path d="M8 9h8" />
          <path d="M8 13h5" />
        </svg>
      );
    case 'close':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M6 6l12 12" />
          <path d="M18 6 6 18" />
        </svg>
      );
  }
};

export default ViewerIcon;
