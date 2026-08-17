import { useState } from 'react';
import zh from '../../content/i18n/zh.json';
import { TOURS } from '../tours';
import { useUiStore } from './store';

/** 故事线入口按钮 + 下拉列表（暖色强调，KICKOFF 第 6 节视觉基调）。 */
export function TourMenu() {
  const startTour = useUiStore((s) => s.startTour);
  const tour = useUiStore((s) => s.tour);
  const [open, setOpen] = useState(false);

  if (tour) return null;
  return (
    <div className="hyi-tour-menu">
      <button className="hyi-btn hyi-btn-warm" onClick={() => setOpen(!open)}>
        {zh.toursTitle}
      </button>
      {open && (
        <div className="hyi-panel hyi-tour-list" data-testid="tour-list">
          {TOURS.map((t) => (
            <button
              key={t.id}
              onClick={() => {
                setOpen(false);
                startTour(t);
              }}
            >
              {t.title.zh}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** 故事线播放器：文案卡 + 播放控制（替代分层滑块出现在底部）。 */
export function TourPlayer() {
  const tour = useUiStore((s) => s.tour);
  const index = useUiStore((s) => s.tourIndex);
  const playing = useUiStore((s) => s.tourPlaying);
  const exitTour = useUiStore((s) => s.exitTour);
  const tourNext = useUiStore((s) => s.tourNext);
  const tourPrev = useUiStore((s) => s.tourPrev);
  const tourToggle = useUiStore((s) => s.tourToggle);

  if (!tour) return null;
  const step = tour.steps[index];
  return (
    <div className="hyi-panel hyi-tour" data-testid="tour-player">
      <header>
        <strong>{tour.title.zh}</strong>
        <span className="progress">
          {index + 1} / {tour.steps.length}
        </span>
      </header>
      <p>{step?.text.zh}</p>
      <div className="controls">
        <button className="hyi-btn" onClick={tourPrev} disabled={index === 0}>
          {zh.tourPrev}
        </button>
        <button className="hyi-btn hyi-btn-warm" onClick={tourToggle}>
          {playing ? zh.tourPause : zh.tourPlay}
        </button>
        <button className="hyi-btn" onClick={tourNext}>
          {index + 1 >= tour.steps.length ? zh.tourFinish : zh.tourNext}
        </button>
        <button className="hyi-btn" onClick={exitTour}>
          {zh.tourExit}
        </button>
      </div>
    </div>
  );
}
