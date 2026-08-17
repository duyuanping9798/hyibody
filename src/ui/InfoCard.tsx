import { STRINGS } from './i18n';
import { definitionsZh } from '../data/definitions';
import type { SystemId } from '../data/types';
import { useUiStore } from './store';

/** 信息卡：中英名、一句话科普（占位）、系统/部位、来源署名、隔离/隐藏/聚焦（KICKOFF 第 6 节）。 */
export function InfoCard() {
  const lang = useUiStore((s) => s.lang);
  const t = STRINGS[lang];
  const manifest = useUiStore((s) => s.manifest);
  const selected = useUiStore((s) => s.selected);
  const isolated = useUiStore((s) => s.isolated);
  const select = useUiStore((s) => s.select);
  const isolate = useUiStore((s) => s.isolate);
  const hide = useUiStore((s) => s.hide);
  const focus = useUiStore((s) => s.focus);

  if (!selected || !manifest) return null;
  const info = manifest.structures[selected];
  if (!info) return null;
  const system = info.system as SystemId;
  const isIsolated = isolated === selected;

  return (
    <div className="hyi-panel hyi-info" data-testid="info-card">
      <h2>{lang === 'zh' ? info.zh : info.en}</h2>
      <p className="en">
        {lang === 'zh' ? info.en : info.zh}
        {info.fma.length > 0 && <span> · {info.fma[0]}</span>}
      </p>
      <p className="blurb">
        {(lang === 'zh' ? definitionsZh[selected] : undefined) ?? t.infoBlurbPending}
      </p>
      <p className="meta">
        {t.systems[system]} · {t.regions[info.region]} · {t.sourceLabel}: {t.sourceBp3d}
      </p>
      <div className="actions">
        <button className="hyi-btn" onClick={() => isolate(isIsolated ? null : selected)}>
          {isIsolated ? t.actionUnisolate : t.actionIsolate}
        </button>
        <button className="hyi-btn" onClick={() => hide(selected)}>
          {t.actionHide}
        </button>
        <button className="hyi-btn" onClick={() => focus(selected)}>
          {t.actionFocus}
        </button>
        <button className="hyi-btn" onClick={() => select(null)}>
          {t.close}
        </button>
      </div>
    </div>
  );
}
