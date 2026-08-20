import { useState } from 'react';
import { STRINGS } from './i18n';
import { useUiStore } from './store';

function humanSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * 录完之后的成品面板：预览、下载、分享。
 *
 * 分享走 Web Share API 的文件分享——手机上能直接丢进微信/相册，比"先下载再去相册找"
 * 少两步。桌面浏览器大多不支持带文件的分享，那就只留下载，不摆一个点了会失败的按钮。
 */
export function VideoExport() {
  const lang = useUiStore((s) => s.lang);
  const t = STRINGS[lang];
  const result = useUiStore((s) => s.videoExport);
  const clear = useUiStore((s) => s.clearVideoExport);
  const [sharing, setSharing] = useState(false);

  if (!result) return null;
  const filename = `${result.name}.${result.ext}`;
  const mime = result.ext === 'mp4' ? 'video/mp4' : 'video/webm';

  const canShareFile = () => {
    if (typeof navigator === 'undefined' || !navigator.canShare) return false;
    try {
      return navigator.canShare({ files: [new File([], filename, { type: mime })] });
    } catch {
      return false;
    }
  };

  const share = async () => {
    setSharing(true);
    try {
      const blob = await (await fetch(result.url)).blob();
      await navigator.share({
        files: [new File([blob], filename, { type: mime })],
        title: result.name,
      });
    } catch {
      // 用户自己取消了分享也会走到这儿，没什么好报的
    } finally {
      setSharing(false);
    }
  };

  return (
    <div className="hyi-attribution-backdrop" onClick={clear}>
      <div
        className="hyi-panel hyi-video-export"
        data-testid="video-export"
        onClick={(e) => e.stopPropagation()}
      >
        <h2>{t.videoExportTitle}</h2>
        <video src={result.url} controls playsInline preload="metadata" />
        <p className="meta">
          {t.videoExportMeta
            .replace('{dur}', String(Math.round(result.durationMs / 1000)))
            .replace('{size}', humanSize(result.bytes))}
        </p>
        <p className="hint">{t.videoExportHint}</p>
        <div className="acts">
          <a className="hyi-btn hyi-btn-warm" href={result.url} download={filename}>
            {t.videoExportDownload}
          </a>
          {canShareFile() && (
            <button className="hyi-btn" disabled={sharing} onClick={() => void share()}>
              {t.videoExportShare}
            </button>
          )}
          <button className="hyi-btn" onClick={clear}>
            {t.videoExportClose}
          </button>
        </div>
      </div>
    </div>
  );
}
