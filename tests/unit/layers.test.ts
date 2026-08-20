import { describe, expect, it } from 'vitest';
import { computeAllOpacities, computeSystemOpacity } from '../../src/viewer/layers';

describe('layers: 分层滑块 → 系统不透明度（KICKOFF 第 6 节）', () => {
  it('layer=0 是一层干净的皮肤，滑一点点内层才开始透出来', () => {
    // 皮肤 2026-08-20 换成不透明的物理材质之后，layer=0 本来就看不见里面。
    // 底噪唯一的效果是让紧贴皮下的结构从减面外壳外面冒出来（实拍：腿上一道红印），
    // 所以第一格留成纯皮肤。
    const o = computeAllOpacities(0);
    expect(o.skin).toBe(1);
    for (const system of ['muscles', 'skeleton', 'organs', 'vessels', 'nerves'] as const) {
      expect(o[system]).toBe(0);
    }
    // 滑块一动，底噪立刻到位——不是拖到主场才出现
    const o2 = computeAllOpacities(0.04);
    for (const system of ['muscles', 'skeleton', 'organs', 'vessels', 'nerves'] as const) {
      expect(o2[system]).toBeGreaterThan(0);
      expect(o2[system]).toBeLessThanOrEqual(0.3);
    }
  });

  it('内层随滑块推进淡入到 1（各自的主场）', () => {
    expect(computeSystemOpacity('muscles', 0.2)).toBe(1);
    expect(computeSystemOpacity('skeleton', 0.45)).toBe(1);
    expect(computeSystemOpacity('organs', 0.45)).toBe(1);
    expect(computeSystemOpacity('vessels', 0.7)).toBe(1);
    // 单调递增到主场为止
    expect(computeSystemOpacity('organs', 0.3)).toBeGreaterThan(
      computeSystemOpacity('organs', 0.1),
    );
  });

  it('皮肤在 0.2 处完全淡出', () => {
    expect(computeSystemOpacity('skin', 0.2)).toBe(0);
    expect(computeSystemOpacity('skin', 0.1)).toBeCloseTo(0.5);
  });

  it('肌肉在 0.2–0.45 区间淡出', () => {
    expect(computeSystemOpacity('muscles', 0.2)).toBe(1);
    expect(computeSystemOpacity('muscles', 0.45)).toBe(0);
  });

  it('骨骼始终可见；主场之后淡化但不低于 0.35', () => {
    for (const layer of [0.04, 0.3, 0.5, 0.7, 0.85, 1]) {
      expect(computeSystemOpacity('skeleton', layer)).toBeGreaterThan(0);
    }
    for (const layer of [0.45, 0.5, 0.7, 0.85, 1]) {
      expect(computeSystemOpacity('skeleton', layer)).toBeGreaterThanOrEqual(0.35);
    }
    expect(computeSystemOpacity('skeleton', 1)).toBe(0.35);
  });

  it('血管与神经在滑块末段保持可见', () => {
    expect(computeSystemOpacity('vessels', 1)).toBe(1);
    expect(computeSystemOpacity('nerves', 0.85)).toBe(1);
  });

  it('滑块越界值被钳制', () => {
    expect(computeSystemOpacity('skin', -1)).toBe(1);
    expect(computeSystemOpacity('skin', 2)).toBe(0);
  });
});
