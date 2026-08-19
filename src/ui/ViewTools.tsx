import { STRINGS } from './i18n';
import type { ViewPresetId } from '../viewer/camera';
import type { ClipAxis } from '../viewer/clipping';
import { useUiStore } from './store';

const PRESET_IDS: ViewPresetId[] = ['front', 'back', 'left', 'right', 'top', 'hero'];
const CLIP_AXES: ClipAxis[] = ['x', 'y', 'z'];

/** 预设视角（KICKOFF 第 6 节：6 个预设视角）。 */
export function ViewTools() {
  const t = STRINGS[useUiStore((s) => s.lang)];
  const applyPreset = useUiStore((s) => s.applyPreset);

  return (
    <div className="hyi-preset-grid">
      {PRESET_IDS.map((id) => (
        <button key={id} className="hyi-btn" onClick={() => applyPreset(id)}>
          {t.presets[id]}
        </button>
      ))}
    </div>
  );
}

/** 单剖切面控制（KICKOFF 第 6 节）。 */
export function ClipTools() {
  const t = STRINGS[useUiStore((s) => s.lang)];
  const clip = useUiStore((s) => s.clip);
  const setClip = useUiStore((s) => s.setClip);
  const selected = useUiStore((s) => s.selected);
  const clipThroughSelected = useUiStore((s) => s.clipThroughSelected);

  return (
    <>
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
    </>
  );
}
