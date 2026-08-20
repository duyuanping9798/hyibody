import { useEffect, useRef, useState } from 'react';
import { getViewer, useUiStore } from './store';

interface Anchor {
  x: number;
  y: number;
}

/** 小屏 + 信息卡打开 = 标签冗余。用真实 DOM 判断，不猜断点。 */
function cardCoversLabel(): boolean {
  const card = document.querySelector('.hyi-info');
  if (!card) return false;
  const r = card.getBoundingClientRect();
  // 通栏（占了九成以上宽度）才算"卡片就在结构正下方"，桌面端的左下角卡片不算
  return r.width >= window.innerWidth * 0.9;
}

/** 引线从结构中心斜拉到标签：短横 + 斜线，长度按容器尺寸自适应。 */
const LEG = 46;
const ARM = 26;

/**
 * 3D 标签引线：选中结构时在它旁边挂一个名字标签，用引线连回结构本身。
 * 每帧跟着相机重新投影（viewer.projectStructure），结构转到背面或被隐藏时自动消失。
 */
export function StructureLabel() {
  const lang = useUiStore((s) => s.lang);
  const selected = useUiStore((s) => s.selected);
  const manifest = useUiStore((s) => s.manifest);
  const wonder = useUiStore((s) => s.wonder);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const frame = useRef(0);

  useEffect(() => {
    if (!selected) {
      setAnchor(null);
      return;
    }
    let last: Anchor | null = null;
    const tick = () => {
      const point = getViewer()?.projectStructure(selected) ?? null;
      // 只有移动超过半像素才 setState，免得每帧都重渲染
      if (
        !point !== !last ||
        (point && last && (Math.abs(point.x - last.x) > 0.5 || Math.abs(point.y - last.y) > 0.5))
      ) {
        last = point;
        setAnchor(point);
      }
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame.current);
  }, [selected]);

  // 奥秘播放时底部有文案卡，标签会打架，暂时让位
  if (!selected || !anchor || !manifest || wonder) return null;
  // 小屏上信息卡是通栏抽屉，顶部大字写的就是同一个结构名——这时候再挂一个
  // 浮动标签等于把最稀缺的空间重复用了一次，而且引线多半正指向卡片后面
  if (cardCoversLabel()) return null;
  const info = manifest.structures[selected];
  if (!info) return null;

  // 结构在画面左半边时标签朝右拉，反之朝左，避免压住人体
  const toRight = anchor.x < (typeof window === 'undefined' ? 1280 : window.innerWidth) / 2;
  const dir = toRight ? 1 : -1;
  const elbowX = anchor.x + dir * LEG;
  const elbowY = anchor.y - LEG;
  const endX = elbowX + dir * ARM;

  return (
    <div className="hyi-label-layer" data-testid="structure-label" aria-hidden>
      <svg className="hyi-label-line" width="100%" height="100%">
        <circle cx={anchor.x} cy={anchor.y} r={3.5} />
        <polyline points={`${anchor.x},${anchor.y} ${elbowX},${elbowY} ${endX},${elbowY}`} />
      </svg>
      <div
        className={`hyi-label${toRight ? '' : ' left'}`}
        style={{ left: `${endX}px`, top: `${elbowY}px` }}
      >
        <span className="zh">{lang === 'zh' ? info.zh : info.en}</span>
        <span className="en">{lang === 'zh' ? info.en : info.zh}</span>
      </div>
    </div>
  );
}
