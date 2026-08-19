import { STRINGS } from './i18n';
import type { ReactNode } from 'react';
import { ClipTools, ViewTools } from './ViewTools';
import { SystemPanel } from './SystemPanel';
import { useUiStore, type PanelId } from './store';

function Drawer({ id, title, children }: { id: PanelId; title: string; children: ReactNode }) {
  const activePanel = useUiStore((s) => s.activePanel);
  const togglePanel = useUiStore((s) => s.togglePanel);
  const open = activePanel === id;
  return (
    <div className={`hyi-drawer${open ? ' open' : ''}`}>
      <button
        className="hyi-drawer-head"
        aria-expanded={open}
        aria-controls={`hyi-drawer-${id}`}
        onClick={() => togglePanel(id)}
      >
        <span>{title}</span>
        <span className="hyi-chevron" aria-hidden>
          ›
        </span>
      </button>
      {open && (
        <div className="hyi-drawer-body" id={`hyi-drawer-${id}`}>
          {children}
        </div>
      )}
    </div>
  );
}

/**
 * 工具抽屉。
 *
 * 原来右侧常驻两块大面板（六行滑块 + 十个按钮 + 一段画质说明），用户的原话是
 * "页面设计杂乱"。现在收成三个标题条，一次只展开一格，默认全收起——画面留给人体，
 * 需要哪一格点哪一格。桌面和小屏共用同一套结构，只是靠 CSS 换位置。
 */
export function Dock() {
  const t = STRINGS[useUiStore((s) => s.lang)];
  const clip = useUiStore((s) => s.clip);
  const hiddenCount = useUiStore((s) => s.hiddenCount);
  const isolated = useUiStore((s) => s.isolated);
  const expanded = useUiStore((s) => s.expanded);
  const backToBody = useUiStore((s) => s.backToBody);
  const expand = useUiStore((s) => s.expand);
  const dirty = hiddenCount > 0 || isolated !== null || expanded !== null || clip !== null;

  return (
    <div className="hyi-dock" data-testid="dock">
      <Drawer id="systems" title={t.systemsTitle}>
        <SystemPanel />
      </Drawer>
      <Drawer id="views" title={t.presetsTitle}>
        <ViewTools />
      </Drawer>
      <Drawer id="clip" title={t.clipTitle}>
        <ClipTools />
      </Drawer>
      {/* 展开内部之后 store 会清掉选中，信息卡跟着消失——"收起内部"必须挂在
          抽屉外面常驻，否则钻进心脏里就只剩"返回全身"这一条退路了 */}
      {expanded !== null && (
        <button className="hyi-btn hyi-collapse-parts" onClick={() => expand(null)}>
          {t.collapseParts}
        </button>
      )}
      {dirty && (
        <button className="hyi-btn hyi-back-to-body" onClick={backToBody}>
          {t.backToBody}
          {hiddenCount > 0 ? `（${t.hiddenCount.replace('{n}', String(hiddenCount))}）` : ''}
        </button>
      )}
    </div>
  );
}
