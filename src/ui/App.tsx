import { useEffect, useRef } from 'react';
import zh from '../../content/i18n/zh.json';
import { decodeUrlState, encodeUrlState } from '../data/urlState';
import { HyiViewer } from '../viewer/HyiViewer';
import { Attribution } from './Attribution';
import { InfoCard } from './InfoCard';
import { LayerSlider } from './LayerSlider';
import { SearchBox } from './SearchBox';
import { bindViewer, toUrlState, useUiStore } from './store';
import { SystemPanel } from './SystemPanel';
import { TourMenu, TourPlayer } from './TourPlayer';
import { ViewTools } from './ViewTools';
import './ui.css';

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
  const containerRef = useRef<HTMLDivElement>(null);
  const loadState = useUiStore((s) => s.loadState);
  const manifest = useUiStore((s) => s.manifest);
  const setAttributionOpen = useUiStore((s) => s.setAttributionOpen);
  const activePanel = useUiStore((s) => s.activePanel);
  const togglePanel = useUiStore((s) => s.togglePanel);
  const tour = useUiStore((s) => s.tour);
  useUrlSync();

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const viewer = new HyiViewer(container, { base: import.meta.env.BASE_URL });
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
        <h1 style={{ margin: 0, fontSize: 22, letterSpacing: 1, color: '#4fe3e0' }}>{zh.brand}</h1>
        <span style={{ fontSize: 13, opacity: 0.75 }}>{zh.subtitle}</span>
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
          {loadState === 'loading' ? zh.loading : zh.loadError}
        </p>
      )}
      {loadState === 'ready' && !isPlaceholder && (
        <>
          <div className="hyi-topbar">
            <TourMenu />
            <button className="hyi-btn" onClick={() => setAttributionOpen(true)}>
              {zh.attribution}
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
              {zh.systemsTitle}
            </button>
            <button
              className={`hyi-btn${activePanel === 'views' ? ' active' : ''}`}
              onClick={() => togglePanel('views')}
            >
              {zh.presetsTitle}
            </button>
          </div>
          {!tour && <InfoCard />}
          {tour ? <TourPlayer /> : <LayerSlider />}
          <Attribution />
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
          {zh.placeholderNotice}
        </footer>
      )}
    </div>
  );
}
