import { STRINGS } from './i18n';
import { definitionsFor, definitionsReviewedFor } from '../data/definitions';
import type { DataSource, SystemId } from '../data/types';
import { SYSTEM_COLORS } from '../viewer/materials';
import { estimatedSeconds } from '../wonders/engine';
import { wondersForStructure } from '../wonders';
import { useUiStore } from './store';

/** 数据来源署名：用哪个源的网格就署哪个源（CLAUDE.md 的许可证铁律）。 */
function sourceLabel(source: DataSource, t: (typeof STRINGS)['zh']): string {
  return source === 'hra' ? t.sourceHra : t.sourceBp3d;
}

/** 系统色点：让信息卡一眼能对上左侧系统面板的配色。 */
function systemDot(system: SystemId): string {
  return `#${SYSTEM_COLORS[system].toString(16).padStart(6, '0')}`;
}

/**
 * 信息卡：中英名 + FMA、系统/部位标签、一句话科普、"你知道吗"小知识、
 * 来源署名、隔离/隐藏/聚焦（KICKOFF 第 6 节）。
 */
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
  const expanded = useUiStore((s) => s.expanded);
  const expand = useUiStore((s) => s.expand);
  const startWonder = useUiStore((s) => s.startWonder);

  if (!selected || !manifest) return null;
  const info = manifest.structures[selected];
  if (!info) return null;
  const system = info.system as SystemId;
  const isIsolated = isolated === selected;
  // 内部件（心脏 → 心室壁/瓣膜…）：有就给一个"展开内部"，正在展开就给"收起"
  const children = Object.entries(manifest.structures).filter(([, s]) => s.parent === selected);
  const insideParent = info.parent;
  const definition = definitionsFor(lang)[selected];
  // 讲到这个结构的奥秘。内部件没有自己的内容时回退到父结构（见 wondersForStructure）
  const related = wondersForStructure(selected, insideParent);

  return (
    <div className="hyi-panel hyi-info" data-testid="info-card">
      <header className="hyi-info-head">
        <span className="hyi-info-dot" style={{ background: systemDot(system) }} aria-hidden />
        <div>
          <h2>{lang === 'zh' ? info.zh : info.en}</h2>
          <p className="en">
            {lang === 'zh' ? info.en : info.zh}
            {/* 本体 id：优先 FMA，BP3D 没有该概念时退到 HRA 给的 UBERON */}
            {(info.fma[0] ?? info.uberon) && <span> · {info.fma[0] ?? info.uberon}</span>}
          </p>
        </div>
      </header>

      <ul className="hyi-tags">
        <li>{t.systems[system]}</li>
        <li>{t.regions[info.region]}</li>
        {info.side !== 'none' && <li>{t.sides[info.side]}</li>}
      </ul>

      <p className="blurb">{definition?.blurb ?? t.infoBlurbPending}</p>

      {definition?.fact && (
        <aside className="hyi-fact">
          <span className="hyi-fact-title">{t.infoFactTitle}</span>
          <p>{definition.fact}</p>
        </aside>
      )}

      <p className="meta">
        {t.sourceLabel}: {sourceLabel(info.source, t)}
        {definition && !definitionsReviewedFor(lang) ? ` · ${t.infoUnreviewed}` : ''}
      </p>

      {related.length > 0 && (
        <section className="hyi-related">
          <h3>{t.relatedWonders.replace('{n}', String(related.length))}</h3>
          {related.map((wonder) => (
            <button
              key={wonder.id}
              className="hyi-related-item"
              onClick={() => startWonder(wonder)}
            >
              <span>{wonder.title[lang]}</span>
              <span className="dur">{estimatedSeconds(wonder)}s</span>
            </button>
          ))}
        </section>
      )}

      <div className="actions">
        {children.length > 0 && expanded !== selected && (
          <button className="hyi-btn primary" onClick={() => expand(selected)}>
            {t.expandParts.replace('{n}', String(children.length))}
          </button>
        )}
        {(expanded === selected || (insideParent && expanded === insideParent)) && (
          <button className="hyi-btn primary" onClick={() => expand(null)}>
            {t.collapseParts}
          </button>
        )}
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
