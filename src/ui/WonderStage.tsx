import { useEffect, useMemo, useRef, useState } from 'react';
import { STRINGS } from './i18n';
import { useUiStore } from './store';
import type { Wonder } from '../wonders/engine';
import { splitClauses } from '../wonders/caption';

/** 片头卡停留时长。比一步的最短时长（3 s）短，免得盖住第一句话。 */
const TITLE_MS = 2600;
/** 片尾卡自动消失的时间。够读完两行字，又不至于把人锁在那儿。 */
const OUTRO_MS = 6000;

/** 片头卡：大标题 + 一句副标题 + 作者署名。 */
function TitleCard({ wonder, lang }: { wonder: Wonder; lang: 'zh' | 'en' }) {
  const t = STRINGS[lang];
  return (
    <div className="hyi-cinema-title" data-testid="wonder-title-card">
      <span className="kicker">{t.wondersTitle}</span>
      <h2>{wonder.title[lang]}</h2>
      {wonder.subtitle && <p>{wonder.subtitle[lang]}</p>}
      {wonder.author && <span className="by">{`${t.wonderBy} ${wonder.author}`}</span>}
    </div>
  );
}

/**
 * 奥秘的"放映层"：黑边、片头卡、字幕、章节进度、片尾卡。
 *
 * 和 `WonderPlayer`（控制条）分开是有意的：控制条是**操作**，放映层是**内容**。
 * 录像时要把放映层录进去、把控制条挡在外面，两者混在一个组件里就分不开了。
 */
export function WonderStage() {
  const lang = useUiStore((s) => s.lang);
  const t = STRINGS[lang];
  const wonder = useUiStore((s) => s.wonder);
  const index = useUiStore((s) => s.wonderIndex);
  const playing = useUiStore((s) => s.wonderPlaying);
  const outro = useUiStore((s) => s.wonderOutro);
  const dismissOutro = useUiStore((s) => s.dismissOutro);
  const startWonder = useUiStore((s) => s.startWonder);

  const [titleFor, setTitleFor] = useState<string | null>(null);
  const lastId = useRef<string | null>(null);

  // 片头卡：每换一则奥秘弹一次，不是每一步弹一次
  useEffect(() => {
    if (!wonder) {
      lastId.current = null;
      setTitleFor(null);
      return;
    }
    if (lastId.current === wonder.id) return;
    lastId.current = wonder.id;
    setTitleFor(wonder.id);
    const timer = setTimeout(() => setTitleFor(null), TITLE_MS);
    return () => clearTimeout(timer);
  }, [wonder]);

  useEffect(() => {
    if (!outro) return;
    const timer = setTimeout(() => dismissOutro(), OUTRO_MS);
    return () => clearTimeout(timer);
  }, [outro, dismissOutro]);

  const step = wonder?.steps[index];
  const clauses = useMemo(() => (step ? splitClauses(step.text[lang]) : []), [step, lang]);

  if (!wonder && !outro) return null;

  return (
    <div className="hyi-cinema" data-testid="wonder-stage" data-playing={wonder ? '1' : '0'}>
      <div className="bar top" />
      <div className="bar bottom" />

      {wonder && titleFor === wonder.id && <TitleCard wonder={wonder} lang={lang} />}

      {wonder && step && (
        <div className="hyi-cinema-caption" data-testid="wonder-caption">
          <div className="chapters" aria-hidden="true">
            {wonder.steps.map((s, i) => (
              <span key={i} className={i < index ? 'done' : i === index ? 'now' : ''}>
                {i === index && (
                  <i
                    style={{ animationDuration: `${s.durationMs}ms` }}
                    className={playing ? 'run' : 'hold'}
                  />
                )}
              </span>
            ))}
          </div>
          {/* key 换了才会重放动画——同一段 DOM 改文字，CSS 动画是不会重来的 */}
          <p key={`${wonder.id}-${index}`}>
            {clauses.map((c, i) => (
              <span key={i} style={{ animationDelay: `${i * 0.19}s` }}>
                {c}
              </span>
            ))}
          </p>
        </div>
      )}

      {outro && (
        <div className="hyi-cinema-outro" data-testid="wonder-outro">
          <span className="kicker">{t.wonderOutroKicker}</span>
          <h2>{outro.title[lang]}</h2>
          <p>{t.wonderOutroNote}</p>
          <div className="acts">
            <button className="hyi-btn hyi-btn-warm" onClick={() => startWonder(outro)}>
              {t.wonderOutroAgain}
            </button>
            <button className="hyi-btn" onClick={dismissOutro}>
              {t.wonderOutroClose}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
