import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

describe('palette: 逐结构配色表（content/palette.json）', () => {
  const palette = JSON.parse(
    readFileSync(resolve(__dirname, '../../content/palette.json'), 'utf8'),
  ) as Record<string, unknown>;
  const manifest = JSON.parse(
    readFileSync(resolve(__dirname, '../../public/assets/manifest.json'), 'utf8'),
  ) as { structures: Record<string, unknown> };

  const entries = Object.entries(palette).filter(([slug]) => !slug.startsWith('_'));

  it('每个键都是真实存在的结构 slug（防止改名后配色悄悄失效）', () => {
    const unknown = entries.map(([slug]) => slug).filter((slug) => !manifest.structures[slug]);
    expect(unknown, `配色表里有不存在的结构：${unknown.join(', ')}`).toEqual([]);
  });

  it('颜色都是合法的 #rrggbb', () => {
    for (const [slug, value] of entries) {
      expect(typeof value, `${slug} 应为字符串`).toBe('string');
      expect(String(value), `${slug} 颜色格式`).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it('配色表优先于系统色，未收录的结构仍走系统色抖动', () => {
    expect(colorForStructure('organs', 'Heart', 'heart')).toBe(0xa83f3d);
    expect(colorForStructure('organs', 'Liver', 'liver')).toBe(0x8f4a35);
    // 未收录：落回系统色附近
    const fallback = colorForStructure('organs', 'Whatever', 'not_in_palette');
    expect(
      Math.abs(((fallback >> 16) & 0xff) - ((SYSTEM_COLORS.organs >> 16) & 0xff)),
    ).toBeLessThan(40);
  });
});
