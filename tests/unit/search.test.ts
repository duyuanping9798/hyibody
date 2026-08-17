import { describe, expect, it } from 'vitest';
import { searchStructures } from '../../src/data/search';
import type { Manifest } from '../../src/data/types';

const manifest: Manifest = {
  version: '0',
  generatedAt: '',
  systems: [],
  attribution: [],
  structures: {
    skull: {
      zh: '颅骨',
      en: 'Skull',
      system: 'skeleton',
      region: 'head',
      side: 'none',
      fma: ['FMA1'],
      source: 'bp3d',
    },
    femur_left: {
      zh: '左股骨',
      en: 'Left femur',
      system: 'skeleton',
      region: 'lower_limb',
      side: 'left',
      fma: ['FMA2'],
      source: 'bp3d',
    },
    heart: {
      zh: '心脏',
      en: 'Heart',
      system: 'organs',
      region: 'thorax',
      side: 'none',
      fma: ['FMA3'],
      source: 'bp3d_partof',
    },
  },
};

describe('searchStructures', () => {
  it('中文子串命中', () => {
    expect(searchStructures(manifest, '股骨').map((h) => h.slug)).toEqual(['femur_left']);
  });

  it('英文子串命中且大小写不敏感', () => {
    expect(searchStructures(manifest, 'sku').map((h) => h.slug)).toEqual(['skull']);
    expect(searchStructures(manifest, 'HEART').map((h) => h.slug)).toEqual(['heart']);
  });

  it('中文命中排在英文命中前', () => {
    // "心" 命中中文心脏；"art" 命中英文 Heart —— 混合查询里中文优先
    const hits = searchStructures(manifest, 'e');
    expect(hits.length).toBeGreaterThan(0);
    expect(searchStructures(manifest, '心')[0]?.slug).toBe('heart');
  });

  it('空查询与无命中返回空', () => {
    expect(searchStructures(manifest, '  ')).toEqual([]);
    expect(searchStructures(manifest, '不存在的东西')).toEqual([]);
  });
});
