import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { applyDrift, CINEMATIC_FLIGHT, DIRECT_FLIGHT, EASINGS } from '../../src/viewer/cinematic';
import { splitClauses } from '../../src/wonders/caption';

const LIMITS = { minDistance: 25, maxDistance: 8000 };

function camAt(x: number, y: number, z: number): PerspectiveCamera {
  const cam = new PerspectiveCamera(38, 1, 1, 20000);
  cam.position.set(x, y, z);
  return cam;
}

describe('cinematic: 缓动曲线', () => {
  it('每条曲线都从 0 走到 1', () => {
    for (const [id, fn] of Object.entries(EASINGS)) {
      expect(fn(0), id).toBeCloseTo(0, 6);
      expect(fn(1), id).toBeCloseTo(1, 6);
    }
  });

  it('inOutCubic 两头慢、中间快——这正是它比 outCubic 适合奥秘的原因', () => {
    const io = EASINGS.inOutCubic;
    const out = EASINGS.outCubic;
    // 起步阶段：outCubic 已经冲出去一大截，inOutCubic 还没动
    expect(io(0.1)).toBeLessThan(out(0.1));
    // 中点两者都在一半
    expect(io(0.5)).toBeCloseTo(0.5, 6);
    // 收尾阶段：inOutCubic 还没到，outCubic 已经贴住终点
    expect(io(0.9)).toBeLessThan(out(0.9));
  });
});

describe('cinematic: 运镜微动作', () => {
  const target = new Vector3(0, 0, 0);

  it('still 什么都不做', () => {
    const cam = camAt(0, -1000, 0);
    expect(applyDrift(cam, target, 'still', 0.016, LIMITS)).toBe(false);
    expect(cam.position.y).toBe(-1000);
  });

  it('push 拉近、pull 推远，方向不变', () => {
    const push = camAt(0, -1000, 0);
    applyDrift(push, target, 'push', 1, LIMITS);
    expect(push.position.length()).toBeLessThan(1000);
    expect(push.position.x).toBeCloseTo(0, 6);

    const pull = camAt(0, -1000, 0);
    applyDrift(pull, target, 'pull', 1, LIMITS);
    expect(pull.position.length()).toBeGreaterThan(1000);
  });

  it('推拉都夹在轨道控制器的上下限里，不会穿进结构内部或退到天边', () => {
    const near = camAt(0, -LIMITS.minDistance, 0);
    // 一秒的量不够顶到底，给一个夸张的 dt 逼它撞上限
    applyDrift(near, target, 'push', 100, LIMITS);
    expect(near.position.length()).toBeGreaterThanOrEqual(LIMITS.minDistance - 1e-6);

    const far = camAt(0, -LIMITS.maxDistance, 0);
    applyDrift(far, target, 'pull', 100, LIMITS);
    expect(far.position.length()).toBeLessThanOrEqual(LIMITS.maxDistance + 1e-6);
  });

  it('orbit 绕世界 Z 轴转，距离与高度都不变', () => {
    const cam = camAt(0, -1000, 300);
    const before = cam.position.length();
    applyDrift(cam, target, 'orbit', 1, LIMITS);
    expect(cam.position.length()).toBeCloseTo(before, 4);
    expect(cam.position.z).toBeCloseTo(300, 6);
    expect(cam.position.x).not.toBeCloseTo(0, 3);
  });

  it('orbitBack 就是 orbit 反着走', () => {
    const a = camAt(0, -1000, 0);
    const b = camAt(0, -1000, 0);
    applyDrift(a, target, 'orbit', 1, LIMITS);
    applyDrift(b, target, 'orbitBack', 1, LIMITS);
    expect(a.position.x).toBeCloseTo(-b.position.x, 4);
  });

  it('rise 抬高、sink 压低，距离不变', () => {
    const rise = camAt(0, -1000, 0);
    const before = rise.position.length();
    applyDrift(rise, target, 'rise', 1, LIMITS);
    expect(rise.position.z).toBeGreaterThan(0);
    expect(rise.position.length()).toBeCloseTo(before, 4);

    const sink = camAt(0, -1000, 0);
    applyDrift(sink, target, 'sink', 1, LIMITS);
    expect(sink.position.z).toBeLessThan(0);
  });

  it('升降不会翻过头顶——顶住之后就不再动', () => {
    // 几乎正上方，再往上就要翻过去了
    const cam = camAt(0, -1, 1000);
    for (let i = 0; i < 200; i += 1) applyDrift(cam, target, 'rise', 1, LIMITS);
    expect(cam.position.z).toBeGreaterThan(0);
    // 顶住之后 applyDrift 要如实报告"没动"，否则调用方会以为画面还在变
    expect(applyDrift(cam, target, 'rise', 1, LIMITS)).toBe(false);
  });

  it('相机正好落在目标点上时不炸（除零）', () => {
    const cam = camAt(0, 0, 0);
    expect(applyDrift(cam, target, 'push', 1, LIMITS)).toBe(false);
  });
});

describe('cinematic: 两套飞行手感', () => {
  it('奥秘的比手动点选的慢，而且两头软、带抬升', () => {
    expect(CINEMATIC_FLIGHT.durationS).toBeGreaterThan(DIRECT_FLIGHT.durationS);
    expect(CINEMATIC_FLIGHT.ease).toBe('inOutCubic');
    expect(CINEMATIC_FLIGHT.arc).toBeGreaterThan(0);
    // 手动点选要跟手：不绕路，收尾软就够了
    expect(DIRECT_FLIGHT.arc).toBe(0);
    expect(DIRECT_FLIGHT.ease).toBe('outCubic');
  });
});

describe('字幕断句', () => {
  it('中文按标点断，标点跟着前一句走', () => {
    expect(splitClauses('心脏每天跳十万次，把血送到全身。')).toEqual([
      '心脏每天跳十万次，',
      '把血送到全身。',
    ]);
  });

  it('英文句点断句，但小数点不断', () => {
    expect(splitClauses('It beats 100,000 times. Blood takes 3.5 seconds.')).toEqual([
      'It beats 100,000 times.',
      'Blood takes 3.5 seconds.',
    ]);
  });

  it('没有标点就整句当一拍', () => {
    expect(splitClauses('这是一整句没有标点的话')).toEqual(['这是一整句没有标点的话']);
  });

  it('碎句并进前一句，免得字幕一顿一顿的', () => {
    // "对，" 只有两个字，单独浮现一次会显得卡
    expect(splitClauses('对，心脏就是一台泵。')).toEqual(['对，心脏就是一台泵。']);
  });

  it('空字符串不会返回空数组——调用方要么有字要么没有，不该拿到 []', () => {
    expect(splitClauses('')).toEqual(['']);
  });
});
