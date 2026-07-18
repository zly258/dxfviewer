import { Language, t } from '@/config/i18n';

import ViewerIcon from '@/components/common/ViewerIcon';

interface AboutDialogProps {
  lang: Language;
  onClose: () => void;
}

function AboutDialog({ lang, onClose }: AboutDialogProps) {
  return (
    <div className="about-modal-overlay" onClick={onClose}>
      <div className="about-modal-content" onClick={(event) => event.stopPropagation()}>
        <div className="about-modal-header">
          <span className="about-modal-title">{t(lang, 'aboutTitle')}</span>
          <span className="about-modal-close" onClick={onClose} aria-label={t(lang, 'close')}>
            <ViewerIcon name="close" />
          </span>
        </div>
        <div className="about-modal-body">
          <div className="about-logo">CAD</div>
          <h3>{t(lang, 'aboutHeading')}</h3>
          <p className="about-desc">
            {t(lang, 'aboutDescription')}
          </p>
          <div className="about-info-grid">
            <div className="about-info-label">{t(lang, 'contactEmail')}</div>
            <div className="about-info-value">
              <a href="mailto:zhangly1403@qq.com" className="about-email-link">zhangly1403@qq.com</a>
            </div>
            <div className="about-info-label">{t(lang, 'license')}</div>
            <div className="about-info-value">MIT License</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default AboutDialog;
