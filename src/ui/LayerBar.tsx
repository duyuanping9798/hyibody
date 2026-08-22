import { STRINGS } from './i18n';
import { useState } from 'react';
import { SYSTEM_IDS, type SystemId } from '../data/types';
import { SYSTEM_COLORS } from '../viewer/materials';
import { effectiveSystemOpacity, useUiStore } from './store';

function hex(system: SystemId): string {
  return `#${SYSTEM_COLORS[system].toString(16).padStart(6, '0')}`;
}

/**
 * 一格 = 一个系统：名字 + 底下 3px 的刻度线（宽度 = 当前透明度）。
 * 刻度线是纯视觉（aria-hidden）——精确数值由弹出的滑杆行承担。
 */
function Chip({ system, active, onTap }: { system: SystemId; active: boolean; onTap(): void }) {
  const t = STRINGS[useUiStore((s) => s.lang)];
  const pct = Math.round(useUiStore((s) => effectiveSystemOpacity(s, system)) * 100);
  const muted = useUiStore((s) => !s.systemsVisible[system]);
  const loaded = useUiStore((s) => s.loadedSystems.includes(system));
  return (
    <button
      type="button"
      className={`hyi-chip${active ? ' active' : ''}${muted ? ' muted' : ''}${loaded ? '' : ' loading'}`}
      data-system={system}
      style={{ ['--hyi-chip-color' as string]: hex(system) }}
      title={t.layerJump.replace('{system}', t.systems[system])}
      aria-label={t.layerJump.replace('{system}', t.systems[system])}
      onClick={onTap}
    >
      <span className="hyi-chip-name">{t.systems[system]}</span>
      <span className="hyi-chip-gauge" aria-hidden>
        <i style={{ width: `${pct}%` }} />
      </span>
    </button>
  );
}

/** 弹出的调节行：色点 + 横向滑杆（大行程，这是精确调节的主体）+ 数值 + 收起。 */
function MixSlider({ system, onClose }: { system: SystemId; onClose(): void }) {
  const t = STRINGS[useUiStore((s) => s.lang)];
  const value = Math.round(useUiStore((s) => effectiveSystemOpacity(s, system)) * 100);
  const setMix = useUiStore((s) => s.setMix);
  return (
    <div className="hyi-mixrow" data-testid="mix-slider">
      <span className="hyi-mix-dot" style={{ background: hex(system) }} aria-hidden />
      <input
        className="hyi-range"
        type="range"
        min={0}
        max={100}
        step={1}
        value={value}
        aria-label={t.opacityOf.replace('{system}', t.systems[system])}
        onChange={(e) => setMix(system, Number(e.target.value) / 100)}
      />
      <span className="hyi-mix-pct">{value}%</span>
      <button type="button" className="hyi-mix-close" aria-label={t.close} onClick={onClose}>
        ✕
      </button>
    </div>
  );
}

/**
 * 底部控制条二稿（2026-08-22 当天返工）：紧凑单行 + 弹出横向滑杆。
 *
 * 一稿是六根竖推子的"调音台"——人类实测两条否定：百分比难调（拖动行程只有
 * 64px）、占屏太大（104px 高）。二稿把两件事分开：**看**用每格底下的刻度线
 * （一行 44px 全交代），**调**用弹出的横向滑杆（行程 300px+，一次只调一层——
 * 本来也没人同时拖两根推子）。
 *
 * 点按规则（Chip.onTap 的三个分支）：
 * 1. 点当前激活的那格 → 跳回这层的标准视图（扫描曲线；等于"重置回只看这层"）；
 * 2. 浏览态（扫描模式）点任意格 → 跳那层 + 滑杆指向它（老"点名字跳层"不变）；
 * 3. 混合态点别的格 → **只切换滑杆的调节对象**，已调好的层不许被冲掉——
 *    否则"器官满 + 骨骼 40%"这类组合永远摆不出来。
 */
export function LayerBar() {
  const [active, setActive] = useState<SystemId | null>(null);
  const mixMode = useUiStore((s) => s.mixMode);
  const jumpToSystem = useUiStore((s) => s.jumpToSystem);

  const tap = (system: SystemId) => {
    if (active === system) {
      jumpToSystem(system);
      return;
    }
    setActive(system);
    if (!mixMode) jumpToSystem(system);
  };

  return (
    <div className="hyi-panel hyi-layerbar" data-testid="layer-bar">
      {active && <MixSlider system={active} onClose={() => setActive(null)} />}
      <div className="hyi-chiprow">
        {SYSTEM_IDS.map((system) => (
          <Chip key={system} system={system} active={active === system} onTap={() => tap(system)} />
        ))}
      </div>
    </div>
  );
}
