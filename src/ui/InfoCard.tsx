import { STRINGS } from './i18n';
import { definitionsFor, reviewStageFor } from '../data/definitions';
import type { DataSource, Lang, SystemId } from '../data/types';
import { SYSTEM_COLORS } from '../viewer/materials';
import { estimatedSeconds } from '../wonders/engine';
import { wondersForStructure } from '../wonders';
import { useUiStore } from './store';

/** 数据来源署名：用哪个源的网格就署哪个源（CLAUDE.md 的许可证铁律）。 */
function sourceLabel(source: DataSource, t: (typeof STRINGS)['zh']): string {
  return source === 'hra' ? t.sourceHra : t.sourceBp3d;
}

/** 系统色点：让信息卡一眼能对上左侧系统面板的配色。 */
/**
 * 文案审校到哪一步，卡片上就写哪一步。
 *
 * 不写「已审校」而写「AI 交叉审校，未经医师签字」，是因为这批文案确实过了
 * 三轮 AI 交叉审校，但没有执业医师签字——两件事都要说，缺一件都是误导。
 */
function reviewLabel(lang: Lang, t: (typeof STRINGS)['zh']): string {
  const stage = reviewStageFor(lang);
  if (stage === 'human') return t.infoHumanReviewed;
  return stage === 'ai' ? t.infoAiReviewed : t.infoUnreviewed;
}

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
  const collapseParts = useUiStore((s) => s.collapseParts);
  const startWonder = useUiStore((s) => s.startWonder);
  const infoExpanded = useUiStore((s) => s.infoExpanded);
  const setInfoExpanded = useUiStore((s) => s.setInfoExpanded);

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
    <div className={`hyi-panel hyi-info${infoExpanded ? ' expanded' : ''}`} data-testid="info-card">
      {/* 小屏上整张卡默认只露到「一句话科普」，点这一条展开全文。
          桌面端左下角空间充裕，CSS 里让这个按钮隐身、内容始终全展开。 */}
      <button
        className="hyi-info-toggle"
        aria-expanded={infoExpanded}
        onClick={() => setInfoExpanded(!infoExpanded)}
      >
        <span className="hyi-info-dot" style={{ background: systemDot(system) }} aria-hidden />
        <span className="hyi-info-name">
          <h2>{lang === 'zh' ? info.zh : info.en}</h2>
          <span className="en">
            {lang === 'zh' ? info.en : info.zh}
            {/* 本体 id：优先 FMA，BP3D 没有该概念时退到 HRA 给的 UBERON */}
            {(info.fma[0] ?? info.uberon) && <span> · {info.fma[0] ?? info.uberon}</span>}
          </span>
        </span>
        <span className="hyi-info-chevron" aria-hidden>
          ⌃
        </span>
        <span className="hyi-sr-only">{infoExpanded ? t.infoLess : t.infoMore}</span>
      </button>

      <div className="hyi-info-details">
        <ul className="hyi-tags">
          <li>{t.systems[system]}</li>
          <li>{t.regions[info.region]}</li>
          {info.side !== 'none' && <li>{t.sides[info.side]}</li>}
        </ul>
      </div>

      <p className="blurb">{definition?.blurb ?? t.infoBlurbPending}</p>
      {definition && <p className="hyi-info-disclaimer">{t.infoDisclaimer}</p>}

      <div className="hyi-info-details">
        {definition?.fact && (
          <aside className="hyi-fact">
            <span className="hyi-fact-title">{t.infoFactTitle}</span>
            <p>{definition.fact}</p>
          </aside>
        )}

        <p className="meta">
          {t.sourceLabel}: {sourceLabel(info.source, t)}
          {definition ? ` · ${reviewLabel(lang, t)}` : ''}
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
      </div>

      <div className="actions">
        {children.length > 0 && expanded !== selected && (
          <button className="hyi-btn primary" onClick={() => expand(selected)}>
            {t.expandParts.replace('{n}', String(children.length))}
          </button>
        )}
        {(expanded === selected || (insideParent && expanded === insideParent)) && (
          <button className="hyi-btn primary" onClick={collapseParts}>
            {t.collapseParts}
          </button>
        )}
        <button
          className="hyi-btn hyi-info-detail-action"
          onClick={() => isolate(isIsolated ? null : selected)}
        >
          {isIsolated ? t.actionUnisolate : t.actionIsolate}
        </button>
        <button className="hyi-btn hyi-info-detail-action" onClick={() => hide(selected)}>
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
