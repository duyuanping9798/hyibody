import { Box3, PerspectiveCamera, Vector3 } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export interface CameraRig {
  camera: PerspectiveCamera;
  controls: OrbitControls;
  dispose(): void;
}

/** 创建相机 + 轨道控制器。默认自动旋转，用户一交互即停。 */
export function createCameraRig(dom: HTMLElement, aspect: number): CameraRig {
  const camera = new PerspectiveCamera(38, aspect, 1, 20000);
  camera.position.set(0, -2600, 900);
  camera.up.set(0, 0, 1); // BP3D 坐标系 Z 轴向上（KICKOFF 第 5 节 M1-3）

  const controls = new OrbitControls(camera, dom);
  controls.target = new Vector3(0, 0, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 1.2;
  controls.minDistance = 200;
  controls.maxDistance = 8000;

  const stopAutoRotate = () => {
    controls.autoRotate = false;
  };
  dom.addEventListener('pointerdown', stopAutoRotate, { once: true });

  return {
    camera,
    controls,
    dispose() {
      dom.removeEventListener('pointerdown', stopAutoRotate);
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

/** 由包围盒 + 预设算相机位姿：距离取"竖向充满视野"再放一点余量。 */
export function poseForBox(
  box: Box3,
  preset: ViewPresetId,
  fovDeg: number,
  margin = 1.15,
): CameraPose {
  const center = box.getCenter(new Vector3());
  const size = box.getSize(new Vector3());
  const radius = Math.max(size.x, size.y, size.z) * 0.5;
  const dist = (radius / Math.tan(((fovDeg / 2) * Math.PI) / 180)) * margin;
  const { dir, lift } = VIEW_PRESETS[preset];
  const pos = center
    .clone()
    .add(dir.clone().normalize().multiplyScalar(dist))
    .add(new Vector3(0, 0, size.z * lift));
  return { pos, target: center };
}

/** 聚焦单个结构：保持当前观察方向，拉近到框住其包围盒。 */
export function poseForFocus(
  box: Box3,
  cameraPos: Vector3,
  currentTarget: Vector3,
  fovDeg: number,
): CameraPose {
  const center = box.getCenter(new Vector3());
  const size = box.getSize(new Vector3());
  const radius = Math.max(size.x, size.y, size.z, 60) * 0.5;
  const dist = (radius / Math.tan(((fovDeg / 2) * Math.PI) / 180)) * 1.6;
  const dir = cameraPos.clone().sub(currentTarget).normalize();
  return { pos: center.clone().add(dir.multiplyScalar(dist)), target: center };
}
