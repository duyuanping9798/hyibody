import zh from '../../content/i18n/zh.json';
import { useUiStore } from './store';

/** 分层滑块：0–1 连续值，各系统按 layers.ts 的映射淡入淡出（KICKOFF 第 6 节核心交互）。 */
export function LayerSlider() {
  const layer = useUiStore((s) => s.layer);
  const setLayer = useUiStore((s) => s.setLayer);
  return (
    <div className="hyi-panel hyi-layer-slider">
      <input
        className="hyi-range"
        type="range"
        min={0}
        max={1}
        step={0.001}
        value={layer}
        aria-label={zh.layerSlider}
        onChange={(e) => setLayer(Number(e.target.value))}
      />
      <div className="hyi-layer-labels">
        <span>{zh.systems.skin}</span>
        <span>{zh.systems.muscles}</span>
        <span>{zh.systems.skeleton}</span>
        <span>{zh.systems.organs}</span>
        <span>
          {zh.systems.vessels}/{zh.systems.nerves}
        </span>
      </div>
    </div>
  );
}
