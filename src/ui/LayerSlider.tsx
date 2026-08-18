import { STRINGS } from './i18n';
import type { SystemId } from '../data/types';
import { SYSTEM_COLORS } from '../viewer/materials';
import { useUiStore } from './store';

/** 滑块刻度：位置对应 layers.ts 里各系统的"主场"，颜色对应系统色。 */
const STOPS: { at: number; system: SystemId }[] = [
  { at: 0, system: 'skin' },
  { at: 0.2, system: 'muscles' },
  { at: 0.45, system: 'skeleton' },
  { at: 0.62, system: 'organs' },
  { at: 0.85, system: 'vessels' },
];

function hex(system: SystemId): string {
  return `#${SYSTEM_COLORS[system].toString(16).padStart(6, '0')}`;
}

/** 轨道底色：按刻度把六个系统色连成一条渐变，滑到哪一段就知道在看哪一层。 */
const TRACK = `linear-gradient(90deg, ${STOPS.map((s) => `${hex(s.system)} ${Math.round(s.at * 100)}%`).join(', ')}, ${hex('nerves')} 100%)`;

/** 分层滑块：0–1 连续值，各系统按 layers.ts 的映射淡入淡出（KICKOFF 第 6 节核心交互）。 */
export function LayerSlider() {
  const t = STRINGS[useUiStore((s) => s.lang)];
  const layer = useUiStore((s) => s.layer);
  const setLayer = useUiStore((s) => s.setLayer);
  return (
    <div className="hyi-panel hyi-layer-slider">
      <div className="hyi-layer-track" style={{ ['--hyi-layer-track' as string]: TRACK }}>
        <input
          className="hyi-range hyi-range-layer"
          type="range"
          min={0}
          max={1}
          step={0.001}
          value={layer}
          aria-label={t.layerSlider}
          onChange={(e) => setLayer(Number(e.target.value))}
        />
      </div>
      <div className="hyi-layer-labels">
        {STOPS.map((stop) => (
          <button
            key={stop.system}
            type="button"
            className={`hyi-layer-stop${Math.abs(layer - stop.at) < 0.06 ? ' active' : ''}`}
            style={{ ['--hyi-stop-color' as string]: hex(stop.system) }}
            onClick={() => setLayer(stop.at)}
          >
            {stop.system === 'vessels'
              ? `${t.systems.vessels}/${t.systems.nerves}`
              : t.systems[stop.system]}
          </button>
        ))}
      </div>
    </div>
  );
}
