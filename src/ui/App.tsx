import { STRINGS } from './i18n';
import { useEffect, useRef, useState } from 'react';
import { decodeUrlState, encodeUrlState } from '../data/urlState';
import { HyiViewer } from '../viewer/HyiViewer';
import type { QualityTier } from '../viewer/quality';
import { Attribution } from './Attribution';
import { InfoCard } from './InfoCard';
import { Kiosk } from './Kiosk';
import { LayerSlider } from './LayerSlider';
import { LoadingOverlay } from './LoadingOverlay';
import { StructureLabel } from './StructureLabel';
import { SearchBox } from './SearchBox';
import { ShortcutHelp } from './ShortcutHelp';
import { ShareDialog } from './ShareDialog';
import { useKeyboardShortcuts } from './keyboard';
import { bindViewer, toUrlState, useUiStore } from './store';
import { SystemPanel } from './SystemPanel';
import { WonderMenu, WonderPlayer } from './WonderPlayer';
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
  const wonder = useUiStore((s) => s.wonder);
  const [shareOpen, setShareOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const selected = useUiStore((s) => s.selected);
  const lang = useUiStore((s) => s.lang);
  const setLang = useUiStore((s) => s.setLang);
  const [{ kiosk, idleSeconds }] = useState(readKioskParams);
  useUrlSync();
  useKeyboardShortcuts({ helpOpen, setHelpOpen, shareOpen, setShareOpen });

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
      <header className="hyi-header">
        <h1>{t.brand}</h1>
        <span className="hyi-header-sub">{t.subtitle}</span>
      </header>
      <LoadingOverlay />
      {loadState === 'error' && (
        <p data-testid="viewer-status" className="hyi-center-status">
          {t.loadError}
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
            <WonderMenu />
            <button className="hyi-btn" onClick={() => setShareOpen(true)}>
              {t.shareTitle}
            </button>
            <button className="hyi-btn" onClick={() => setAttributionOpen(true)}>
              {t.attribution}
            </button>
            <button
              className="hyi-btn hyi-btn-icon"
              aria-label={t.shortcutsTitle}
              title={t.shortcutsTitle}
              onClick={() => setHelpOpen(true)}
            >
              ?
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
          {!wonder && <StructureLabel />}
          {!wonder && <InfoCard />}
          {wonder ? <WonderPlayer /> : <LayerSlider />}
          <Attribution />
          {shareOpen && <ShareDialog onClose={() => setShareOpen(false)} />}
          {helpOpen && <ShortcutHelp onClose={() => setHelpOpen(false)} />}
          {/* 点画布选中结构时读屏软件也要能听见，所以单独播一条 */}
          <p className="hyi-sr-only" role="status" aria-live="polite">
            {selected && manifest?.structures[selected]
              ? lang === 'zh'
                ? manifest.structures[selected].zh
                : manifest.structures[selected].en
              : ''}
          </p>
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
