import { Language } from '@/config/i18n';

import ViewerIcon from '@/components/viewer/ViewerIcon';

interface AboutDialogProps {
  lang: Language;
  onClose: () => void;
}

function AboutDialog({ lang, onClose }: AboutDialogProps) {
  return (
    <div className="about-modal-overlay" onClick={onClose}>
      <div className="about-modal-content" onClick={(event) => event.stopPropagation()}>
        <div className="about-modal-header">
          <span className="about-modal-title">{lang === 'zh' ? '关于 DXF Viewer' : 'About DXF Viewer'}</span>
          <span className="about-modal-close" onClick={onClose} aria-label={lang === 'zh' ? '关闭' : 'Close'}>
            <ViewerIcon name="close" />
          </span>
        </div>
        <div className="about-modal-body">
          <div className="about-logo">CAD</div>
          <h3>{lang === 'zh' ? 'DXF 浏览器' : 'DXF Viewer'}</h3>
          <p className="about-desc">
            {lang === 'zh'
              ? '基于 React 和 HTML5 Canvas 的 DXF 文件查看组件，支持模型空间、多个图纸空间、常用几何实体、文字、标注和块参照解析渲染。'
              : 'A React and HTML5 Canvas based DXF viewer component with Model/Layout switching, common geometry, text, annotations and block rendering.'}
          </p>
          <div className="about-info-grid">
            <div className="about-info-label">{lang === 'zh' ? '联系邮箱' : 'Contact Email'}</div>
            <div className="about-info-value">
              <a href="mailto:zhangly1403@qq.com" className="about-email-link">zhangly1403@qq.com</a>
            </div>
            <div className="about-info-label">{lang === 'zh' ? '开源协议' : 'License'}</div>
            <div className="about-info-value">MIT License</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default AboutDialog;
