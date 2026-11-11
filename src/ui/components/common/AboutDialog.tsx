import { Language, t } from '@/ui/i18n';

import ViewerIcon from '@/ui/components/common/ViewerIcon';

interface AboutDialogProps {
  lang: Language;
  onClose: () => void;
}

/**
 * 关于弹窗（web-ui-style §9.2 文档型弹窗）。
 * 结构：46px 头（标题 + 关闭 ×）→ 内容滚动区；遮罩点击关闭。
 */
function AboutDialog({ lang, onClose }: AboutDialogProps) {
  return (
    <div className="about-modal-overlay" onClick={onClose} role="presentation">
      <div
        className="about-modal-content"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t(lang, 'aboutTitle')}
      >
        <div className="ui-dialog-head about-modal-header">
          <span className="about-modal-title" title={t(lang, 'aboutTitle')}>{t(lang, 'aboutTitle')}</span>
          <button
            type="button"
            className="about-modal-close"
            onClick={onClose}
            title={t(lang, 'close')}
            aria-label={t(lang, 'close')}
          >
            <ViewerIcon name="close" />
          </button>
        </div>
        <div className="about-modal-body">
          <div className="about-logo" aria-hidden="true">CAD</div>
          <h3>{t(lang, 'aboutHeading')}</h3>
          <p className="about-desc">{t(lang, 'aboutDescription')}</p>
          <div className="about-info-grid">
            <div className="about-info-label">{t(lang, 'repository')}</div>
            <div className="about-info-value">
              <a
                href="https://github.com/zly258/dxfviewer"
                target="_blank"
                rel="noopener noreferrer"
                className="about-link"
              >
                github.com/zly258/dxfviewer
              </a>
            </div>
            <div className="about-info-label">{t(lang, 'renderEngine')}</div>
            <div className="about-info-value">WebGL 2D / Canvas 2D</div>
            <div className="about-info-label">{t(lang, 'license')}</div>
            <div className="about-info-value">MIT License</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default AboutDialog;
