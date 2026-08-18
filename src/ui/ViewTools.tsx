import { STRINGS } from './i18n';
import type { ViewPresetId } from '../viewer/camera';
import type { ClipAxis } from '../viewer/clipping';
import { useUiStore } from './store';

const PRESET_IDS: ViewPresetId[] = ['front', 'back', 'left', 'right', 'top', 'hero'];
const CLIP_AXES: ClipAxis[] = ['x', 'y', 'z'];

/** 预设视角 + 剖切控制 + 恢复（KICKOFF 第 6 节：6 个预设视角、单剖切面）。 */
export function ViewTools() {
  const t = STRINGS[useUiStore((s) => s.lang)];
  const clip = useUiStore((s) => s.clip);
  const hiddenCount = useUiStore((s) => s.hiddenCount);
  const isolated = useUiStore((s) => s.isolated);
  const applyPreset = useUiStore((s) => s.applyPreset);
  const setClip = useUiStore((s) => s.setClip);
  const selected = useUiStore((s) => s.selected);
  const clipThroughSelected = useUiStore((s) => s.clipThroughSelected);
  const resetVisibility = useUiStore((s) => s.resetVisibility);
  const quality = useUiStore((s) => s.quality);
  const qualityToggleable = useUiStore((s) => s.qualityToggleable);
  const setQuality = useUiStore((s) => s.setQuality);
  const expanded = useUiStore((s) => s.expanded);
  const expand = useUiStore((s) => s.expand);

  return (
    <>
      <section>
        <h3>{t.presetsTitle}</h3>
        <div className="hyi-preset-grid">
          {PRESET_IDS.map((id) => (
            <button key={id} className="hyi-btn" onClick={() => applyPreset(id)}>
              {t.presets[id]}
            </button>
          ))}
        </div>
      </section>
      <section>
        <h3>{t.clipTitle}</h3>
        <div className="hyi-clip-row">
          <button
            className={`hyi-btn${clip === null ? ' active' : ''}`}
            onClick={() => setClip(null)}
          >
            {t.clipOff}
          </button>
          {CLIP_AXES.map((axis) => (
            <button
              key={axis}
              className={`hyi-btn${clip?.axis === axis ? ' active' : ''}`}
              onClick={() => setClip({ axis, pos: clip?.axis === axis ? clip.pos : 0 })}
            >
              {t.clipAxis[axis]}
            </button>
          ))}
        </div>
        {clip && (
          <button
            className={`hyi-btn hyi-clip-flip${clip.flip ? ' active' : ''}`}
            onClick={() => setClip({ ...clip, flip: !clip.flip })}
          >
            {t.clipFlip}
          </button>
        )}
        {selected && (
          <button className="hyi-btn hyi-clip-through" onClick={clipThroughSelected}>
            {t.clipThroughSelected}
          </button>
        )}
        {clip && (
          <input
            className="hyi-range"
            type="range"
            min={-1}
            max={1}
            step={0.01}
            value={clip.pos}
            aria-label={t.clipTitle}
            onChange={(e) => setClip({ axis: clip.axis, pos: Number(e.target.value) })}
          />
        )}
      </section>
      <section>
        <h3>{t.qualityTitle}</h3>
        {qualityToggleable ? (
          <label className="hyi-switch">
            <input
              type="checkbox"
              checked={quality === 'high'}
              onChange={(e) => setQuality(e.target.checked ? 'high' : 'medium')}
            />
            <span>{t.qualityHigh}</span>
          </label>
        ) : (
          <p className="hyi-hint">{t.qualityUnavailable}</p>
        )}
        {qualityToggleable && <p className="hyi-hint">{t.qualityHint}</p>}
      </section>
      {expanded && (
        <section>
          <button className="hyi-btn" onClick={() => expand(null)}>
            {t.collapseParts}
          </button>
        </section>
      )}
      {(hiddenCount > 0 || isolated) && (
        <section>
          <button className="hyi-btn" onClick={resetVisibility}>
            {t.actionRestore}
            {hiddenCount > 0 ? `（${t.hiddenCount.replace('{n}', String(hiddenCount))}）` : ''}
          </button>
        </section>
      )}
    </>
  );
}
