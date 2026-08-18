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

/**
 * `flip` 决定切掉哪一半：默认保留坐标小的一侧，翻转后保留大的一侧。
 * 想"看进去"就得切掉朝向相机的那一半，光有位置不够。
 */
export function clipPlaneFor(axis: ClipAxis, pos: number, box: Box3, flip = false): Plane {
  const min = box.min[axis];
  const max = box.max[axis];
  const constant = clipConstant(pos, min, max);
  if (!flip) return new Plane(AXIS_NORMALS[axis].clone(), constant);
  return new Plane(AXIS_NORMALS[axis].clone().negate(), -constant);
}

/**
 * 反解：想让剖切面正好经过世界坐标 `coord`，滑块该给多少。
 * 与 clipConstant 互逆，超出内容包围盒时钳到两端。
 */
export function clipPosForCoordinate(coord: number, min: number, max: number): number {
  if (max <= min) return 0;
  const t = (coord - min) / (max - min);
  return Math.min(1, Math.max(-1, t * 2 - 1));
}
