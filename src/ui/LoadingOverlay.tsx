import { STRINGS } from './i18n';
import { useUiStore } from './store';

/**
 * 加载进度：首屏（皮肤+骨骼）加载时占满屏幕的进度条；首屏就绪后缩成顶部一条细线，
 * 直到其余四个系统后台补完。KICKOFF 验收线是"手机 10 秒内可交互"，
 * 所以进度条必须能看出"已经可以动了，只是还在补细节"。
 */
export function LoadingOverlay() {
  const t = STRINGS[useUiStore((s) => s.lang)];
  const loadState = useUiStore((s) => s.loadState);
  const progress = useUiStore((s) => s.progress);
  const ratio = progress.total > 0 ? progress.loaded / progress.total : 0;

  if (loadState === 'error') return null;
  if (loadState === 'ready' && progress.loaded >= progress.total) return null;

  if (loadState === 'ready') {
    // 首屏已可交互：只留顶部一条细进度线
    return (
      <div
        className="hyi-progress-thin"
        data-testid="loading-thin"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={progress.total}
        aria-valuenow={progress.loaded}
      >
        <span style={{ width: `${Math.round(ratio * 100)}%` }} />
      </div>
    );
  }

  return (
    <div className="hyi-loading" data-testid="loading-overlay">
      <div className="hyi-loading-inner">
        <p className="hyi-loading-title">{t.loading}</p>
        <div className="hyi-progress" role="progressbar" aria-valuenow={Math.round(ratio * 100)}>
          <span style={{ width: `${Math.max(6, Math.round(ratio * 100))}%` }} />
        </div>
        <p className="hyi-loading-sub">
          {t.loadingSystems
            .replace('{done}', String(progress.loaded))
            .replace('{total}', String(progress.total))}
        </p>
      </div>
    </div>
  );
}
