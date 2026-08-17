import { Box3, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { clipConstant, clipPlaneFor } from '../../src/viewer/clipping';

describe('clipping', () => {
  it('clipConstant 把 [-1,1] 映射到 [min,max]', () => {
    expect(clipConstant(-1, 0, 100)).toBe(0);
    expect(clipConstant(0, 0, 100)).toBe(50);
    expect(clipConstant(1, 0, 100)).toBe(100);
    expect(clipConstant(5, 0, 100)).toBe(100); // 越界钳制
  });

  it('clipPlaneFor 保留切面负侧（pos=1 完全不切）', () => {
    const box = new Box3(new Vector3(-100, -100, -100), new Vector3(100, 100, 100));
    const plane = clipPlaneFor('x', 0, box);
    // 法线 -x：x=−50 的点在保留侧（distance > 0），x=+50 被切掉
    expect(plane.distanceToPoint(new Vector3(-50, 0, 0))).toBeGreaterThan(0);
    expect(plane.distanceToPoint(new Vector3(50, 0, 0))).toBeLessThan(0);
    // pos=1 时全部保留
    const open = clipPlaneFor('x', 1, box);
    expect(open.distanceToPoint(new Vector3(99, 0, 0))).toBeGreaterThan(0);
  });
});
