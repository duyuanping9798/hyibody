import { Raycaster, Vector2, type Camera, type Mesh } from 'three';

/**
 * 三维拾取（KICKOFF 第 6 节）：射线求交，只对调用方筛选后的"可见且不透明度
 * 达阈值"的网格生效。点击 vs 拖拽的区分由调用方用指针位移判断。
 */
export class StructurePicker {
  private readonly raycaster = new Raycaster();
  private readonly ndc = new Vector2();

  pick(
    clientX: number,
    clientY: number,
    dom: HTMLElement,
    camera: Camera,
    meshes: Mesh[],
  ): Mesh | null {
    const rect = dom.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    this.ndc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.ndc, camera);
    const hits = this.raycaster.intersectObjects(meshes, false);
    return (hits[0]?.object as Mesh | undefined) ?? null;
  }
}

/** 指针按下到抬起的位移小于该值（px）才算点击，否则视为拖拽相机。 */
export const CLICK_MOVE_TOLERANCE_PX = 6;
