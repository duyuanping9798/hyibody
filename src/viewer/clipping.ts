import { Plane, Vector3, type Box3 } from 'three';

export type ClipAxis = 'x' | 'y' | 'z';

/**
 * 剖切平面常量：pos ∈ [-1, 1] 沿轴向从 min 扫到 max。
 * three.js Plane(n, c) 保留满足 n·p + c ≥ 0 的一侧；法线取 -axis，
 * 即保留坐标 ≤ 切面位置的部分（pos = 1 完全不切）。
 */
export function clipConstant(pos: number, min: number, max: number): number {
  const t = (Math.min(1, Math.max(-1, pos)) + 1) / 2;
  return min + (max - min) * t;
}

const AXIS_NORMALS: Record<ClipAxis, Vector3> = {
  x: new Vector3(-1, 0, 0),
  y: new Vector3(0, -1, 0),
  z: new Vector3(0, 0, -1),
};

export function clipPlaneFor(axis: ClipAxis, pos: number, box: Box3): Plane {
  const min = box.min[axis];
  const max = box.max[axis];
  return new Plane(AXIS_NORMALS[axis].clone(), clipConstant(pos, min, max));
}
