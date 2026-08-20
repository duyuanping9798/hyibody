import {
  BatchedMesh,
  Box3,
  BufferAttribute,
  Color,
  Matrix4,
  Vector4,
  type BufferGeometry,
  type Material,
} from 'three';

/**
 * 按系统合批。
 *
 * 为什么要做这件事：`?stats=1` 量出来，235 个结构在高画质档的肌肉层是
 * **629 次绘制调用**——已经越过 KICKOFF 的 600 上限。而 `validate.py` 里那条
 * 「结构数 ≈ draw call 数」的静态估算差了 2.7 倍：每个可见结构每帧要被画好几遍
 * （主通道 + 阴影贴图 + AO 的法线 G-buffer + 描边通道）。
 * 结构数还要往 KICKOFF 要求的 300–600 走，一个结构一个网格的架构撑不住。
 *
 * 用 three 的 `BatchedMesh` 而不是自己合并 + 写着色器，理由很具体：
 * - 每实例的**变换**（器官微动画）、**显隐**、**颜色（含 alpha）**、包围盒都是现成的
 * - 射线求交返回 `batchId`，拾取不用自己写
 * - 阴影、法线 G-buffer 这些内建通道自动带上批处理的顶点变换
 * - 我们的材质全都挂着 `onBeforeCompile` 链，自己写合并着色器要把那些链重做一遍
 *
 * **逐结构不透明度是怎么走通的**（这是能不能用 BatchedMesh 的关键）：
 * `setColorAt` 写的是 RGBA 四个通道，着色器里 `vColor *= getBatchingColor(...)`
 * 乘的是整个 vec4，最后 `diffuseColor *= vColor` 连 alpha 一起乘。
 * 前提是材质要开 `vertexColors` 且几何体带一个 itemSize=4 的 color 属性
 * （否则 three 只定义 `USE_COLOR`，片元里拿不到 alpha）——所以下面给每份几何体
 * 补了一个全白的 uint8 颜色属性，4 字节一个顶点。
 */

/** 合批实例的一条记录。 */
export interface BatchSlot {
  slug: string;
  /** BatchedMesh 里的实例 id，也是射线求交返回的 batchId */
  instanceId: number;
  /** 这份几何体在 glb 里自带的反量化 TRS（微动画要在它之上叠加） */
  baseMatrix: Matrix4;
  /** 本地坐标系下的包围盒，取景与标签用 */
  bounds: Box3;
  color: number;
}

const WHITE = new Color(0xffffff);

/**
 * 给几何体补一个全白的顶点色属性（uint8 归一化，4 字节/顶点）。
 *
 * 不能省：`USE_COLOR_ALPHA` 只有在 `material.vertexColors` 为真**且**几何体的
 * color 属性 itemSize 为 4 时才会定义，而只有它定义了，片元着色器里才有
 * `diffuseColor *= vColor` 这一句把 alpha 乘进去。用 uint8 而不是 float：
 * 全是常量 1，精度无所谓，省四分之三的内存。
 */
export function ensureVertexColor(geometry: BufferGeometry): void {
  const existing = geometry.getAttribute('color');
  if (existing && existing.itemSize === 4) return;
  const count = geometry.getAttribute('position').count;
  const data = new Uint8Array(count * 4).fill(255);
  geometry.setAttribute('color', new BufferAttribute(data, 4, true));
}

export interface BatchInput {
  slug: string;
  geometry: BufferGeometry;
  /** glb 节点的世界矩阵 */
  matrix: Matrix4;
  color: number;
}

/**
 * 一个系统一个批。材质由调用方给（每系统一份，不再一个结构一份）。
 */
export class SystemBatch {
  readonly mesh: BatchedMesh;
  private readonly slots = new Map<string, BatchSlot>();
  private readonly bySlot: string[] = [];
  private readonly rgba = new Vector4();
  private readonly tint = new Color();

  constructor(
    readonly system: string,
    material: Material,
    inputs: readonly BatchInput[],
  ) {
    let vertices = 0;
    let indices = 0;
    for (const input of inputs) {
      ensureVertexColor(input.geometry);
      vertices += input.geometry.getAttribute('position').count;
      const index = input.geometry.getIndex();
      indices += index ? index.count : input.geometry.getAttribute('position').count;
    }
    this.mesh = new BatchedMesh(inputs.length, vertices, indices, material);
    this.mesh.name = `${system}-batch`;
    // 逐实例视锥剔除：以前一个结构一个网格时这是白拿的，合批之后要显式开，
    // 否则整批要么全画要么全不画
    this.mesh.perObjectFrustumCulled = true;

    for (const input of inputs) {
      const geometryId = this.mesh.addGeometry(input.geometry);
      const instanceId = this.mesh.addInstance(geometryId);
      this.mesh.setMatrixAt(instanceId, input.matrix);
      const bounds = new Box3();
      this.mesh.getBoundingBoxAt(geometryId, bounds);
      this.slots.set(input.slug, {
        slug: input.slug,
        instanceId,
        baseMatrix: input.matrix.clone(),
        bounds,
        color: input.color,
      });
      this.bySlot[instanceId] = input.slug;
      this.setAppearance(input.slug, 1, 0);
    }
  }

  get(slug: string): BatchSlot | undefined {
    return this.slots.get(slug);
  }

  /** 射线求交返回的 batchId 是哪个结构。 */
  slugAt(batchId: number): string | undefined {
    return this.bySlot[batchId];
  }

  get slugs(): readonly string[] {
    return this.bySlot;
  }

  /**
   * 一次写完这个结构的外观：本色 + 不透明度 + 高亮。
   *
   * 三件事挤在一个 RGBA 里是有意的——它们最终都落到同一张每实例纹理上，
   * 分开写只会多几次纹理上传。`highlight` 是往强调色插值的比例。
   */
  setAppearance(slug: string, opacity: number, highlight: number, highlightColor?: Color): void {
    const slot = this.slots.get(slug);
    if (!slot) return;
    this.tint.setHex(slot.color);
    if (highlight > 0 && highlightColor) this.tint.lerp(highlightColor, highlight);
    // 完全透明的实例直接从批里摘掉：省的是顶点着色，不是像素
    const visible = opacity > 0.005;
    this.mesh.setVisibleAt(slot.instanceId, visible);
    if (!visible) return;
    this.rgba.set(this.tint.r, this.tint.g, this.tint.b, opacity);
    this.mesh.setColorAt(slot.instanceId, this.rgba);
  }

  /** 微动画：在 glb 自带的 TRS 之上叠加。 */
  setMatrix(slug: string, matrix: Matrix4): void {
    const slot = this.slots.get(slug);
    if (slot) this.mesh.setMatrixAt(slot.instanceId, matrix);
  }

  resetMatrix(slug: string): void {
    const slot = this.slots.get(slug);
    if (slot) this.mesh.setMatrixAt(slot.instanceId, slot.baseMatrix);
  }

  dispose(): void {
    this.mesh.dispose();
    this.slots.clear();
    this.bySlot.length = 0;
  }
}

export { WHITE as BATCH_WHITE };
