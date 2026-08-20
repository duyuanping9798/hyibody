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


/** 分层滑块：0–1 连续值，各系统按 layers.ts 的映射淡入淡出（KICKOFF 第 6 节核心交互）。 */
export function LayerSlider() {
  const t = STRINGS[useUiStore((s) => s.lang)];
  const layer = useUiStore((s) => s.layer);
  const setLayer = useUiStore((s) => s.setLayer);
  return (
    <div className="hyi-panel hyi-layer-slider">
      {/* 轨道走"暗槽 + 发光进度"，进度位置交给 CSS 变量（见 ui.css）。
          原来这里铺的是五个系统色连成的彩虹，皮肤换成真肤色之后起点一段米黄，
          整条看着发脏，也不像仪器像玩具。系统色留在下面的圆点上。 */}
      <div
        className="hyi-layer-track"
        style={{ ['--hyi-layer-pos' as string]: `${(layer * 100).toFixed(1)}%` }}
      >
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
      {/* 刻度按**真实值**绝对定位。原来这一排是 justify-content: space-between 等距排开的，
          于是「器官」这个点画在 68%、它代表的值却是 0.62——把滑块拖到点的正上方，
          读数并不是那个点。轨道渐变一直是按真实值铺的，两者从一开始就对不上。 */}
      <div className="hyi-layer-labels">
        {STOPS.map((stop) => (
          <button
            key={stop.system}
            type="button"
            className={`hyi-layer-stop${Math.abs(layer - stop.at) < 0.05 ? ' active' : ''}`}
            style={{
              ['--hyi-stop-color' as string]: hex(stop.system),
              left: `${stop.at * 100}%`,
              // 两端的标签不能按中心对齐，否则会伸出轨道；
              // 圆点则始终画在真实刻度上，靠 --hyi-stop-dot 把这段位移补回来
              transform:
                stop.at <= 0.02
                  ? 'none'
                  : stop.at >= 0.84
                    ? 'translateX(-100%)'
                    : 'translateX(-50%)',
              ['--hyi-stop-dot' as string]:
                stop.at <= 0.02 ? '10px' : stop.at >= 0.84 ? 'calc(100% - 10px)' : '50%',
            }}
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
