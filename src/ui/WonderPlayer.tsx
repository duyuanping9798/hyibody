import { STRINGS } from './i18n';
import { useState } from 'react';
import { WONDERS } from '../wonders';
import { useUiStore } from './store';

/** 奥秘入口按钮 + 下拉列表（暖色强调，KICKOFF 第 6 节视觉基调）。 */
export function WonderMenu() {
  const lang = useUiStore((s) => s.lang);
  const t = STRINGS[lang];
  const startWonder = useUiStore((s) => s.startWonder);
  const wonder = useUiStore((s) => s.wonder);
  const [open, setOpen] = useState(false);

  if (wonder) return null;
  return (
    <div className="hyi-wonder-menu">
      <button className="hyi-btn hyi-btn-warm" onClick={() => setOpen(!open)}>
        {t.wondersTitle}
      </button>
      {open && (
        <div className="hyi-panel hyi-wonder-list" data-testid="wonder-list">
          {WONDERS.map((item) => (
            <button
              key={item.id}
              onClick={() => {
                setOpen(false);
                startWonder(item);
              }}
            >
              {item.title[lang]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** 奥秘播放器：文案卡 + 播放控制（替代分层滑块出现在底部）。 */
export function WonderPlayer() {
  const lang = useUiStore((s) => s.lang);
  const t = STRINGS[lang];
  const wonder = useUiStore((s) => s.wonder);
  const index = useUiStore((s) => s.wonderIndex);
  const playing = useUiStore((s) => s.wonderPlaying);
  const exitWonder = useUiStore((s) => s.exitWonder);
  const wonderNext = useUiStore((s) => s.wonderNext);
  const wonderPrev = useUiStore((s) => s.wonderPrev);
  const wonderToggle = useUiStore((s) => s.wonderToggle);

  if (!wonder) return null;
  const step = wonder.steps[index];
  return (
    <div className="hyi-panel hyi-wonder" data-testid="wonder-player">
      <header>
        <strong>{wonder.title[lang]}</strong>
        <span className="progress">
          {index + 1} / {wonder.steps.length}
        </span>
      </header>
      <p>{step?.text[lang]}</p>
      <div className="controls">
        <button className="hyi-btn" onClick={wonderPrev} disabled={index === 0}>
          {t.wonderPrev}
        </button>
        <button className="hyi-btn hyi-btn-warm" onClick={wonderToggle}>
          {playing ? t.wonderPause : t.wonderPlay}
        </button>
        <button className="hyi-btn" onClick={wonderNext}>
          {index + 1 >= wonder.steps.length ? t.wonderFinish : t.wonderNext}
        </button>
        <button className="hyi-btn" onClick={exitWonder}>
          {t.wonderExit}
        </button>
      </div>
    </div>
  );
}
