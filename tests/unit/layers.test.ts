import { describe, expect, it } from 'vitest';
import { computeAllOpacities, computeSystemOpacity } from '../../src/viewer/layers';

describe('layers: 分层滑块 → 系统不透明度（KICKOFF 第 6 节）', () => {
  it('layer=0 时只有皮肤外壳完全可见，内层是淡淡的底噪', () => {
    const o = computeAllOpacities(0);
    expect(o.skin).toBe(1);
    // 六层同时全不透明会糊成一团白：内层此时只该隐约透出
    for (const system of ['muscles', 'skeleton', 'organs', 'vessels', 'nerves'] as const) {
      expect(o[system]).toBeGreaterThan(0);
      expect(o[system]).toBeLessThanOrEqual(0.3);
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
    for (const layer of [0, 0.3, 0.5, 0.7, 0.85, 1]) {
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
