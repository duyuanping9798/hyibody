import { describe, expect, it } from 'vitest';
import {
  computeAllOpacities,
  computeSystemOpacity,
  HOME_STOPS,
  materializeMix,
} from '../../src/viewer/layers';

/** 六个主场的真实值。独立于 HOME_STOPS 手抄一份作交叉校验（实现抄错任何一边都会红）。 */
const STOPS = {
  skin: 0,
  muscles: 0.2,
  skeleton: 0.45,
  organs: 0.62,
  vessels: 0.8,
  nerves: 1,
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
        expect(
          computeSystemOpacity(other, at),
          `在「${lead}」刻度上 ${other} 不该比主角更实`,
        ).toBeLessThan(mine);
      }
    }
  });

  // 血管与神经原来共用 0.85、曲线一模一样：拖到那儿两层一起满档，
  // 而滑块上再没有一个位置能单独看神经。人类："要细化控制效果"。
  it('血管与神经各有各的刻度，互不遮挡', () => {
    expect(computeSystemOpacity('vessels', STOPS.vessels)).toBe(1);
    expect(computeSystemOpacity('nerves', STOPS.nerves)).toBe(1);
    // 在对方的主场上都要让到拾取阈值以下，否则点神经会命中伴行的动脉
    expect(computeSystemOpacity('nerves', STOPS.vessels)).toBeLessThan(0.15);
    expect(computeSystemOpacity('vessels', STOPS.nerves)).toBeLessThan(0.15);
    // 但都不是 0——神经血管束本来就走在一起，留一点当伴行参照
    expect(computeSystemOpacity('nerves', STOPS.vessels)).toBeGreaterThan(0);
    expect(computeSystemOpacity('vessels', STOPS.nerves)).toBeGreaterThan(0);
  });

  // 真 bug 的回归锁。原来这条测试写的是"骨骼始终可见；主场之后淡化但**不低于 0.35**"
  // ——它锁住的正是那个 bug：骨骼曲线最后一点是 [0.58, 0.35]，而插值函数对超出末点的
  // 值直接返回末点，于是骨骼从 0.58 起再也不消失。人类实测："控制条拉到器官的时候
  // 骨骼还是没有消失挡住了器官。"**测试在守护 bug，所以它红了才是对的。**
  it('每一层轮完之后都要回到 0——包括骨骼', () => {
    expect(computeSystemOpacity('skin', 0.2)).toBe(0);
    expect(computeSystemOpacity('muscles', 0.45)).toBe(0);
    expect(computeSystemOpacity('skeleton', 0.8)).toBe(0);
    expect(computeSystemOpacity('skeleton', 1)).toBe(0);
    expect(computeSystemOpacity('organs', 1)).toBe(0);
  });

  it('轮到之前单调递增，轮过之后单调递减', () => {
    const rising = [0, 0.1, 0.2, 0.3, 0.45].map((l) => computeSystemOpacity('skeleton', l));
    for (let i = 1; i < rising.length; i += 1) {
      expect(rising[i]!).toBeGreaterThanOrEqual(rising[i - 1]!);
    }
    const falling = [0.45, 0.55, 0.62, 0.75, 0.8, 1].map((l) =>
      computeSystemOpacity('skeleton', l),
    );
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

  // 拖到任何位置都得有东西看。两个刻度中间是交叉淡入淡出，没有哪一层是满的，
  // 但主角必须明显高过拾取阈值，否则那一段既看不清也点不中。
  it('整条滑块上都有一个明确的主角，不存在"哪儿都不是"的空档', () => {
    for (let l = 0; l <= 1.0001; l += 0.02) {
      const o = computeAllOpacities(Math.min(1, l));
      const max = Math.max(...Object.values(o));
      expect(max, `layer=${l.toFixed(2)} 时最实的一层只有 ${max.toFixed(2)}`).toBeGreaterThan(0.45);
    }
  });

  it('滑块越界值被钳制', () => {
    expect(computeSystemOpacity('skin', -1)).toBe(1);
    expect(computeSystemOpacity('skin', 2)).toBe(0);
  });

  // 2026-08-22 控制条改六个独立推子之后，这张表成了"点名字跳主场"的跳转目标，
  // 也是搜索选中后"挪到看得清的位置"的落点——它必须与曲线峰值严格一致。
  // store.ts 里那份手抄的 HOME_LAYER 正是因为抄旧了（nerves 0.8 上神经只有 0.1）
  // 才合并到这里的。
  it('HOME_STOPS 的每个主场上曲线都是满档 1', () => {
    for (const [system, at] of Object.entries(HOME_STOPS) as [keyof typeof HOME_STOPS, number][]) {
      expect(computeSystemOpacity(system, at), `${system} 的主场不在曲线峰值上`).toBe(1);
    }
  });

  it('materializeMix 把"曲线 × 倍率"原样固化——切换瞬间画面不许动', () => {
    const manual = { skin: 1, muscles: 0.5, skeleton: 1, organs: 1, vessels: 1, nerves: 1 };
    const mix = materializeMix(0.45, manual);
    for (const system of ['skin', 'muscles', 'skeleton', 'organs', 'vessels', 'nerves'] as const) {
      expect(mix[system]).toBeCloseTo(computeSystemOpacity(system, 0.45) * manual[system], 10);
    }
  });
});
