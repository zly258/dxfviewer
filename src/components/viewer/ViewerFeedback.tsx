import { Language } from '@/config/i18n';

import ViewerIcon from '@/components/viewer/ViewerIcon';

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
  onClose: () => void;
}

export interface ViewerNoticeProps {
  lang: Language;
  message: string;
  hasEntities: boolean;
  onFitView: () => void;
  onDismiss: () => void;
}

export function LoadingOverlay({ lang, fileName, progress }: LoadingOverlayProps) {
  const safeProgress = Math.max(0, Math.min(100, progress));
  const fallbackName = lang === 'zh' ? 'DXF 文件' : 'DXF file';
  const title = lang === 'zh' ? '正在加载' : 'Loading';

  return (
    <div className="loading-overlay" aria-live="polite" aria-busy="true">
      <div className="loading-card" title={fileName || fallbackName}>
        <div className="loading-header">
          <span className="loading-spinner" aria-hidden="true" />
          <div className="loading-text-block">
            <div className="loading-title">{title}</div>
            <div className="loading-file">{fileName || fallbackName}</div>
          </div>
          <div className="loading-progress-text">{safeProgress}%</div>
        </div>
        <div className="loading-progressbar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={safeProgress}>
          <div className="loading-progressbar-value" style={{ width: `${safeProgress}%` }} />
        </div>
      </div>
    </div>
  );
}

export function Toast({ toast, onClose }: ToastProps) {
  return (
    <div className="toast-container">
      <div className={`toast ${toast.isError ? 'error' : 'success'}`}>
        <span className="toast-message">{toast.msg}</span>
        <span className="toast-close" onClick={onClose} aria-label="关闭提示">
          <ViewerIcon name="close" />
        </span>
      </div>
    </div>
  );
}

export function ViewerNotice({ lang, message, hasEntities, onFitView, onDismiss }: ViewerNoticeProps) {
  return (
    <div className="viewer-error-panel">
      <div className="viewer-error-title">
        {lang === 'zh' ? '没有可显示内容' : 'Nothing Visible'}
      </div>
      <div className="viewer-error-message">{message}</div>
      <div className="viewer-error-actions">
        {hasEntities && (
          <button type="button" className="viewer-error-button" onClick={onFitView}>
            {lang === 'zh' ? '充满视图' : 'Fit View'}
          </button>
        )}
        <button type="button" className="viewer-error-button primary" onClick={onDismiss}>
          {lang === 'zh' ? '关闭提示' : 'Dismiss'}
        </button>
      </div>
    </div>
  );
}
