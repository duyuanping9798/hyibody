import { describe, expect, it } from 'vitest';
import { attractLayer } from '../../src/viewer/animation';

describe('Kiosk 吸引动画分层扫描', () => {
  it('范围在 0–1，端点有停留', () => {
    expect(attractLayer(0)).toBe(0);
    expect(attractLayer(3.9)).toBe(0); // 起点停留 4s
    expect(attractLayer(22)).toBe(1);
    expect(attractLayer(25.9)).toBe(1); // 峰值停留 4s
    for (let t = 0; t < 90; t += 0.25) {
      const v = attractLayer(t);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('44 秒周期循环', () => {
    for (const t of [0, 7, 13, 22, 30, 40]) {
      expect(attractLayer(t + 44)).toBeCloseTo(attractLayer(t), 6);
    }
  });

  it('中段单调上升', () => {
    expect(attractLayer(10)).toBeGreaterThan(attractLayer(6));
    expect(attractLayer(16)).toBeGreaterThan(attractLayer(10));
  });
});
