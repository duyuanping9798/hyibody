import type { SystemId } from '../data/types';

/**
 * 分层滑块 → 各系统不透明度（KICKOFF 第 6 节："各系统按顺序在区间内淡入淡出"）。
 *
 * 每个系统给一串控制点 [滑块值, 不透明度]，之间线性插值，两端取首/末值。
 * 关键点是**淡入**：轮到某系统之前它只是淡淡的底噪（0.12–0.3），轮到时才升到 1。
 * 之前六个系统在 layer=0 时全是 1，六层实体叠在一起，画面糊成一团白（2026-08-18 修）。
 *
 * 六个主场：皮肤 0、肌肉 0.2、骨骼 0.45、器官 0.62、血管 0.8、神经 1.0
 * （与 src/ui/LayerSlider.tsx 的 STOPS 一一对应，改一处要改两处）。
 * 三条硬约束，`tests/unit/layers.test.ts` 逐条锁着：
 *   1. 在自己的主场上满档 1.0；
 *   2. 主场上比任何别的系统都实——刻度上写着什么名字就交出什么；
 *   3. 轮过之后回到 0，还没轮到时低于拾取阈值 0.15（否则点里层会命中外层）。
 */
const CURVES: Record<SystemId, ReadonlyArray<readonly [number, number]>> = {
  // 皮肤先稳住再让位。原来是 [0,1] 直接线性掉到 [0.14,0]，而肌肉要到 0.2 才满档——
  // 中间 0.08 那一带皮肤只剩 0.43、肌肉才 0.30，两层都是半透明，画面一片糊，
  // 既看不清也点不准。现在皮肤前 6% 基本不动，然后快速交棒；肌肉提前到 0.14 就有 0.7。
  skin: [
    [0.0, 1],
    [0.06, 0.9],
    [0.16, 0],
  ],
  muscles: [
    [0.0, 0],
    [0.05, 0.12],
    [0.14, 0.7],
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
    [0.72, 0.35],
    // 0.8 是血管的主场，器官到这儿必须降到拾取阈值以下，
    // 否则点一条血管会命中它前面那块肝
    [0.8, 0.12],
    [0.9, 0],
  ],
  // 血管与神经原来共用 0.85 一个刻度、曲线一模一样：拖到那儿两层一起满档，
  // 而滑块上再没有一个位置能单独看神经。现在拆开——血管 0.8、神经 1.0，
  // 六个系统各有一个"只属于它"的位置（2026-08-21，人类："要细化控制效果"）。
  vessels: [
    [0.0, 0],
    [0.05, 0.05],
    [0.2, 0.1],
    [0.45, 0.18],
    [0.62, 0.3],
    [0.8, 1],
    // 神经主场上留一点血管当伴行参照（神经血管束本来就走在一起），
    // 但压到拾取阈值以下，免得点神经命中旁边的动脉
    [1.0, 0.12],
  ],
  nerves: [
    [0.0, 0],
    [0.05, 0.05],
    [0.2, 0.08],
    [0.45, 0.12],
    [0.62, 0.14],
    [0.8, 0.14],
    [1.0, 1],
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
