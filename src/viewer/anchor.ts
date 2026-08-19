import { Raycaster, Vector3, type Camera, type Mesh } from 'three';

/** 落点候选的采样上限：顶点多的结构按步长抽样，保证每帧开销恒定。 */
const MAX_SAMPLES = 384;
/** 只在离相机最近的这部分采样点里挑落点，避免引线指到结构背面。 */
const FRONT_QUANTILE = 0.35;

const center = new Vector3();
const ndc = new Vector3();
const vertex = new Vector3();

/**
 * 算标签引线该落在结构上的哪一点。
 *
 * 不能直接用包围盒中心：成对结构（两只眼球、两颗肾）的包围盒中心落在两者
 * **之间**的空气里，引线会指到颅骨正中——用户报的"标注位置不对"就是这个。
 *
 * 所以先从相机往包围盒中心打一条射线，打中自己就用命中点（单个团块的常见情形，
 * 落点自然贴在朝向相机的表面上）；打空了再退回抽样：在离相机最近的那批顶点里，
 * 挑屏幕上离包围盒中心最近的一个，这样成对结构会落到靠近内侧的那只上。
 */
export function anchorPoint(mesh: Mesh, camera: Camera, ray: Raycaster): Vector3 | null {
  const box = mesh.geometry.boundingBox;
  if (!box) return null;
  box.getCenter(center);
  mesh.localToWorld(center);

  const dir = center.clone().sub(camera.position);
  const len = dir.length();
  if (len > 1e-6) {
    ray.set(camera.position, dir.divideScalar(len));
    const hit = ray.intersectObject(mesh, false)[0];
    if (hit) return hit.point.clone();
  }

  const pos = mesh.geometry.getAttribute('position');
  if (!pos || pos.count === 0) return center.clone();
  const step = Math.max(1, Math.ceil(pos.count / MAX_SAMPLES));

  ndc.copy(center).project(camera);
  const cx = ndc.x;
  const cy = ndc.y;

  const samples: { point: Vector3; depth: number; d2: number }[] = [];
  for (let i = 0; i < pos.count; i += step) {
    vertex.fromBufferAttribute(pos, i);
    mesh.localToWorld(vertex);
    const world = vertex.clone();
    ndc.copy(vertex).project(camera);
    if (ndc.z > 1) continue;
    samples.push({
      point: world,
      depth: world.distanceToSquared(camera.position),
      d2: (ndc.x - cx) ** 2 + (ndc.y - cy) ** 2,
    });
  }
  if (samples.length === 0) return center.clone();

  samples.sort((a, b) => a.depth - b.depth);
  const front = samples.slice(0, Math.max(1, Math.round(samples.length * FRONT_QUANTILE)));
  front.sort((a, b) => a.d2 - b.d2);
  return front[0]!.point;
}
