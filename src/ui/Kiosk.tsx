import { useEffect, useRef, useState } from 'react';
import zh from '../../content/i18n/zh.json';
import { attractLayer } from '../viewer/animation';
import { getViewer, useUiStore } from './store';

/**
 * Kiosk 展厅模式（M2-2，?kiosk=1 开启）：
 * - 闲置超时（默认 60s，?idle=秒 可调）进入吸引动画：自动旋转 + 分层扫描循环
 * - 任何触摸/按键退出吸引动画并重置计时；禁用右键菜单
 * - 大按钮样式由 body.hyi-kiosk 的 CSS 承担
 */
export function Kiosk({ idleSeconds }: { idleSeconds: number }) {
  const loadState = useUiStore((s) => s.loadState);
  const [attract, setAttract] = useState(false);
  const attractRef = useRef(attract);
  attractRef.current = attract;

  useEffect(() => {
    document.body.classList.add('hyi-kiosk');
    const prevent = (e: Event) => e.preventDefault();
    document.addEventListener('contextmenu', prevent);
    return () => {
      document.body.classList.remove('hyi-kiosk');
      document.removeEventListener('contextmenu', prevent);
    };
  }, []);

  // 闲置计时：交互重置；超时进入吸引动画
  useEffect(() => {
    if (loadState !== 'ready') return;
    let timer = setTimeout(() => setAttract(true), idleSeconds * 1000);
    const reset = () => {
      clearTimeout(timer);
      if (attractRef.current) {
        setAttract(false);
        getViewer()?.setAutoRotate(false);
        useUiStore.getState().setLayer(0);
      }
      timer = setTimeout(() => setAttract(true), idleSeconds * 1000);
    };
    for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart'])
      window.addEventListener(ev, reset, { passive: true });
    return () => {
      clearTimeout(timer);
      for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart'])
        window.removeEventListener(ev, reset);
    };
  }, [loadState, idleSeconds]);

  // 吸引动画：自动旋转 + 分层扫描
  useEffect(() => {
    if (!attract) return;
    const st = useUiStore.getState();
    if (st.tour) st.exitTour();
    st.select(null);
    getViewer()?.setAutoRotate(true, 0.8);
    const start = performance.now();
    const interval = setInterval(() => {
      useUiStore.getState().setLayer(attractLayer((performance.now() - start) / 1000));
    }, 120);
    return () => clearInterval(interval);
  }, [attract]);

  if (!attract) return null;
  return (
    <div className="hyi-attract" data-testid="kiosk-attract">
      <h1>{zh.brand}</h1>
      <p>{zh.kioskAttract}</p>
    </div>
  );
}
