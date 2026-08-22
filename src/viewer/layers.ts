import type { SystemId } from '../data/types';

/**
 * 分层滑块 → 各系统不透明度（KICKOFF 第 6 节："各系统按顺序在区间内淡入淡出"）。
 *
 * 每个系统给一串控制点 [滑块值, 不透明度]，之间线性插值，两端取首/末值。
 * 关键点是**淡入**：轮到某系统之前它只是淡淡的底噪（0.12–0.3），轮到时才升到 1。
 * 之前六个系统在 layer=0 时全是 1，六层实体叠在一起，画面糊成一团白（2026-08-18 修）。
 *
 * 六个主场：皮肤 0、肌肉 0.2、骨骼 0.45、器官 0.62、血管 0.8、神经 1.0
 * （单一来源是本文件下方的 HOME_STOPS；控制条的跳转按钮与 reveal 都读它）。
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
    [0.05, 0.05],
    [0.14, 0.7],
    [0.2, 1],
    [0.36, 0.1],
    [0.45, 0],
  ],
  // 2026-08-22 灰雾收窄：原来每个"还没轮到"的系统都拖着 0.06–0.40 的底噪尾巴，
  // 四个刻度里有三个同屏 2–4 层半透明（iPhone 真机上灰雾的主力）。现在尾巴
  // 压到 ≤0.08，只保留紧邻主场前的一段快速淡入；"预告感"交给主场交接的
  // 交叉淡入本身。整条滑块"主角不低于 0.45"的扫描契约仍然成立（layers.test）。
  skeleton: [
    [0.0, 0],
    [0.05, 0.03],
    [0.2, 0.05],
    [0.34, 0.75],
    [0.45, 1],
    [0.55, 0.35],
    [0.62, 0.1],
    [0.75, 0],
  ],
  organs: [
    [0.0, 0],
    [0.05, 0.03],
    [0.45, 0.08],
    [0.5, 0.35],
    [0.62, 1],
    [0.72, 0.35],
    [0.8, 0.1],
    [0.9, 0],
  ],
  vessels: [
    [0.0, 0],
    [0.05, 0.02],
    [0.62, 0.08],
    [0.66, 0.3],
    [0.8, 1],
    // 神经主场上留一点血管当伴行参照（神经血管束本来就走在一起），
    // 但压到拾取阈值以下，免得点神经命中旁边的动脉
    [1.0, 0.1],
  ],
  nerves: [
    [0.0, 0],
    [0.05, 0.02],
    [0.62, 0.06],
    [0.8, 0.1],
    [1.0, 1],
  ],
};

/** 拾取只对不透明度 > 0.15 的结构生效（KICKOFF 第 6 节）。 */
export const PICKABLE_OPACITY_THRESHOLD = 0.15;

/**
 * 各系统的"主场"：曲线在这个滑块值上等于 1。控制条的六个跳转按钮、
 * 搜索选中后的"把画面挪到看得清的位置"都以它为准。
 *
 * 这张表原来在 store.ts 里手抄了一份（HOME_LAYER），而且抄旧了：organs 写 0.6
 * （曲线峰在 0.62）、nerves 写 0.8——那是血管/神经共用一档时代的值，拆档之后
 * 神经的主场是 1.0，0.8 上神经只有 0.1，"挪到看得清的位置"挪了个寂寞。
 * 单一来源，别再抄。
 */
export const HOME_STOPS: Record<SystemId, number> = {
  skin: 0,
  muscles: 0.2,
  skeleton: 0.45,
  organs: 0.62,
  vessels: 0.8,
  nerves: 1,
};

/**
 * 把"扫描模式"的当前画面固化成一份手动混合值：曲线 × 手动倍率，逐系统。
 *
 * 用户第一次拖某个推子时调用——从这一刻起六层各自独立（mix 模式），
 * 固化保证画面在切换的那一帧纹丝不动，用户看到的只是"我拖的那层变了"。
 */
export function materializeMix(
  layer: number,
  systemOpacity: Record<SystemId, number>,
): Record<SystemId, number> {
  const out = {} as Record<SystemId, number>;
  for (const system of Object.keys(CURVES) as SystemId[]) {
    out[system] = computeSystemOpacity(system, layer) * systemOpacity[system];
  }
  return out;
}

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
