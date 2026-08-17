import { describe, expect, it } from 'vitest';
import en from '../../content/i18n/en.json';
import zh from '../../content/i18n/zh.json';

function keyTree(obj: unknown, prefix = ''): string[] {
  if (typeof obj !== 'object' || obj === null) return [prefix];
  return Object.entries(obj).flatMap(([k, v]) => keyTree(v, prefix ? `${prefix}.${k}` : k));
}

describe('i18n 键一致性（中英切换的契约）', () => {
  it('zh 与 en 键集完全一致', () => {
    expect(keyTree(en).sort()).toEqual(keyTree(zh).sort());
  });

  it('所有文案非空字符串', () => {
    for (const [name, data] of [
      ['zh', zh],
      ['en', en],
    ] as const) {
      for (const key of keyTree(data)) {
        const value = key
          .split('.')
          .reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], data);
        expect(typeof value, `${name}.${key}`).toBe('string');
        expect((value as string).length, `${name}.${key} 为空`).toBeGreaterThan(0);
      }
    }
  });
});
