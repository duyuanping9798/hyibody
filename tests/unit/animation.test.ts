import { describe, expect, it } from 'vitest';
import {
  ANIMATED_STRUCTURES,
  heartScale,
  lungScale,
  pulseTransform,
} from '../../src/viewer/animation';

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

describe('pulseTransform: 微动画必须叠加在量化基准变换之上', () => {
  // 肺的真实数值：glb 节点自带 translation + scale 116.7（KHR_mesh_quantization 的反量化）
  const base = {
    position: { x: 73.14, y: 1.81, z: 452.56 },
    scale: 116.71,
    center: { x: 0.02, y: -0.05, z: 0.01 },
  };

  it('s = 1 时原样返回基准变换', () => {
    const out = pulseTransform(base, 1);
    expect(out.scale).toBeCloseTo(116.71, 5);
    expect(out.position.x).toBeCloseTo(73.14, 5);
    expect(out.position.z).toBeCloseTo(452.56, 5);
  });

  it('缩放乘在基准缩放上，绝不覆盖它', () => {
    // 曾经直接 mesh.scale.setScalar(s)，把 116.7 写成 ~1，
    // 心脏和双肺被缩到百分之一、塞回原点，胸腔看着是空的
    const out = pulseTransform(base, 1.02);
    expect(out.scale).toBeCloseTo(116.71 * 1.02, 4);
    expect(out.scale).toBeGreaterThan(100);
  });

  it('几何中心在缩放前后停在同一世界坐标', () => {
    const worldCenter = (t: { position: { x: number }; scale: number }) =>
      t.position.x + base.center.x * t.scale;
    const before = worldCenter({ position: base.position, scale: base.scale });
    for (const s of [0.97, 1, 1.03]) {
      expect(worldCenter(pulseTransform(base, s))).toBeCloseTo(before, 6);
    }
  });

  it('结构离原点越远，位移补偿越不能省（回归保护）', () => {
    const out = pulseTransform(base, 0.97);
    // 位移只有零点几毫米级，绝不会把器官甩到别处
    expect(Math.abs(out.position.z - base.position.z)).toBeLessThan(1);
  });
});
