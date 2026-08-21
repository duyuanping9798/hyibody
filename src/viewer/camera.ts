import { Box3, MOUSE, PerspectiveCamera, TOUCH, Vector3 } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export interface CameraRig {
  camera: PerspectiveCamera;
  controls: OrbitControls;
  dispose(): void;
}

/**
 * 相机最近能凑到多近（毫米）。
 *
 * 原来是 200 mm，比晶状体（直径 10 mm）、瓣膜这些结构大一个数量级，
 * 于是"聚焦"算出来的 55 mm 会被控制器夹回 200 mm，小结构永远只有指甲盖大——
 * 用户说的"放大缩小很不方便"有一半是这条限制造成的。
 */
const MIN_DISTANCE_MM = 25;

/**
 * 聚焦时"当作至少这么大"的尺寸下限（毫米）。
 *
 * 原来是 60 mm，配的是 200 mm 的最近距离：晶状体（10 mm）按 60 mm 算出 139 mm，
 * 屏幕上只占一成高，等于没凑近。最近距离降到 25 mm 之后这条也跟着降，
 * 同一个晶状体现在算出 35 mm，占四成屏高——该看清的看得清。
 */
const FOCUS_MIN_SIZE_MM = 15;

/** 创建相机 + 轨道控制器。默认自动旋转，用户一交互即停。 */
export function createCameraRig(dom: HTMLElement, aspect: number): CameraRig {
  /*
   * 近平面 1 → 5 毫米、远平面 20000 → 14000 毫米。
   *
   * 原来的 1:20000 是随手给的"够用就行"，代价藏得很深：深度缓冲的精度按
   * near/far 的**比值**分配，比值越大，远处越粗。人体在 2.6 米外，恰好落在
   * 精度最差的那一段——平时看不出来，但任何**读深度**的效果都会当场报废。
   * GTAO 就是这么一开始完全不生效的：法线缓冲干干净净，AO 缓冲一片全白
   * （`?aodebug=3` / `?aodebug=2` 逐环看出来的）。
   *
   * 5 毫米仍然远小于轨道控制器允许的最近距离（25 毫米），14000 也覆盖得住
   * 最远 8000 加上人体本身——两头都没有被裁掉的风险，比值却小了 7 倍。
   */
  const camera = new PerspectiveCamera(38, aspect, 5, 14000);
  camera.position.set(0, -2600, 900);
  camera.up.set(0, 0, 1); // BP3D 坐标系 Z 轴向上（KICKOFF 第 5 节 M1-3）

  const controls = new OrbitControls(camera, dom);
  controls.target = new Vector3(0, 0, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 1.2;
  controls.minDistance = MIN_DISTANCE_MM;
  controls.maxDistance = 8000;
  // 以光标（或双指中点）为中心缩放：滚轮朝哪儿滚就往哪儿去，而不是永远
  // 对着人体正中；轨道中心随之前移，接着旋转也就绕着看的那块转
  controls.zoomToCursor = true;
  controls.zoomSpeed = 1.4;
  controls.rotateSpeed = 0.85;
  controls.panSpeed = 1;
  controls.screenSpacePanning = true;
  // 移动端：单指转、双指同时捏合缩放与平移（OrbitControls 会自己设 touch-action: none）
  controls.touches = { ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_PAN };
  controls.mouseButtons = { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN };

  const stopAutoRotate = () => {
    controls.autoRotate = false;
  };
  dom.addEventListener('pointerdown', stopAutoRotate, { once: true });
  dom.addEventListener('wheel', stopAutoRotate, { once: true, passive: true });

  return {
    camera,
    controls,
    dispose() {
      dom.removeEventListener('pointerdown', stopAutoRotate);
      dom.removeEventListener('wheel', stopAutoRotate);
      controls.dispose();
    },
  };
}

/** 6 个预设视角（KICKOFF 第 6 节）：观察方向（相机 → 目标的反方向）+ 高度偏移。 */
export const VIEW_PRESETS = {
  front: { dir: new Vector3(0, -1, 0), lift: 0 },
  back: { dir: new Vector3(0, 1, 0), lift: 0 },
  left: { dir: new Vector3(-1, 0, 0), lift: 0 },
  right: { dir: new Vector3(1, 0, 0), lift: 0 },
  top: { dir: new Vector3(0, -0.001, 1), lift: 0 },
  hero: { dir: new Vector3(-0.55, -1, 0), lift: 0.18 },
} as const;

export type ViewPresetId = keyof typeof VIEW_PRESETS;

export interface CameraPose {
  pos: Vector3;
  target: Vector3;
}

/**
 * 画布上被界面挡住的那一圈（CSS 像素）。取景要按**剩下的空当**来框，
 * 而不是按整块画布——不然人体两端会缩进顶栏和分层滑块底下。
 */
export interface SafeInsets {
  width: number;
  height: number;
  top: number;
  bottom: number;
}

/**
 * 安全区内部再留的余量。
 *
 * 原来是 1.15，配的是"按整块画布取景"——人体占满视口高度九成，上下各只剩三四十
 * 像素，脚直接陷进分层滑块。改成按安全区取景之后这个数要**调小**而不是调大：
 * 安全区本身已经只有视口的七到八成，再乘 1.28 就只剩六成，人小得像蚂蚁
 * （实测 MacBook Air 61%、iPhone SE 53%）。安全区计算时每边已经各加了 8 px 留白，
 * 这里 1.05 再补一点点，最终人体约占视口高度七成。
 */
export const FRAME_MARGIN = 1.05;

/**
 * 安全区占画布的比例，以及安全区中心相对画布中心的像素偏移。
 * 两处取景（整体 poseForBox、单结构 poseForFocus）共用同一套换算。
 */
/** 安全区再窄，相机也不该无限往后退——占比低于这个值就按这个值算距离。 */
const MIN_USABLE_FRACTION = 0.3;

function safeFraction(safe?: SafeInsets): { usable: number; pxOffset: number } | null {
  if (!safe || safe.height <= 0) return null;
  const top = Math.max(0, safe.top);
  const bottom = safe.height - Math.max(0, safe.bottom);
  const usable = (bottom - top) / safe.height;
  if (usable <= 0) return null;
  // 关键：安全区窄的时候**照样要平移**，只是距离不再按比例拉远。
  // 原来这里是「不足 30% 就整个放弃」，而手机上信息卡打开时正好是 27.8%——
  // 最需要把结构挪出卡片的那一刻，它撂挑子了（实测复现）。
  return {
    usable: Math.max(usable, MIN_USABLE_FRACTION),
    pxOffset: (top + bottom) / 2 - safe.height / 2,
  };
}

/** 屏幕"上"方向在世界坐标里是哪一根轴（俯视时不是 +Z，所以要按观察方向现算）。 */
function screenUpFor(dir: Vector3): Vector3 {
  const forward = dir.clone().normalize().negate();
  const right = new Vector3().crossVectors(forward, new Vector3(0, 0, 1));
  if (right.lengthSq() < 1e-8) right.set(1, 0, 0);
  right.normalize();
  return new Vector3().crossVectors(right, forward).normalize();
}

/**
 * 由包围盒 + 预设算相机位姿：距离取"竖向充满视野"再放一点余量。
 *
 * 给了 `safe` 就按安全区取景：先按安全区占画布的比例把相机再退远一点，
 * 让人体只占那么高；再把画面整体平移，使人体中心落在**安全区的中心**上
 * ——注意方向是反的，相机往下挪画面内容才往上走。
 */
export function poseForBox(
  box: Box3,
  preset: ViewPresetId,
  fovDeg: number,
  margin = FRAME_MARGIN,
  safe?: SafeInsets,
): CameraPose {
  const center = box.getCenter(new Vector3());
  const size = box.getSize(new Vector3());
  const radius = Math.max(size.x, size.y, size.z) * 0.5;
  const halfFov = ((fovDeg / 2) * Math.PI) / 180;
  let dist = (radius / Math.tan(halfFov)) * margin;

  let shift = 0;
  const fit = safeFraction(safe);
  if (fit) {
    dist /= fit.usable;
    shift = fit.pxOffset * ((2 * dist * Math.tan(halfFov)) / safe!.height);
  }

  const { dir, lift } = VIEW_PRESETS[preset];
  const offset = screenUpFor(dir).multiplyScalar(shift);
  const pos = center
    .clone()
    .add(dir.clone().normalize().multiplyScalar(dist))
    .add(new Vector3(0, 0, size.z * lift))
    .add(offset);
  return { pos, target: center.clone().add(offset) };
}

/**
 * 聚焦单个结构：拉近到框住其包围盒。
 *
 * `from` 决定**方向**、包围盒决定**距离**——两者解耦之后，奥秘脚本才能说
 * "从左侧凑近看这个瓣膜"。不给 `from` 就沿用当前观察方向（手动点"聚焦"时的行为）。
 */
export function poseForFocus(
  box: Box3,
  cameraPos: Vector3,
  currentTarget: Vector3,
  fovDeg: number,
  from?: ViewPresetId,
  safe?: SafeInsets,
  /**
   * 取景余量倍数（1 = 刚好框住）。默认 1.6 对大多数结构合适，
   * 但**小结构需要更大的值才看得懂**：髌骨只有 40 毫米，撑满一帧就是一团白，
   * 认不出那是膝盖。给 3 左右能把股骨下端与胫骨上端一起带进画面。
   */
  zoomOut = 1.6,
): CameraPose {
  const center = box.getCenter(new Vector3());
  const size = box.getSize(new Vector3());
  const radius = Math.max(size.x, size.y, size.z, FOCUS_MIN_SIZE_MM) * 0.5;
  const halfFov = ((fovDeg / 2) * Math.PI) / 180;
  let dist = (radius / Math.tan(halfFov)) * zoomOut;
  const dir = from
    ? VIEW_PRESETS[from].dir.clone().normalize()
    : cameraPos.clone().sub(currentTarget).normalize();

  // 和 poseForBox 同一套：按界面之外剩下的空当取景，并把结构挪到那块空当的中心。
  // 开屏取景上一轮已经这么做了，但**点选结构走的是这条路**——手机上信息卡盖住
  // 画布下半部，居中到画布中心等于把结构藏进卡片后面（用户实拍复现）。
  let shift = 0;
  const fit = safeFraction(safe);
  if (fit) {
    dist /= fit.usable;
    shift = fit.pxOffset * ((2 * dist * Math.tan(halfFov)) / safe!.height);
  }
  const offset = screenUpFor(dir).multiplyScalar(shift);
  return {
    pos: center.clone().add(dir.multiplyScalar(dist)).add(offset),
    target: center.clone().add(offset),
  };
}
