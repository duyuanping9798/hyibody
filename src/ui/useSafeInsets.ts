import { useEffect } from 'react';
import { getViewer, useUiStore } from './store';

/** 会遮住三维画面的常驻元素：上面一组、下面一组。 */
const TOP = ['.hyi-header', '.hyi-topbar'];
const BOTTOM = ['.hyi-layer-slider', '.hyi-wonder', '.hyi-dock'];

/** 元素在画布坐标系里的上下边（不可见或不在画面里就当没有）。 */
function edges(sel: string, host: DOMRect): { top: number; bottom: number } | null {
  const el = document.querySelector(sel);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return null;
  return { top: r.top - host.top, bottom: r.bottom - host.top };
}

/**
 * 量出画布上下各被界面挡住多少，推给查看器去调取景。
 *
 * 原来取景按整块画布算，人体占满九成高度，上下各只剩三四十像素——
 * 结果脚陷进分层滑块、手机上头顶压着品牌栏。矮屏幕（苹果笔电是 16:10，
 * 扣掉菜单栏和标签栏之后特别矮）尤其明显。
 *
 * 量真实 DOM 而不是写死数字：面板会随语言、字号、奥秘播放器换高度。
 */
export function useSafeInsets(): void {
  useEffect(() => {
    let frame = 0;
    const measure = () => {
      const host = document.querySelector('[data-testid="viewer"]');
      const viewer = getViewer();
      if (!host || !viewer) return;
      const rect = host.getBoundingClientRect();
      if (rect.height === 0) return;
      let top = 0;
      for (const sel of TOP) {
        const e = edges(sel, rect);
        // 只认贴着上半部分的元素，免得把浮层算进来
        if (e && e.top < rect.height / 2) top = Math.max(top, e.bottom);
      }
      let bottom = 0;
      for (const sel of BOTTOM) {
        const e = edges(sel, rect);
        if (e && e.bottom > rect.height / 2) bottom = Math.max(bottom, rect.height - e.top);
      }
      viewer.setSafeInsets({ top: top + 8, bottom: bottom + 8 });
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    schedule();
    const ro = new ResizeObserver(schedule);
    ro.observe(document.body);
    window.addEventListener('resize', schedule);
    window.addEventListener('orientationchange', schedule);
    // 面板是随状态出现/消失的（加载完才有顶栏，奥秘播放器比分层滑块高），
    // 光靠 ResizeObserver 盯 body 量不到——body 尺寸从头到尾不变
    const unsub = useUiStore.subscribe(schedule);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      unsub();
      window.removeEventListener('resize', schedule);
      window.removeEventListener('orientationchange', schedule);
    };
  }, []);
}
