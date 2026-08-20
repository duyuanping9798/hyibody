import type { PerspectiveCamera, Vector3 } from 'three';

/**
 * 运镜与缓动（奥秘播放的"科普视频感"）。
 *
 * 纯数学 + three 的向量，不碰 React、不碰 DOM——放在 src/viewer 里的东西都归
 * 渲染核心管（CLAUDE.md 目录约定）。UI 只负责说"这一步用哪种运镜"。
 */

export type EaseId = 'linear' | 'outCubic' | 'inOutCubic' | 'inOutQuint';

/**
 * 缓动曲线。
 *
 * 之前所有相机飞行都写死 `easeOutCubic`：起步猛、收尾软，点一下结构飞过去很跟手。
 * 但奥秘是**看的**不是点的，一上来就猛冲会晕；`inOutCubic` 两头都慢，
 * 像纪录片里的摇镜。两种都留着，按场合选。
 */
export const EASINGS: Record<EaseId, (t: number) => number> = {
  linear: (t) => t,
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  inOutQuint: (t) => (t < 0.5 ? 16 * t ** 5 : 1 - Math.pow(-2 * t + 2, 5) / 2),
};

/**
 * 一步停住之后相机继续做的微动作。
 *
 * 静止的画面在视频里是"死"的——纪录片几乎没有一个真正不动的镜头。
 * 这些速度都刻意压得很慢（每秒百分之几），是"觉察不到在动，但看得出没停"，
 * 不是甩镜头。
 */
export type MotionId = 'still' | 'push' | 'pull' | 'orbit' | 'orbitBack' | 'rise' | 'sink';

export const MOTION_IDS: MotionId[] = [
  'still',
  'push',
  'pull',
  'orbit',
  'orbitBack',
  'rise',
  'sink',
];

/**
 * 各运镜的默认速率：推拉是每秒距离比例，环绕/升降是每秒弧度。
 *
 * 第一版给到 push 0.035/s，配 10 秒上限就是一步之内拉近 30%——录出来的样片里
 * 全身景到这一步的末尾，脑袋已经被切在画面外了。取景逻辑辛辛苦苦按安全区算出
 * "整个人都在画面里"，微动作转手就把它推翻。现在压到 30% 的一半再多一点：
 * 一步最多改变约 13% 的距离、约 23° 的角度，是"看得出没停"而不是"换了个镜头"。
 */
const MOTION_RATE: Record<MotionId, number> = {
  still: 0,
  push: 0.016,
  pull: 0.014,
  orbit: 0.045,
  orbitBack: -0.045,
  rise: 0.03,
  sink: -0.03,
};

/**
 * 一步之内微动作最多做这么久（秒）。
 *
 * 内置奥秘每一步都带相机指令，飞行一开始 drift 就归零，跑不飞。但 UGC 不保证——
 * 用户写一串没有相机指令的步骤，推近就会一路叠加到贴着骨头。
 */
export const MAX_DRIFT_S = 9;

/** 升降不能翻过头顶：极角夹在这个范围里，越过就顶住不再动。 */
const MIN_POLAR = 0.22;
const MAX_POLAR = Math.PI - 0.22;

export interface DriftLimits {
  minDistance: number;
  maxDistance: number;
}

/**
 * 把一帧的微动作施加到相机上。返回是否真的动了（顶住上下限时不动）。
 *
 * 只改相机位置、不改 `controls.target`——目标点一动，用户手动拖拽的手感就飘了。
 * 环绕绕的是世界 Z 轴（BP3D 坐标系里 Z 向上），不是屏幕竖轴。
 */
export function applyDrift(
  camera: PerspectiveCamera,
  target: Vector3,
  motion: MotionId,
  dt: number,
  limits: DriftLimits,
  speed = 1,
): boolean {
  const rate = MOTION_RATE[motion] * speed;
  if (!rate || dt <= 0) return false;

  const ox = camera.position.x - target.x;
  const oy = camera.position.y - target.y;
  const oz = camera.position.z - target.z;
  const dist = Math.hypot(ox, oy, oz);
  if (dist < 1e-6) return false;

  if (motion === 'push' || motion === 'pull') {
    const next = dist * (motion === 'push' ? 1 - rate * dt : 1 + rate * dt);
    const clamped = Math.min(limits.maxDistance, Math.max(limits.minDistance, next));
    if (Math.abs(clamped - dist) < 1e-6) return false;
    const k = clamped / dist;
    camera.position.set(target.x + ox * k, target.y + oy * k, target.z + oz * k);
    return true;
  }

  if (motion === 'orbit' || motion === 'orbitBack') {
    const a = rate * dt;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    camera.position.set(
      target.x + ox * cos - oy * sin,
      target.y + ox * sin + oy * cos,
      target.z + oz,
    );
    return true;
  }

  // rise / sink：沿极角走，方位角不变。夹住上下不让它翻过头顶或钻到脚底。
  const horiz = Math.hypot(ox, oy);
  const polar = Math.atan2(horiz, oz);
  const next = Math.min(MAX_POLAR, Math.max(MIN_POLAR, polar - rate * dt));
  if (Math.abs(next - polar) < 1e-6) return false;
  const azimuth = Math.atan2(oy, ox);
  const sinP = Math.sin(next);
  camera.position.set(
    target.x + dist * sinP * Math.cos(azimuth),
    target.y + dist * sinP * Math.sin(azimuth),
    target.z + dist * Math.cos(next),
  );
  return true;
}

export interface FlightOptions {
  /** 飞行时长（秒）。奥秘里给长一点（1.5 s）像摇镜，手动点选给短的（0.6 s）跟手。 */
  durationS?: number;
  ease?: EaseId;
  /**
   * 抛物线抬升：飞行中途把相机沿"屏幕上方"抬起这么多倍距离，落点不变。
   * 直线插值在两个相距很远的位姿之间会**穿过人体**（从心脏飞到膝盖会横切腹腔），
   * 抬一点起来就绕过去了。
   */
  arc?: number;
}

/** 奥秘播放时的默认飞行手感：慢、两头软、带一点抬升。 */
export const CINEMATIC_FLIGHT: Required<FlightOptions> = {
  durationS: 1.5,
  ease: 'inOutCubic',
  arc: 0.12,
};

/** 手动点选时的默认飞行手感：快、跟手、不绕路。 */
export const DIRECT_FLIGHT: Required<FlightOptions> = {
  durationS: 0.6,
  ease: 'outCubic',
  arc: 0,
};
