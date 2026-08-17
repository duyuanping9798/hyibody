import { PerspectiveCamera, Vector3 } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export interface CameraRig {
  camera: PerspectiveCamera;
  controls: OrbitControls;
  dispose(): void;
}

/** 创建相机 + 轨道控制器。默认自动旋转，用户一交互即停（M0 占位模型展示用）。 */
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
  controls.minDistance = 400;
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
