import { STRINGS } from './i18n';
import { useRef, type PointerEvent as ReactPointerEvent, type KeyboardEvent } from 'react';
import { SYSTEM_IDS, type SystemId } from '../data/types';
import { SYSTEM_COLORS } from '../viewer/materials';
import { HOME_STOPS } from '../viewer/layers';
import { effectiveSystemOpacity, useUiStore } from './store';

function hex(system: SystemId): string {
  return `#${SYSTEM_COLORS[system].toString(16).padStart(6, '0')}`;
}

/** 键盘一步走 5%——0.01 一步要按一百下，纯摆设。 */
const KEY_STEP = 0.05;

/**
 * 一格 = 一个系统：竖向推子（独立透明度）+ 下面的名字按钮（跳主场）。
 *
 * 推子是自绘的 div 而不是 `<input type=range>`：竖向的原生 range 至今要靠
 * writing-mode 的浏览器私货，iOS Safari 与 Chrome 的触摸行为还不一致。
 * 自绘 + role="slider" + 方向键，无障碍语义反而更干净。
 */
function Chip({ system }: { system: SystemId }) {
  const t = STRINGS[useUiStore((s) => s.lang)];
  const value = useUiStore((s) => effectiveSystemOpacity(s, system));
  const mixMode = useUiStore((s) => s.mixMode);
  const layer = useUiStore((s) => s.layer);
  const muted = useUiStore((s) => !s.systemsVisible[system]);
  const loaded = useUiStore((s) => s.loadedSystems.includes(system));
  const setMix = useUiStore((s) => s.setMix);
  const jumpToSystem = useUiStore((s) => s.jumpToSystem);
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const fromPointer = (e: ReactPointerEvent) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.height === 0) return;
    setMix(system, Math.min(1, Math.max(0, 1 - (e.clientY - rect.top) / rect.height)));
  };
  const onKeyDown = (e: KeyboardEvent) => {
    let next: number | null = null;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') next = value + KEY_STEP;
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') next = value - KEY_STEP;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = 1;
    if (next === null) return;
    e.preventDefault();
    // 奥秘播放时全局 ← → 是翻页；推子拿到焦点时方向键归推子
    e.stopPropagation();
    setMix(system, Math.min(1, Math.max(0, next)));
  };

  const pct = Math.round(value * 100);
  // 扫描模式下"当前主要在看的那层"点亮名字，和旧滑块的刻度高亮一个意思
  const active = !mixMode && Math.abs(layer - HOME_STOPS[system]) < 0.05;
  return (
    <div
      className={`hyi-chip${muted ? ' muted' : ''}${loaded ? '' : ' loading'}`}
      data-system={system}
      style={{ ['--hyi-chip-color' as string]: hex(system) }}
    >
      <div
        ref={trackRef}
        className="hyi-chip-fader"
        role="slider"
        tabIndex={0}
        aria-orientation="vertical"
        aria-label={t.opacityOf.replace('{system}', t.systems[system])}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-valuetext={`${pct}%`}
        onKeyDown={onKeyDown}
        onPointerDown={(e) => {
          dragging.current = true;
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          fromPointer(e);
        }}
        onPointerMove={(e) => {
          if (dragging.current) fromPointer(e);
        }}
        onPointerUp={() => {
          dragging.current = false;
        }}
        onPointerCancel={() => {
          dragging.current = false;
        }}
      >
        <div className="hyi-chip-fill" style={{ height: `${pct}%` }} aria-hidden />
        <span className="hyi-chip-pct" aria-hidden>
          {pct}
        </span>
      </div>
      <button
        type="button"
        className={`hyi-chip-label${active ? ' active' : ''}`}
        title={t.layerJump.replace('{system}', t.systems[system])}
        aria-label={t.layerJump.replace('{system}', t.systems[system])}
        onClick={() => jumpToSystem(system)}
      >
        {t.systems[system]}
      </button>
    </div>
  );
}

/**
 * 底部控制条（2026-08-22，替代单条分层滑块 + 右侧系统面板）：
 * 六格调音台，一格一个系统。参考 Complete Anatomy 的分层控制再往前一步——
 * CA 是"逐层剥掉"，这里每层各有一个推子，任意混合都摆得出来；
 * 点名字仍然一步跳到那层的策展视图（复用校准过的曲线与缓动），
 * 老"拖到哪层看哪层"的心智模型没丢。
 */
export function LayerBar() {
  return (
    <div className="hyi-panel hyi-layerbar" data-testid="layer-bar">
      {SYSTEM_IDS.map((system) => (
        <Chip key={system} system={system} />
      ))}
    </div>
  );
}
