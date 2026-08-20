import {
  CanvasTexture,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SphereGeometry,
  Vector3,
  type Box3,
} from 'three';
import { createBackdropMaterial } from './materials';

/**
 * 舞台：深色渐变背景球 + 三点光 + 接触阴影。
 *
 * 三点光沿用摄影棚布光：主光（右前上，定形）、补光（左前下，压暗部但不打平）、
 * 轮廓光（后上偏冷，把身体从深色背景里"切"出来）。半球光只补一点点天地色差，
 * 主要的间接光交给 RoomEnvironment 的 PMREM 环境贴图。
 */
export interface Stage {
  root: Group;
  key: DirectionalLight;
  fill: DirectionalLight;
  rim: DirectionalLight;
  /** 假接触阴影（脚下一张径向渐变贴图），低画质档也有 */
  contactShadow: Mesh;
}

/** 径向渐变贴图：中心黑、边缘透明，用作脚下的接触阴影。 */
function createContactShadowTexture(size = 256): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const r = size / 2;
    const gradient = ctx.createRadialGradient(r, r, 0, r, r, r);
    gradient.addColorStop(0, 'rgba(0,0,0,0.55)');
    gradient.addColorStop(0.45, 'rgba(0,0,0,0.28)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  }
  return new CanvasTexture(canvas);
}

export function createStage(): Stage {
  const root = new Group();

  // 深色渐变舞台（内翻大球，不参与拾取与取景）
  const backdrop = new Mesh(new SphereGeometry(15000, 48, 32), createBackdropMaterial());
  backdrop.renderOrder = -1;
  backdrop.frustumCulled = false;
  root.add(backdrop);

  const hemi = new HemisphereLight(0x9fb6d8, 0x1a2338, 0.28);
  root.add(hemi);

  const key = new DirectionalLight(0xfff2e2, 1.45);
  key.position.set(1400, -2200, 2000);
  root.add(key);

  const fill = new DirectionalLight(0x9dc6ff, 0.5);
  fill.position.set(-1800, -1400, 400);
  root.add(fill);

  const rim = new DirectionalLight(0x6fe6ff, 0.85);
  rim.position.set(-900, 2400, 1500);
  root.add(rim);

  const contactShadow = new Mesh(
    new PlaneGeometry(1, 1),
    new MeshBasicMaterial({
      map: createContactShadowTexture(),
      transparent: true,
      depthWrite: false,
      opacity: 0.9,
      color: new Color(0x000000),
    }),
  );
  contactShadow.renderOrder = -0.5;
  root.add(contactShadow);

  // 这里曾经有一块 ShadowMaterial 的接影地面。去掉了：以主光 37.5° 的仰角算，
  // 1720 mm 高的人投出的影子长 2242 mm，而那块地面只有 2534 mm 见方，
  // 影子跑出边缘就断了（用户实拍："残缺的阴影"）。更要命的是结构网格只设了
  // castShadow、没设 receiveShadow——整套阴影计算换来的只有地上那道断掉的条纹，
  // 器官之间根本不互相投影。现在反过来：不要地面影子，把自阴影打开。
  return { root, key, fill, rim, contactShadow };
}

/**
 * 按内容包围盒摆放光源目标、接触阴影与接影地面。
 * BP3D 是 Z 轴向上，所以"地面"是 z = 包围盒底面。
 */
export function fitStage(stage: Stage, box: Box3): void {
  if (box.isEmpty()) return;
  const size = box.getSize(new Vector3());
  const center = box.getCenter(new Vector3());
  const groundZ = box.min.z;
  const span = Math.max(size.x, size.y) * 1.9;

  for (const light of [stage.key, stage.fill, stage.rim]) {
    light.target.position.copy(center);
    light.target.updateMatrixWorld();
    if (!light.target.parent) stage.root.add(light.target);
  }

  stage.contactShadow.position.set(center.x, center.y, groundZ + 1);
  stage.contactShadow.scale.set(span, span * 0.75, 1);

  // 主光投影范围只需要罩住人体本身（不再有地面接影），按包围球半径给，
  // 比原来的 max(size)*0.75 更贴身，同样一张 2048 阴影图分到的精度更高
  const cam = stage.key.shadow.camera;
  const half = size.length() * 0.55;
  cam.left = -half;
  cam.right = half;
  cam.top = half;
  cam.bottom = -half;
  cam.near = 1;
  cam.far = half * 12;
  cam.updateProjectionMatrix();
}
