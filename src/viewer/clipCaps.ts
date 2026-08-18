import {
  AlwaysStencilFunc,
  BackSide,
  Color,
  DecrementWrapStencilOp,
  FrontSide,
  Group,
  IncrementWrapStencilOp,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NotEqualStencilFunc,
  PlaneGeometry,
  ReplaceStencilOp,
  Sphere,
  Vector3,
  type Plane,
  type WebGLRenderer,
} from 'three';

/**
 * 剖切封盖（stencil cap）：让剖开的结构露出实心断面，而不是一个空壳。
 *
 * 做法是 three.js 官方 clipping-stencil 的标准套路：
 * 1. 对每个要封盖的网格，用同一份几何体额外画两遍（不写颜色、不写深度）——
 *    背面 increment、正面 decrement 模板值。剖切面切开的地方正反面数量不配平，
 *    模板值就非零，那正是"实心内部"在屏幕上的投影。
 * 2. 再在剖切面所在位置画一张平面，只在模板值非零处着色，于是断面被填上。
 *
 * 每个结构要多两次绘制调用，所以只给"看得清的实体"封盖（不透明度 > 阈值、
 * 且不是皮肤那种 X-ray 外壳）；剖切关掉时整组不渲染，日常一分钱不花。
 */

/** 只给足够实的结构封盖：太透的结构本来就看不出断面，白花绘制调用 */
export const CAP_MIN_OPACITY = 0.5;
/** 同屏封盖结构数上限（每个 +2 次绘制调用，预算 600，日常 135 个结构） */
export const CAP_MAX_STRUCTURES = 120;

export interface CapCandidate {
  slug: string;
  mesh: Mesh;
  /** 断面颜色，通常取结构本色 */
  color: number;
}

interface CapEntry {
  stencil: Group;
  plane: Mesh;
  radius: number;
}

function createStencilGroup(mesh: Mesh, plane: Plane, renderOrder: number): Group {
  const group = new Group();
  const base = new MeshBasicMaterial();
  base.depthWrite = false;
  base.depthTest = false;
  base.colorWrite = false;
  base.stencilWrite = true;
  base.stencilFunc = AlwaysStencilFunc;

  for (const [side, op] of [
    [BackSide, IncrementWrapStencilOp],
    [FrontSide, DecrementWrapStencilOp],
  ] as const) {
    const material = base.clone();
    material.side = side;
    material.clippingPlanes = [plane];
    material.stencilFail = op;
    material.stencilZFail = op;
    material.stencilZPass = op;
    const stencilMesh = new Mesh(mesh.geometry, material);
    stencilMesh.renderOrder = renderOrder;
    group.add(stencilMesh);
  }
  return group;
}

function createCapPlane(color: number, renderOrder: number): Mesh {
  const material = new MeshStandardMaterial({
    color: new Color(color),
    // 断面是"切开的肉"，比外表面更哑更暗一点才像切面
    roughness: 0.85,
    metalness: 0.0,
    envMapIntensity: 0.45,
    stencilWrite: true,
    stencilRef: 0,
    stencilFunc: NotEqualStencilFunc,
    stencilFail: ReplaceStencilOp,
    stencilZFail: ReplaceStencilOp,
    stencilZPass: ReplaceStencilOp,
  });
  const plane = new Mesh(new PlaneGeometry(1, 1), material);
  plane.renderOrder = renderOrder + 0.1;
  // 画完这一张就把模板缓冲清干净，免得影响下一个结构
  plane.onAfterRender = (renderer: WebGLRenderer) => renderer.clearStencil();
  return plane;
}

export class ClipCaps {
  readonly root = new Group();
  private readonly entries = new Map<string, CapEntry>();
  private plane: Plane | null = null;

  constructor() {
    this.root.visible = false;
    // 封盖是屏幕空间效果，不该参与取景与包围盒计算
    this.root.matrixAutoUpdate = false;
  }

  /** 切换剖切面；传 null 关闭封盖。 */
  setPlane(plane: Plane | null): void {
    this.plane = plane;
    this.root.visible = plane !== null;
    if (!plane) return;
    for (const entry of this.entries.values()) {
      for (const child of entry.stencil.children) {
        const material = (child as Mesh).material as MeshBasicMaterial;
        material.clippingPlanes = [plane];
      }
    }
  }

  /**
   * 按当前可见结构重建封盖集合。只在剖切开关/分层/显隐变化时调用，不必每帧跑。
   */
  update(candidates: CapCandidate[]): void {
    if (!this.plane) return;
    const wanted = new Set<string>();
    for (const candidate of candidates.slice(0, CAP_MAX_STRUCTURES)) {
      wanted.add(candidate.slug);
      if (this.entries.has(candidate.slug)) continue;
      const geometry = candidate.mesh.geometry;
      if (!geometry.boundingSphere) geometry.computeBoundingSphere();
      const stencil = createStencilGroup(candidate.mesh, this.plane, 1);
      // 挂成结构网格的子节点：量化缩放、器官微动画都自动跟上（拾取用非递归，不受影响）
      candidate.mesh.add(stencil);
      const plane = createCapPlane(candidate.color, 1);
      this.root.add(plane);
      this.entries.set(candidate.slug, {
        stencil,
        plane,
        radius: this.worldRadius(candidate.mesh, geometry.boundingSphere),
      });
    }
    for (const [slug, entry] of this.entries) {
      if (wanted.has(slug)) continue;
      entry.stencil.removeFromParent();
      entry.plane.removeFromParent();
      this.disposeEntry(entry);
      this.entries.delete(slug);
    }
  }

  private worldRadius(mesh: Mesh, sphere: Sphere | null): number {
    const scale = Math.max(mesh.scale.x, mesh.scale.y, mesh.scale.z) || 1;
    return (sphere?.radius ?? 1) * scale;
  }

  /** 每帧把封盖平面贴到剖切面上（相机转动时朝向不变，但位置要跟着剖切滑块走）。 */
  syncToPlane(): void {
    const plane = this.plane;
    if (!plane || !this.root.visible) return;
    const point = new Vector3();
    for (const entry of this.entries.values()) {
      plane.coplanarPoint(point);
      entry.plane.position.copy(point);
      entry.plane.lookAt(
        point.x - plane.normal.x,
        point.y - plane.normal.y,
        point.z - plane.normal.z,
      );
      // 平面要盖住整个结构：按包围球直径放大一点
      const size = entry.radius * 2.4;
      entry.plane.scale.set(size, size, 1);
      entry.plane.updateMatrix();
    }
  }

  private disposeEntry(entry: CapEntry): void {
    for (const child of entry.stencil.children) {
      ((child as Mesh).material as MeshBasicMaterial).dispose();
    }
    entry.plane.geometry.dispose();
    (entry.plane.material as MeshStandardMaterial).dispose();
  }

  dispose(): void {
    for (const entry of this.entries.values()) {
      entry.stencil.removeFromParent();
      entry.plane.removeFromParent();
      this.disposeEntry(entry);
    }
    this.entries.clear();
  }
}
