import { useMemo, useState, type ReactNode } from 'react';
import { SYSTEM_COLORS } from '../viewer/materials';
import type { SystemId } from '../data/types';

/**
 * 整页卡片画廊：奥秘与局部细剖共用这一套。
 *
 * 为什么共用：两页要的东西一模一样——顶栏 + 一排分类标签 + 缩略图卡片网格，
 * 差别只在数据从哪来、点开之后做什么。写两份的话，改一次间距就要改两处，
 * 而人类明确要求"其他平台也是同样风格"。
 */

export interface GalleryItem {
  id: string;
  title: string;
  /** 卡片右下角的小字：奥秘是时长，细剖是部位 */
  meta?: string;
  /** 决定占位色与左上角色标；没有缩略图时这是唯一的视觉线索 */
  system: SystemId;
  /** `public/thumbs/<name>.webp`；渲染不出来时退回占位色块 */
  thumb?: string;
  /** 卡片角标，例如细剖的「3D」 */
  badge?: string;
}

export interface GalleryTab {
  id: string;
  label: string;
  /** 该标签下要显示哪些条目；返回空数组时这个标签自动不出现 */
  items: GalleryItem[];
}

interface Props {
  title: string;
  tabs: GalleryTab[];
  onPick(id: string): void;
  onClose(): void;
  closeLabel: string;
  emptyLabel: string;
  /** 顶栏右侧的附加操作（例如奥秘的「创作」） */
  actions?: ReactNode;
  testId?: string;
}

function hex(system: SystemId): string {
  return `#${SYSTEM_COLORS[system].toString(16).padStart(6, '0')}`;
}

/**
 * 只留有内容的标签，并把选中下标夹回合法范围。
 *
 * 夹这一下是必要的：标签数量会变（草稿删光了「我的创作」就没了、切语言不会变
 * 但换数据源会），选中的还停在旧下标上就会渲染出一个空网格——看着像内容丢了。
 * 抽成纯函数是为了能测，组件里测不了（这个仓库的 vitest 跑在 node 环境，没有 DOM）。
 */
export function pickTab<T extends { items: unknown[] }>(
  tabs: readonly T[],
  active: number,
): { shown: T[]; tab: T | undefined; index: number } {
  const shown = tabs.filter((t) => t.items.length > 0);
  if (shown.length === 0) return { shown, tab: undefined, index: 0 };
  const index = Math.min(Math.max(0, active), shown.length - 1);
  return { shown, tab: shown[index], index };
}

export function Gallery({
  title,
  tabs,
  onPick,
  onClose,
  closeLabel,
  emptyLabel,
  actions,
  testId,
}: Props) {
  const [active, setActive] = useState(0);
  const { shown, tab } = useMemo(() => pickTab(tabs, active), [tabs, active]);

  return (
    <div className="hyi-gallery" data-testid={testId} role="dialog" aria-label={title}>
      <header className="hyi-gallery-top">
        <div className="hyi-gallery-actions-left">{actions}</div>
        <h2>{title}</h2>
        <button className="hyi-gallery-close" onClick={onClose} aria-label={closeLabel}>
          ✕
        </button>
      </header>

      {shown.length > 1 && (
        <nav className="hyi-gallery-tabs" role="tablist" aria-label={title}>
          {shown.map((t, i) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={t === tab}
              className={t === tab ? 'active' : undefined}
              onClick={() => setActive(i)}
            >
              {t.label}
            </button>
          ))}
        </nav>
      )}

      <div className="hyi-gallery-scroll">
        {!tab || tab.items.length === 0 ? (
          <p className="hyi-gallery-empty">{emptyLabel}</p>
        ) : (
          <ul className="hyi-gallery-grid">
            {tab.items.map((item) => (
              <li key={item.id}>
                <button
                  className="hyi-card"
                  onClick={() => onPick(item.id)}
                  style={{ ['--hyi-card-color' as string]: hex(item.system) }}
                >
                  <span className="hyi-card-shot">
                    {item.thumb ? (
                      // 缩略图是渲出来的静帧（scripts/thumbs.mjs）。加载失败就让它透明，
                      // 底下的系统色占位块本来就在，不会留一个破图图标
                      <img
                        src={item.thumb}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        onError={(e) => {
                          e.currentTarget.style.visibility = 'hidden';
                        }}
                      />
                    ) : null}
                    {item.badge && <span className="hyi-card-badge">{item.badge}</span>}
                  </span>
                  <span className="hyi-card-title">{item.title}</span>
                  {item.meta && <span className="hyi-card-meta">{item.meta}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
