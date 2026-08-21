import { describe, expect, it } from 'vitest';
import { computeAllOpacities, computeSystemOpacity } from '../../src/viewer/layers';

/** 滑块上五个刻度的真实值（与 src/ui/LayerSlider.tsx 的 STOPS 一致）。 */
const STOPS = {
  skin: 0,
  muscles: 0.2,
  skeleton: 0.45,
  organs: 0.62,
  vessels: 0.85,
} as const;

describe('layers: 分层滑块 → 系统不透明度（KICKOFF 第 6 节）', () => {
  it('layer=0 是一层干净的皮肤，滑一点点内层才开始透出来', () => {
    const o = computeAllOpacities(0);
    expect(o.skin).toBe(1);
    for (const system of ['muscles', 'skeleton', 'organs', 'vessels', 'nerves'] as const) {
      expect(o[system]).toBe(0);
    }
    // 滑块一动，底噪立刻到位——不是拖到主场才出现
    const o2 = computeAllOpacities(0.05);
    for (const system of ['muscles', 'skeleton', 'organs', 'vessels', 'nerves'] as const) {
      expect(o2[system]).toBeGreaterThan(0);
      expect(o2[system]).toBeLessThanOrEqual(0.3);
    }
  });

  // 这一条是这组测试的核心契约，也是 2026-08-21 人类实测反馈的直接来源：
  // **拖到哪个刻度，就该看到哪一层**。改之前完全不是这样——
  //   拖到「肌肉」：肌肉 0.60，而骨骼 0.71、器官 0.70 都比它更实
  //   拖到「骨骼」：骨骼 0.75，而器官是 1.00
  // 名字写在刻度上，交出来的却是别的东西。
  it('每个刻度上，那一层是满的，外面的层归零', () => {
    for (const [system, at] of Object.entries(STOPS) as [keyof typeof STOPS, number][]) {
      expect(computeSystemOpacity(system, at), `${system} 在自己的刻度上应满档`).toBe(1);
    }
    // 外层在轮到内层时必须彻底让位，不能半亮着挡在前面
    expect(computeSystemOpacity('skin', STOPS.muscles)).toBe(0);
    expect(computeSystemOpacity('muscles', STOPS.skeleton)).toBe(0);
    expect(computeSystemOpacity('skeleton', STOPS.vessels)).toBe(0);
  });

  it('每个刻度上，主角比任何配角都实', () => {
    const systems = ['skin', 'muscles', 'skeleton', 'organs', 'vessels', 'nerves'] as const;
    for (const [lead, at] of Object.entries(STOPS) as [keyof typeof STOPS, number][]) {
      const mine = computeSystemOpacity(lead, at);
      for (const other of systems) {
        if (other === lead) continue;
        // 血管与神经共用一个刻度，互为平手
        if (lead === 'vessels' && other === 'nerves') continue;
        expect(
          computeSystemOpacity(other, at),
          `在「${lead}」刻度上 ${other} 不该比主角更实`,
        ).toBeLessThan(mine);
      }
    }
  });

  // 真 bug 的回归锁。原来这条测试写的是"骨骼始终可见；主场之后淡化但**不低于 0.35**"
  // ——它锁住的正是那个 bug：骨骼曲线最后一点是 [0.58, 0.35]，而插值函数对超出末点的
  // 值直接返回末点，于是骨骼从 0.58 起再也不消失。人类实测："控制条拉到器官的时候
  // 骨骼还是没有消失挡住了器官。"**测试在守护 bug，所以它红了才是对的。**
  it('每一层轮完之后都要回到 0——包括骨骼', () => {
    expect(computeSystemOpacity('skin', 0.2)).toBe(0);
    expect(computeSystemOpacity('muscles', 0.45)).toBe(0);
    expect(computeSystemOpacity('skeleton', 0.85)).toBe(0);
    expect(computeSystemOpacity('skeleton', 1)).toBe(0);
    expect(computeSystemOpacity('organs', 1)).toBe(0);
  });

  it('轮到之前单调递增，轮过之后单调递减', () => {
    const rising = [0, 0.1, 0.2, 0.3, 0.45].map((l) => computeSystemOpacity('skeleton', l));
    for (let i = 1; i < rising.length; i += 1) {
      expect(rising[i]!).toBeGreaterThanOrEqual(rising[i - 1]!);
    }
    const falling = [0.45, 0.55, 0.62, 0.75, 0.85].map((l) => computeSystemOpacity('skeleton', l));
    for (let i = 1; i < falling.length; i += 1) {
      expect(falling[i]!).toBeLessThanOrEqual(falling[i - 1]!);
    }
  });

  it('里层在轮到之前留一点点当空间参照，但低于拾取阈值', () => {
    // 「器官」刻度上还留一点骨骼，是为了让器官有个笼子可参照；
    // 但要低于 PICKABLE_OPACITY_THRESHOLD(0.15)，否则点器官会命中肋骨——
    // 人类实测过的另一条："点击身体只显示皮肤，没办法选中皮肤下的器官"。
    const ribsAtOrgans = computeSystemOpacity('skeleton', STOPS.organs);
    expect(ribsAtOrgans).toBeGreaterThan(0);
    expect(ribsAtOrgans).toBeLessThan(0.15);
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
