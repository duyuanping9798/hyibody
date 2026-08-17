import { describe, expect, it } from 'vitest';
import { ANIMATED_STRUCTURES, heartScale, lungScale } from '../../src/viewer/animation';

describe('器官微动画', () => {
  it('心跳缩放在 1–1.03 之间且有起伏', () => {
    let min = Infinity;
    let max = -Infinity;
    for (let t = 0; t < 4; t += 0.01) {
      const s = heartScale(t);
      min = Math.min(min, s);
      max = Math.max(max, s);
    }
    expect(min).toBeGreaterThanOrEqual(1);
    expect(max).toBeLessThanOrEqual(1.03);
    expect(max - min).toBeGreaterThan(0.02);
  });

  it('呼吸缩放对称且幅度更小', () => {
    let min = Infinity;
    let max = -Infinity;
    for (let t = 0; t < 10; t += 0.01) {
      const s = lungScale(t);
      min = Math.min(min, s);
      max = Math.max(max, s);
    }
    expect(min).toBeCloseTo(2 - max, 3);
    expect(max - 1).toBeLessThan(0.02);
  });

  it('动画结构表引用心与双肺', () => {
    expect(Object.keys(ANIMATED_STRUCTURES).sort()).toEqual(['heart', 'lung_left', 'lung_right']);
  });
});
