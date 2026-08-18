import { Box3, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { clipConstant, clipPlaneFor, clipPosForCoordinate } from '../../src/viewer/clipping';

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

describe('clipPosForCoordinate: 沿结构半剖', () => {
  it('与 clipConstant 互逆', () => {
    const [min, max] = [-860, 860];
    for (const pos of [-1, -0.4, 0, 0.37, 1]) {
      const coord = clipConstant(pos, min, max);
      expect(clipPosForCoordinate(coord, min, max)).toBeCloseTo(pos, 6);
    }
  });

  it('心脏中心（世界 z=440）落在包围盒中上部', () => {
    const pos = clipPosForCoordinate(440, -860, 860);
    expect(pos).toBeGreaterThan(0);
    expect(pos).toBeLessThan(1);
  });

  it('超出包围盒时钳到两端，退化包围盒返回 0', () => {
    expect(clipPosForCoordinate(9999, -860, 860)).toBe(1);
    expect(clipPosForCoordinate(-9999, -860, 860)).toBe(-1);
    expect(clipPosForCoordinate(5, 10, 10)).toBe(0);
  });
});
