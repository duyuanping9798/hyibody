import { STRINGS } from './i18n';
import { toCanvas } from 'qrcode';
import { useEffect, useRef, useState } from 'react';
import { encodeUrlState } from '../data/urlState';
import { toUrlState, useUiStore } from './store';

/** 分享弹层（M2-3）：当前视图状态编码进 URL + 二维码 + 复制。 */
export function ShareDialog({ onClose }: { onClose: () => void }) {
  const t = STRINGS[useUiStore((s) => s.lang)];
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [copied, setCopied] = useState(false);

  const url = new URL(window.location.href);
  url.searchParams.set('v', encodeUrlState(toUrlState()));
  url.searchParams.delete('kiosk');
  const shareUrl = url.toString();

  useEffect(() => {
    if (canvasRef.current)
      void toCanvas(canvasRef.current, shareUrl, {
        width: 208,
        margin: 1,
        color: { dark: '#0b1020', light: '#e8ecf4' },
      });
  }, [shareUrl]);

  return (
    <div className="hyi-attribution-backdrop" onClick={onClose}>
      <div className="hyi-panel hyi-share" onClick={(e) => e.stopPropagation()}>
        <h2>{t.shareTitle}</h2>
        <canvas ref={canvasRef} data-testid="share-qr" />
        <p className="url">{shareUrl}</p>
        <div className="actions">
          <button
            className="hyi-btn"
            onClick={() => {
              void navigator.clipboard?.writeText(shareUrl).then(() => setCopied(true));
            }}
          >
            {copied ? t.shareCopied : t.shareCopy}
          </button>
          <button className="hyi-btn" onClick={onClose}>
            {t.close}
          </button>
        </div>
      </div>
    </div>
  );
}
