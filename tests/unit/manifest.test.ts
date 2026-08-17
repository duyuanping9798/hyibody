import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertManifest } from '../../src/data/manifest';

describe('manifest', () => {
  it('接受仓库内的 public/assets/manifest.json', () => {
    const raw = readFileSync(resolve(__dirname, '../../public/assets/manifest.json'), 'utf8');
    const json: unknown = JSON.parse(raw);
    expect(() => assertManifest(json)).not.toThrow();
  });

  it('拒绝缺字段的 manifest', () => {
    expect(() => assertManifest(null)).toThrow();
    expect(() => assertManifest({})).toThrow();
    expect(() => assertManifest({ version: '1', systems: [], structures: {} })).toThrow();
    expect(() =>
      assertManifest({ version: '1', systems: [{ id: 'skin' }], structures: {}, attribution: [] }),
    ).toThrow();
  });
});
