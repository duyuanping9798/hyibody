import { STRINGS } from './i18n';
import { useEffect, useRef, useState } from 'react';
import { decodeUrlState, encodeUrlState } from '../data/urlState';
import { HyiViewer } from '../viewer/HyiViewer';
import type { QualityTier } from '../viewer/quality';
import { Attribution } from './Attribution';
import { InfoCard } from './InfoCard';
import { Kiosk } from './Kiosk';
import { LayerSlider } from './LayerSlider';
import { SearchBox } from './SearchBox';
import { ShareDialog } from './ShareDialog';
import { bindViewer, toUrlState, useUiStore } from './store';
import { SystemPanel } from './SystemPanel';
import { TourMenu, TourPlayer } from './TourPlayer';
import { ViewTools } from './ViewTools';
import './ui.css';

/** Kiosk 参数：?kiosk=1（或分享状态里带 kiosk）开启；?idle=秒 调闲置阈值。 */
function readKioskParams(): { kiosk: boolean; idleSeconds: number } {
  const params = new URLSearchParams(window.location.search);
  const kiosk = params.get('kiosk') === '1' || decodeUrlState(params.get('v')).kiosk === true;
  const idle = Number(params.get('idle'));
  return { kiosk, idleSeconds: Number.isFinite(idle) && idle >= 2 ? idle : 60 };
}

/** `?hq=high|medium|low` 强制画质档位（真机比对与截图测试用）；不传则自动判断。 */
function readQualityParam(): QualityTier | undefined {
  const value = new URLSearchParams(window.location.search).get('hq');
  return value === 'high' || value === 'medium' || value === 'low' ? value : undefined;
}

/** 状态变化后把 ?v= 写回地址栏（防抖，replaceState 不产生历史记录）。 */
function useUrlSync(): void {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsub = useUiStore.subscribe((s, prev) => {
      if (s.loadState !== 'ready') return;
      if (
        s.layer === prev.layer &&
        s.systemsVisible === prev.systemsVisible &&
        s.clip === prev.clip &&
        s.selected === prev.selected
      )
        return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const url = new URL(window.location.href);
        url.searchParams.set('v', encodeUrlState(toUrlState()));
        window.history.replaceState(null, '', url);
      }, 400);
    });
    return () => {
      if (timer) clearTimeout(timer);
      unsub();
    };
  }, []);
}

export function App() {
  const t = STRINGS[useUiStore((s) => s.lang)];
  const containerRef = useRef<HTMLDivElement>(null);
  const loadState = useUiStore((s) => s.loadState);
  const manifest = useUiStore((s) => s.manifest);
  const setAttributionOpen = useUiStore((s) => s.setAttributionOpen);
  const activePanel = useUiStore((s) => s.activePanel);
  const togglePanel = useUiStore((s) => s.togglePanel);
  const tour = useUiStore((s) => s.tour);
  const [shareOpen, setShareOpen] = useState(false);
  const lang = useUiStore((s) => s.lang);
  const setLang = useUiStore((s) => s.setLang);
  const [{ kiosk, idleSeconds }] = useState(readKioskParams);
  useUrlSync();

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const viewer = new HyiViewer(container, {
      base: import.meta.env.BASE_URL,
      quality: readQualityParam(),
    });
    bindViewer(viewer);
    viewer
      .load()
      .then(() => {
        const m = viewer.getManifest();
        if (m) useUiStore.getState().setManifest(m);
        useUiStore.getState().setLoadState('ready');
        // 恢复分享链接状态（?v=）
        const encoded = new URLSearchParams(window.location.search).get('v');
        if (encoded) useUiStore.getState().applyUrlState(decodeUrlState(encoded));
      })
      .catch(() => useUiStore.getState().setLoadState('error'));
    return () => {
      bindViewer(null);
      viewer.dispose();
    };
  }, []);

  const isPlaceholder = manifest?.systems[0]?.id === 'placeholder';

  return (
    <div style={{ position: 'relative', height: '100%', overflow: 'hidden' }}>
      <div ref={containerRef} data-testid="viewer" style={{ position: 'absolute', inset: 0 }} />
      <header
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          padding: '14px 20px',
          display: 'flex',
          alignItems: 'baseline',
          gap: 12,
          pointerEvents: 'none',
          background: 'linear-gradient(180deg, rgba(11,16,32,0.85), rgba(11,16,32,0))',
        }}
      >
        <h1 style={{ margin: 0, fontSize: 22, letterSpacing: 1, color: '#4fe3e0' }}>{t.brand}</h1>
        <span style={{ fontSize: 13, opacity: 0.75 }}>{t.subtitle}</span>
      </header>
      {loadState !== 'ready' && (
        <p
          data-testid="viewer-status"
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            transform: 'translate(-50%, -50%)',
            fontSize: 14,
            opacity: 0.8,
          }}
        >
          {loadState === 'loading' ? t.loading : t.loadError}
        </p>
      )}
      {loadState === 'ready' && !isPlaceholder && (
        <>
          <div className="hyi-topbar">
            <button
              className="hyi-btn"
              aria-label="切换语言 / Switch language"
              onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}
            >
              {lang === 'zh' ? 'EN' : '中文'}
            </button>
            <TourMenu />
            <button className="hyi-btn" onClick={() => setShareOpen(true)}>
              {t.shareTitle}
            </button>
            <button className="hyi-btn" onClick={() => setAttributionOpen(true)}>
              {t.attribution}
            </button>
          </div>
          <SearchBox />
          <div className={`hyi-side panel-${activePanel ?? 'none'}`}>
            <div className="hyi-panel hyi-sec-systems">
              <SystemPanel />
            </div>
            <div className="hyi-panel hyi-sec-views">
              <ViewTools />
            </div>
          </div>
          <div className="hyi-mobile-tabs">
            <button
              className={`hyi-btn${activePanel === 'systems' ? ' active' : ''}`}
              onClick={() => togglePanel('systems')}
            >
              {t.systemsTitle}
            </button>
            <button
              className={`hyi-btn${activePanel === 'views' ? ' active' : ''}`}
              onClick={() => togglePanel('views')}
            >
              {t.presetsTitle}
            </button>
          </div>
          {!tour && <InfoCard />}
          {tour ? <TourPlayer /> : <LayerSlider />}
          <Attribution />
          {shareOpen && <ShareDialog onClose={() => setShareOpen(false)} />}
          {kiosk && <Kiosk idleSeconds={idleSeconds} />}
        </>
      )}
      {loadState === 'ready' && isPlaceholder && (
        <footer
          style={{
            position: 'absolute',
            bottom: 10,
            left: 0,
            right: 0,
            textAlign: 'center',
            fontSize: 12,
            opacity: 0.55,
            pointerEvents: 'none',
          }}
        >
          {t.placeholderNotice}
        </footer>
      )}
    </div>
  );
}
