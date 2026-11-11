import { Language, t } from '@/ui/i18n';

import ViewerIcon from '@/ui/components/common/ViewerIcon';

export interface LoadingOverlayProps {
  lang: Language;
  fileName: string;
  progress: number;
}

export interface ToastState {
  msg: string;
  isError: boolean;
}

export interface ToastProps {
  toast: ToastState;
  lang: Language;
  onClose: () => void;
}

export interface ViewerNoticeProps {
  lang: Language;
  message: string;
  hasEntities: boolean;
  onFitView: () => void;
  onDismiss: () => void;
}

/**
 * 加载浮层（web-ui-style §11 Loading 三件套）。
 * 结构：spinner + 标题/文件名 + 百分比 → 4px 进度条。
 */
export function LoadingOverlay({ lang, fileName, progress }: LoadingOverlayProps) {
  const safeProgress = Math.max(0, Math.min(100, progress));
  const fallbackName = t(lang, 'dxfFile');
  const title = t(lang, 'loading');

  return (
    <div className="loading-overlay" aria-live="polite" aria-busy="true">
      <div className="loading-card" title={fileName || fallbackName}>
        <div className="cad-loading-head">
          <span className="cad-spinner cad-spinner-sm" aria-hidden="true" />
          <div className="loading-text-block">
            <div className="cad-loading-title" title={title}>{title}</div>
            <div className="loading-file" title={fileName || fallbackName}>{fileName || fallbackName}</div>
          </div>
          <span className="cad-loading-pct">{safeProgress}%</span>
        </div>
        <div
          className="cad-loading-track"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={safeProgress}
        >
          <i style={{ width: `${safeProgress}%` }} />
        </div>
      </div>
    </div>
  );
}

/**
 * Toast（§10）：白底 + 1px 边框 + --shadow-card，类型色只作用于文字与边框。
 */
export function Toast({ toast, lang, onClose }: ToastProps) {
  return (
    <div className="cad-toast-container">
      <div className={`cad-toast ${toast.isError ? 'error' : 'success'}`} role="status">
        <span className="toast-message">{toast.msg}</span>
        <button type="button" className="toast-close" onClick={onClose} title={t(lang, 'closeToast')} aria-label={t(lang, 'closeToast')}>
          <ViewerIcon name="close" />
        </button>
      </div>
    </div>
  );
}

/**
 * 运行期提示条（§13）：只提示不阻塞，带「确定」关闭。
 */
export function ViewerNotice({ lang, message, hasEntities, onFitView, onDismiss }: ViewerNoticeProps) {
  return (
    <div className="viewer-error-panel" role="alert">
      <div className="viewer-error-title">{t(lang, 'nothingVisible')}</div>
      <div className="viewer-error-message">{message}</div>
      <div className="viewer-error-actions">
        {hasEntities && (
          <button
            type="button"
            className="viewer-error-button"
            onClick={onFitView}
            title={t(lang, 'fitView')}
            aria-label={t(lang, 'fitView')}
          >
            <ViewerIcon name="fit" />
          </button>
        )}
        <button
          type="button"
          className="viewer-error-button primary"
          onClick={onDismiss}
          title={t(lang, 'dismiss')}
          aria-label={t(lang, 'dismiss')}
        >
          <ViewerIcon name="close" />
        </button>
      </div>
    </div>
  );
}
