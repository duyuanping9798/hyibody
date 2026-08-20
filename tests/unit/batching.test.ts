import { describe, expect, it } from 'vitest';
import { BoxGeometry, Color, Matrix4, MeshStandardMaterial, Vector4 } from 'three';
import { ensureVertexColor, SystemBatch, type BatchInput } from '../../src/viewer/batching';

function input(slug: string, color = 0x445566, x = 0): BatchInput {
  return {
    slug,
    geometry: new BoxGeometry(10, 10, 10),
    matrix: new Matrix4().makeTranslation(x, 0, 0),
    color,
  };
}

function batchOf(...slugs: string[]): SystemBatch {
  const material = new MeshStandardMaterial({ vertexColors: true, transparent: true });
  return new SystemBatch(
    'organs',
    material,
    slugs.map((s, i) => input(s, 0x445566, i * 20)),
  );
}

describe('合批：顶点色属性', () => {
  it('补一个 itemSize=4 的 color 属性——只有它在，片元里才拿得到 alpha', () => {
    const g = new BoxGeometry(1, 1, 1);
    expect(g.getAttribute('color')).toBeUndefined();
    ensureVertexColor(g);
    const attr = g.getAttribute('color');
    expect(attr.itemSize).toBe(4);
    expect(attr.count).toBe(g.getAttribute('position').count);
    // 全白：真正的颜色由每实例的 setColorAt 乘进来
    expect(attr.array[0]).toBe(255);
  });

  it('已经有四通道颜色就不动它', () => {
    const g = new BoxGeometry(1, 1, 1);
    ensureVertexColor(g);
    const first = g.getAttribute('color');
    ensureVertexColor(g);
    expect(g.getAttribute('color')).toBe(first);
  });
});

describe('合批：一个系统一个批', () => {
  it('每个结构拿到一个实例 id，且能反查回 slug', () => {
    const batch = batchOf('heart', 'liver', 'lung');
    expect(batch.get('heart')?.instanceId).toBe(0);
    expect(batch.get('lung')?.instanceId).toBe(2);
    expect(batch.slugAt(1)).toBe('liver');
    expect(batch.slugAt(99)).toBeUndefined();
  });

  it('不认识的 slug 不会炸', () => {
    const batch = batchOf('heart');
    expect(batch.get('nope')).toBeUndefined();
    expect(() => batch.setAppearance('nope', 1, 0)).not.toThrow();
    expect(() => batch.setMatrix('nope', new Matrix4())).not.toThrow();
  });

  it('包围盒按几何体各自算，不是整批一个', () => {
    const batch = batchOf('a', 'b');
    const box = batch.get('a')!.bounds;
    expect(box.max.x - box.min.x).toBeCloseTo(10, 5);
  });

  it('不透明度写进每实例颜色的 alpha 通道', () => {
    const batch = batchOf('heart');
    batch.setAppearance('heart', 0.35, 0);
    const out = new Vector4();
    batch.mesh.getColorAt(0, out);
    expect(out.w).toBeCloseTo(0.35, 3);
  });

  it('完全透明时把实例从批里摘掉——省的是顶点着色', () => {
    const batch = batchOf('heart');
    batch.setAppearance('heart', 0, 0);
    expect(batch.mesh.getVisibleAt(0)).toBe(false);
    batch.setAppearance('heart', 1, 0);
    expect(batch.mesh.getVisibleAt(0)).toBe(true);
  });

  it('高亮是往强调色插值，不是整个换掉', () => {
    const batch = batchOf('heart');
    const accent = new Color(0x4fe3e0);
    batch.setAppearance('heart', 1, 0, accent);
    const plain = new Vector4();
    batch.mesh.getColorAt(0, plain);
    batch.setAppearance('heart', 1, 0.5, accent);
    const lit = new Vector4();
    batch.mesh.getColorAt(0, lit);
    // 往青色走了，但没走到底
    expect(lit.z).toBeGreaterThan(plain.z);
    expect(lit.z).toBeLessThan(accent.b);
  });

  it('微动画改矩阵之后能还原回 glb 自带的 TRS', () => {
    const batch = batchOf('heart');
    const base = new Matrix4();
    batch.mesh.getMatrixAt(0, base);
    batch.setMatrix('heart', new Matrix4().makeScale(2, 2, 2));
    const moved = new Matrix4();
    batch.mesh.getMatrixAt(0, moved);
    expect(moved.elements[0]).toBeCloseTo(2, 5);
    batch.resetMatrix('heart');
    const back = new Matrix4();
    batch.mesh.getMatrixAt(0, back);
    expect(back.elements).toEqual(base.elements);
  });

  it('开了逐实例视锥剔除——合批之后不开就是整批全画或全不画', () => {
    expect(batchOf('a').mesh.perObjectFrustumCulled).toBe(true);
  });
});
