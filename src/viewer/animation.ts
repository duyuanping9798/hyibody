/**
 * 器官微动画（加强路线第④步）：心脏"扑通"搏动与肺呼吸起伏。
 * 纯函数（时间 → 缩放系数），便于单测；应用方式为绕结构自身中心缩放。
 * prefers-reduced-motion 时由调用方关闭。
 */

/** 心率约 66 次/分；缩放 1 → 1.028，波形取正弦正半周的三次方（收缩短促、舒张长）。 */
export function heartScale(tSeconds: number): number {
  const phase = Math.sin(2 * Math.PI * 1.1 * tSeconds);
  const beat = Math.max(0, phase) ** 3;
  return 1 + 0.028 * beat;
}

/** 呼吸约 13 次/分；缩放 1 ± 0.012 的平滑正弦。 */
export function lungScale(tSeconds: number): number {
  return 1 + 0.012 * Math.sin(2 * Math.PI * 0.22 * tSeconds);
}

/** 参与微动画的结构 slug → 缩放函数。 */
export const ANIMATED_STRUCTURES: Record<string, (t: number) => number> = {
  heart: heartScale,
  lung_left: lungScale,
  lung_right: lungScale,
};

/**
 * Kiosk 吸引动画的分层扫描（M2-2）：44 秒一个来回的三角波 0 → 1 → 0，
 * 端点各停留 4 秒，让"皮肤完整态"和"血管神经态"都能被看清。
 */
export function attractLayer(tSeconds: number): number {
  const period = 44;
  const hold = 4;
  const sweep = period / 2 - hold;
  const t = ((tSeconds % period) + period) % period;
  if (t < hold) return 0;
  if (t < hold + sweep) return (t - hold) / sweep;
  if (t < period / 2 + hold) return 1;
  return Math.max(0, 1 - (t - period / 2 - hold) / sweep);
}

/** 一个结构的基准变换（glb 节点自带的，量化后就是反量化矩阵）。 */
export interface PulseBase {
  position: { x: number; y: number; z: number };
  /** 均匀缩放，取 x 分量即可 */
  scale: number;
  /** 几何体包围盒中心（物体空间，量化后在 ±1 附近） */
  center: { x: number; y: number; z: number };
}

/**
 * 把"绕自身中心缩放 s 倍"叠加到基准变换上，返回新的 position/scale。
 *
 * 之所以不能直接 `mesh.scale.setScalar(s)`：流水线用 KHR_mesh_quantization，
 * 每个节点自带反量化的 translation + scale（肺是 116.7），直接写 scale 会把它抹掉，
 * 结果心脏和双肺被缩到百分之一大小、塞回坐标原点——整个胸腔看着就是空的
 * （2026-08-18 修，此前选中心脏什么也看不到）。
 *
 * 推导：世界坐标 P = T + S·p。要让几何中心 C 在缩放后停在原处，
 * 需 T' + S·s·C = T + S·C，即 T' = T + S·C·(1 − s)。
 */
export function pulseTransform(
  base: PulseBase,
  s: number,
): { position: { x: number; y: number; z: number }; scale: number } {
  const k = base.scale * (1 - s);
  return {
    position: {
      x: base.position.x + base.center.x * k,
      y: base.position.y + base.center.y * k,
      z: base.position.z + base.center.z * k,
    },
    scale: base.scale * s,
  };
}
