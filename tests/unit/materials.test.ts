import { describe, expect, it } from 'vitest';
import { colorForStructure, SYSTEM_COLORS } from '../../src/viewer/materials';

describe('materials: 结构配色', () => {
  it('静脉走蓝、动脉走红', () => {
    const vein = colorForStructure('vessels', 'Great saphenous vein');
    const artery = colorForStructure('vessels', 'Aorta');
    expect(vein).toBe(0x4a6fd6);
    expect(artery).toBe(SYSTEM_COLORS.vessels);
  });

  it('同一 key 配色稳定，不同 key 之间有区分度', () => {
    const a = colorForStructure('muscles', 'Deltoid', 'deltoid');
    expect(colorForStructure('muscles', 'Deltoid', 'deltoid')).toBe(a);
    expect(colorForStructure('muscles', 'Trapezius', 'trapezius')).not.toBe(a);
  });

  it('抖动幅度小，仍认得出是系统色', () => {
    const base = SYSTEM_COLORS.muscles;
    for (const slug of ['deltoid', 'trapezius', 'sartorius', 'biceps_brachii']) {
      const c = colorForStructure('muscles', slug, slug);
      for (const shift of [16, 8, 0]) {
        const delta = Math.abs(((c >> shift) & 0xff) - ((base >> shift) & 0xff));
        expect(delta).toBeLessThan(40);
      }
    }
  });
});
