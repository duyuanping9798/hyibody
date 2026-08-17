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
