import { STRINGS } from './i18n';
import { useState } from 'react';
import { WONDERS } from '../wonders';
import { estimatedSeconds } from '../wonders/engine';
import { SYSTEM_IDS, type SystemId } from '../data/types';
import { useUiStore } from './store';

/** 按系统分组：上百条时平铺列表不可用，分组顺序跟分层滑块一致（由外到内）。 */
function groupBySystem() {
  const groups = new Map<SystemId, typeof WONDERS>();
  for (const id of SYSTEM_IDS) {
    const list = WONDERS.filter((w) => w.system === id);
    if (list.length) groups.set(id, list);
  }
  const rest = WONDERS.filter((w) => !w.system || !SYSTEM_IDS.includes(w.system));
  return { groups, rest };
}

/** 奥秘入口按钮 + 下拉列表（暖色强调，KICKOFF 第 6 节视觉基调）。 */
export function WonderMenu() {
  const lang = useUiStore((s) => s.lang);
  const t = STRINGS[lang];
  const startWonder = useUiStore((s) => s.startWonder);
  const wonder = useUiStore((s) => s.wonder);
  const [open, setOpen] = useState(false);
  const { groups, rest } = groupBySystem();

  if (wonder) return null;
  return (
    <div className="hyi-wonder-menu">
      <button className="hyi-btn hyi-btn-warm" onClick={() => setOpen(!open)}>
        {t.wondersTitle}
      </button>
      {open && (
        <div className="hyi-panel hyi-wonder-list" data-testid="wonder-list">
          {[...groups.entries()].map(([system, list]) => (
            <section key={system}>
              <h4>{t.systems[system]}</h4>
              {list.map((item) => (
                <button
                  key={item.id}
                  onClick={() => {
                    setOpen(false);
                    startWonder(item);
                  }}
                >
                  <span>{item.title[lang]}</span>
                  <span className="dur">{estimatedSeconds(item)}s</span>
                </button>
              ))}
            </section>
          ))}
          {rest.map((item) => (
            <button
              key={item.id}
              onClick={() => {
                setOpen(false);
                startWonder(item);
              }}
            >
              <span>{item.title[lang]}</span>
              <span className="dur">{estimatedSeconds(item)}s</span>
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
  const canRecordVideo = useUiStore((s) => s.canRecordVideo);
  const recording = useUiStore((s) => s.recording);
  const recordElapsedMs = useUiStore((s) => s.recordElapsedMs);
  const startRecording = useUiStore((s) => s.startRecording);
  const stopRecording = useUiStore((s) => s.stopRecording);

  if (!wonder) return null;
  return (
    <div className="hyi-panel hyi-wonder" data-testid="wonder-player">
      <header>
        <strong>{wonder.title[lang]}</strong>
        {recording && (
          <span className="rec" data-testid="wonder-recording">
            <i />
            {`${t.wonderRecording} ${Math.floor(recordElapsedMs / 1000)}s`}
          </span>
        )}
        <span className="progress">
          {index + 1} / {wonder.steps.length}
        </span>
      </header>
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
        {/* 录不了就不摆按钮：Safari 17 之前没有 MediaRecorder 的 mp4 支持，
            摆一个点了没反应的按钮比没有按钮更糟 */}
        {canRecordVideo && (
          <button
            className={recording ? 'hyi-btn hyi-btn-rec' : 'hyi-btn'}
            data-testid="wonder-record"
            onClick={recording ? stopRecording : startRecording}
          >
            {recording ? t.wonderRecordStop : t.wonderRecord}
          </button>
        )}
      </div>
    </div>
  );
}
