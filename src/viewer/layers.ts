import type { SystemId } from '../data/types';

/**
 * 分层滑块 → 各系统不透明度（KICKOFF 第 6 节）：
 * 皮肤 0–0.2 淡出；肌肉 0.2–0.45 淡出；骨骼始终可见但 0.45–0.7 淡化到 0.35；
 * 器官 0.45–0.8 淡出；血管/神经 0.7–1 期间始终保留。
 * 每项为 [start, end, from, to]：滑块经过 start→end 区间时不透明度从 from 线性过渡到 to。
 */
const FADES: Record<SystemId, [number, number, number, number]> = {
  skin: [0.0, 0.2, 1, 0],
  muscles: [0.2, 0.45, 1, 0],
  skeleton: [0.45, 0.7, 1, 0.35],
  organs: [0.45, 0.8, 1, 0],
  vessels: [0.7, 1.0, 1, 1],
  nerves: [0.7, 1.0, 1, 1],
};

/** 拾取只对不透明度 > 0.15 的结构生效（KICKOFF 第 6 节）。 */
export const PICKABLE_OPACITY_THRESHOLD = 0.15;

export function computeSystemOpacity(system: SystemId, layer: number): number {
  const t = Math.min(1, Math.max(0, layer));
  const [start, end, from, to] = FADES[system];
  if (t <= start) return from;
  if (t >= end) return to;
  const k = (t - start) / (end - start);
  return from + (to - from) * k;
}

export function computeAllOpacities(layer: number): Record<SystemId, number> {
  return {
    skin: computeSystemOpacity('skin', layer),
    muscles: computeSystemOpacity('muscles', layer),
    skeleton: computeSystemOpacity('skeleton', layer),
    organs: computeSystemOpacity('organs', layer),
    vessels: computeSystemOpacity('vessels', layer),
    nerves: computeSystemOpacity('nerves', layer),
  };
}
