import { STRINGS } from './i18n';
import { useUiStore } from './store';

/**
 * 顶栏的两个入口：奥秘、局部细剖。都打开整页画廊（Gallery.tsx）。
 *
 * 这里原来是一个按系统分组的纯文字下拉。29 则奥秘挤在下拉里既看不出讲的是什么，
 * 也不像一个"可以逛"的内容库；人类要的是缩略图卡片墙。下拉那套连同它的
 * groupBySystem 一起删了——留着两条入口路径只会让人不知道该改哪一条。
 */
export function WonderMenu() {
  const lang = useUiStore((s) => s.lang);
  const t = STRINGS[lang];
  const openGallery = useUiStore((s) => s.openGallery);
  const wonder = useUiStore((s) => s.wonder);

  if (wonder) return null;
  return (
    <div className="hyi-wonder-menu">
      <button className="hyi-btn hyi-btn-warm" onClick={() => openGallery('wonders')}>
        {t.wondersTitle}
      </button>
      <button className="hyi-btn" onClick={() => openGallery('atlas')}>
        {t.atlasOpen}
      </button>
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
  const canNarrate = useUiStore((s) => s.canNarrate);
  const narrating = useUiStore((s) => s.narrating);
  const toggleNarration = useUiStore((s) => s.toggleNarration);

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
        {canNarrate && (
          <button
            className={narrating ? 'hyi-btn hyi-btn-warm' : 'hyi-btn'}
            data-testid="wonder-narrate"
            aria-pressed={narrating}
            onClick={toggleNarration}
          >
            {narrating ? t.wonderNarrateOff : t.wonderNarrate}
          </button>
        )}
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
