import { STRINGS } from './i18n';
import { useUiStore } from './store';

/** 分层滑块：0–1 连续值，各系统按 layers.ts 的映射淡入淡出（KICKOFF 第 6 节核心交互）。 */
export function LayerSlider() {
  const t = STRINGS[useUiStore((s) => s.lang)];
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
        aria-label={t.layerSlider}
        onChange={(e) => setLayer(Number(e.target.value))}
      />
      <div className="hyi-layer-labels">
        <span>{t.systems.skin}</span>
        <span>{t.systems.muscles}</span>
        <span>{t.systems.skeleton}</span>
        <span>{t.systems.organs}</span>
        <span>
          {t.systems.vessels}/{t.systems.nerves}
        </span>
      </div>
    </div>
  );
}
