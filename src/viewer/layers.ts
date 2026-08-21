import type { SystemId } from '../data/types';

/**
 * 分层滑块 → 各系统不透明度（KICKOFF 第 6 节："各系统按顺序在区间内淡入淡出"）。
 *
 * 每个系统给一串控制点 [滑块值, 不透明度]，之间线性插值，两端取首/末值。
 * 关键点是**淡入**：轮到某系统之前它只是淡淡的底噪（0.12–0.3），轮到时才升到 1。
 * 之前六个系统在 layer=0 时全是 1，六层实体叠在一起，画面糊成一团白（2026-08-18 修）。
 * 淡出区间仍按 KICKOFF：皮肤 0–0.2、肌肉 0.2–0.45、骨骼 0.45–0.7 淡到 0.35、
 * 器官 0.45–0.8、血管/神经 0.7–1 保留。
 */
const CURVES: Record<SystemId, ReadonlyArray<readonly [number, number]>> = {
  skin: [
    [0.0, 1],
    [0.14, 0],
  ],
  muscles: [
    [0.0, 0],
    [0.05, 0.12],
    [0.2, 1],
    [0.36, 0.2],
    [0.45, 0],
  ],
  skeleton: [
    [0.0, 0],
    [0.05, 0.08],
    [0.2, 0.22],
    [0.45, 1],
    [0.55, 0.45],
    [0.62, 0.12],
    // **必须回到 0**：原来这条曲线最后一点是 [0.58, 0.35]，而插值函数对超过
    // 最后一点的值直接返回最后一点——于是骨骼从 0.58 起永远停在 0.35，
    // 拉到器官、血管都被肋骨挡着。人类实测反馈："控制条拉到器官的时候骨骼
    // 还是没有消失挡住了器官。"
    [0.75, 0],
  ],
  organs: [
    [0.0, 0],
    [0.05, 0.06],
    [0.2, 0.18],
    [0.45, 0.4],
    [0.62, 1],
    [0.75, 0.4],
    [0.9, 0],
  ],
  vessels: [
    [0.0, 0],
    [0.05, 0.05],
    [0.2, 0.1],
    [0.45, 0.18],
    [0.62, 0.35],
    [0.85, 1],
  ],
  nerves: [
    [0.0, 0],
    [0.05, 0.05],
    [0.2, 0.1],
    [0.45, 0.18],
    [0.62, 0.35],
    [0.85, 1],
  ],
};

/** 拾取只对不透明度 > 0.15 的结构生效（KICKOFF 第 6 节）。 */
export const PICKABLE_OPACITY_THRESHOLD = 0.15;

export function computeSystemOpacity(system: SystemId, layer: number): number {
  const t = Math.min(1, Math.max(0, layer));
  const points = CURVES[system];
  if (t <= points[0]![0]) return points[0]![1];
  for (let i = 1; i < points.length; i += 1) {
    const [x1, y1] = points[i]!;
    if (t <= x1) {
      const [x0, y0] = points[i - 1]!;
      const k = x1 === x0 ? 1 : (t - x0) / (x1 - x0);
      return y0 + (y1 - y0) * k;
    }
  }
  return points[points.length - 1]![1];
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
