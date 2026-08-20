import { useEffect } from 'react';
import { getViewer, useUiStore } from './store';

/** 会遮住三维画面的常驻元素：上面一组、下面一组。 */
const TOP = ['.hyi-header', '.hyi-topbar'];
// 信息卡在小屏上是底部抽屉，一弹出就吃掉半屏——它必须算进来，
// 否则点选一个结构后相机把它居中到画布中心，正好藏在卡片后面（用户实拍复现）
const BOTTOM = ['.hyi-layer-slider', '.hyi-wonder', '.hyi-dock', '.hyi-info'];

/**
 * 元素在画布坐标系里的上下边（不可见、或者根本没压在人体那一列上，就当没有）。
 *
 * 只算"横向盖住画布中线"的元素。人体是居中取景的，桌面端左下角的信息卡、
 * 右上角的工具抽屉都在它两侧，不该把取景挤窄；而手机上同样两个元素是通栏的，
 * 就必须算进来。同一份选择器清单，靠这条判据自动分辨两种布局。
 */
function edges(sel: string, host: DOMRect): { top: number; bottom: number } | null {
  const el = document.querySelector(sel);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return null;
  const midX = host.left + host.width / 2;
  if (r.left > midX || r.right < midX) return null;
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

      // 信息卡的真实高度写进 CSS 变量，让分层滑块精确地贴在它上面。
      // 原来 CSS 里写死 46vh 来让位，可卡片算上 padding 与安全区实际有 326 px
      // 而 46vh 只有 294 px——滑块下沿有 22 px 一直压在卡片底下（实测）。
      const card = document.querySelector('.hyi-info');
      const cardH = card ? Math.round(card.getBoundingClientRect().height) : 0;
      document.documentElement.style.setProperty('--hyi-info-h', `${cardH}px`);
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
