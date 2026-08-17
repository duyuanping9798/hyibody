import { useEffect, useRef, useState } from 'react';
import zh from '../../content/i18n/zh.json';
import { HyiViewer } from '../viewer/HyiViewer';

type LoadState = 'loading' | 'ready' | 'error';

export function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<LoadState>('loading');

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const viewer = new HyiViewer(container, { base: import.meta.env.BASE_URL });
    viewer
      .load()
      .then(() => setState('ready'))
      .catch(() => setState('error'));
    return () => viewer.dispose();
  }, []);

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
      {state !== 'ready' && (
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
          {state === 'loading' ? zh.loading : zh.loadError}
        </p>
      )}
      {state === 'ready' && (
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
