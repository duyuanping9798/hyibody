import { STRINGS } from './i18n';
import { useUiStore } from './store';

/**
 * 右侧的两个逃生按钮。
 *
 * 这里原来是三格工具抽屉（系统/视角/剖切）。2026-08-22 按用户拍板全部砍掉：
 * 系统控制并进了底部控制条（LayerBar 六个独立推子），预设视角与剖切不再
 * 提供界面入口（能力保留在引擎里，奥秘步骤与旧分享链接还在用）。
 * 「收起内部」「返回全身」必须常驻——钻进心脏内部之后总得有条出路，
 * 而剖切/隐藏状态从旧链接或奥秘退场时带进来，也只能靠「返回全身」清掉。
 */
export function Dock() {
  const t = STRINGS[useUiStore((s) => s.lang)];
  const clip = useUiStore((s) => s.clip);
  const hiddenCount = useUiStore((s) => s.hiddenCount);
  const isolated = useUiStore((s) => s.isolated);
  const expanded = useUiStore((s) => s.expanded);
  const backToBody = useUiStore((s) => s.backToBody);
  const collapseParts = useUiStore((s) => s.collapseParts);
  const dirty = hiddenCount > 0 || isolated !== null || expanded !== null || clip !== null;

  if (!dirty) return null;
  return (
    <div className="hyi-dock" data-testid="dock">
      {/* 展开内部之后 store 会清掉选中，信息卡跟着消失——"收起内部"必须常驻，
          否则钻进心脏里就只剩"返回全身"这一条退路了 */}
      {expanded !== null && (
        <button className="hyi-btn hyi-collapse-parts" onClick={collapseParts}>
          {t.collapseParts}
        </button>
      )}
      <button className="hyi-btn hyi-back-to-body" onClick={backToBody}>
        {t.backToBody}
        {hiddenCount > 0 ? `（${t.hiddenCount.replace('{n}', String(hiddenCount))}）` : ''}
      </button>
    </div>
  );
}
