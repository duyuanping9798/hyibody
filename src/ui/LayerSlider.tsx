import { STRINGS } from './i18n';
import type { SystemId } from '../data/types';
import { computeAllOpacities } from '../viewer/layers';
import { SYSTEM_COLORS } from '../viewer/materials';
import { useUiStore } from './store';

/**
 * 滑块刻度：位置对应 layers.ts 里各系统的"主场"，颜色对应系统色。
 * 六个系统六个刻度——血管与神经原来挤在 0.85 一个点上，拖到那儿两层一起满档，
 * 没有任何位置能单独看神经。拆成 0.8 / 1.0 之后每一层都点得到。
 */
const STOPS: { at: number; system: SystemId }[] = [
  { at: 0, system: 'skin' },
  { at: 0.2, system: 'muscles' },
  { at: 0.45, system: 'skeleton' },
  { at: 0.62, system: 'organs' },
  { at: 0.8, system: 'vessels' },
  { at: 1, system: 'nerves' },
];

function hex(system: SystemId): string {
  return `#${SYSTEM_COLORS[system].toString(16).padStart(6, '0')}`;
}

/**
 * 轨道底色：按刻度把六个系统色连成一条渐变，滑到哪一段就知道在看哪一层。
 *
 * 这是 020c6c1 之前的设计。那次换成"暗槽 + 青紫发光进度"的理由是
 * 皮肤刚换成真肤色、渐变起点一段米黄看着发脏；皮肤已经退回 X-ray 青壳
 * （SYSTEM_COLORS.skin = 0x4fc3d9），那个理由不成立了。人类：
 * "控制条回到更改前的设计"。青 → 肌红 → 骨白 → 器官橙 → 血管红 → 神经黄。
 */
const TRACK = `linear-gradient(90deg, ${STOPS.map(
  (s) => `${hex(s.system)} ${Math.round(s.at * 100)}%`,
).join(', ')})`;

/**
 * 当前这一档主要在看哪一层——直接问 layers.ts 的曲线要最实的那个，
 * 而不是"离哪个刻度近"。读屏软件报的就是这个（aria-valuetext），
 * 所以它必须和画面里真正看到的一致。
 */
function leadSystem(layer: number): SystemId {
  const o = computeAllOpacities(layer);
  return (Object.keys(o) as SystemId[]).reduce((best, s) => (o[s] > o[best] ? s : best));
}

/** 键盘细调：方向键 1%，按住 Shift 直接跳到上/下一个主场。 */
function stepFor(layer: number, dir: -1 | 1, coarse: boolean): number {
  if (!coarse) return Math.min(1, Math.max(0, layer + dir * 0.01));
  const ats = STOPS.map((s) => s.at);
  const next =
    dir === 1
      ? ats.find((a) => a > layer + 1e-6)
      : [...ats].reverse().find((a) => a < layer - 1e-6);
  return next ?? (dir === 1 ? 1 : 0);
}

/** 分层滑块：0–1 连续值，各系统按 layers.ts 的映射淡入淡出（KICKOFF 第 6 节核心交互）。 */
export function LayerSlider() {
  const t = STRINGS[useUiStore((s) => s.lang)];
  const layer = useUiStore((s) => s.layer);
  const setLayer = useUiStore((s) => s.setLayer);
  return (
    <div className="hyi-panel hyi-layer-slider">
      <div
        className="hyi-layer-track"
        style={{
          ['--hyi-layer-track' as string]: TRACK,
          ['--hyi-layer-pos' as string]: `${(layer * 100).toFixed(1)}%`,
        }}
      >
        <input
          className="hyi-range hyi-range-layer"
          type="range"
          min={0}
          max={1}
          step={0.001}
          value={layer}
          aria-label={t.layerSlider}
          aria-valuetext={`${t.systems[leadSystem(layer)]} ${Math.round(layer * 100)}%`}
          onChange={(e) => setLayer(Number(e.target.value))}
          // step=0.001 是为了拖动顺滑，但方向键一次只走 0.1%——按 200 下才跨一层，
          // 等于键盘用不了。接管方向键：1% 一档，Shift 直接跳主场。
          onKeyDown={(e) => {
            const dir =
              e.key === 'ArrowRight' || e.key === 'ArrowUp'
                ? 1
                : e.key === 'ArrowLeft' || e.key === 'ArrowDown'
                  ? -1
                  : 0;
            if (dir === 0) return;
            e.preventDefault();
            // 奥秘播放时全局的 ← → 是"上一步/下一步"。滑块拿到焦点的时候
            // 方向键该属于滑块，别让它同时翻页。
            e.stopPropagation();
            setLayer(stepFor(layer, dir, e.shiftKey));
          }}
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
            {t.systems[stop.system]}
          </button>
        ))}
      </div>
    </div>
  );
}
