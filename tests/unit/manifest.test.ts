import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertManifest } from '../../src/data/manifest';
import type { Manifest } from '../../src/data/types';
import { SYSTEM_IDS } from '../../src/data/types';

const assetsDir = resolve(__dirname, '../../public/assets');

function loadRealManifest(): Manifest {
  const raw = readFileSync(resolve(assetsDir, 'manifest.json'), 'utf8');
  const json: unknown = JSON.parse(raw);
  assertManifest(json);
  return json;
}

describe('manifest', () => {
  it('接受仓库内的 public/assets/manifest.json', () => {
    expect(() => loadRealManifest()).not.toThrow();
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

// 流水线产物契约（issue #5）：manifest 与 glb 文件互相一致、预算达标、署名齐全。
// 占位 manifest（M0 回退路径）跳过这些断言。
describe('流水线产物契约', () => {
  const manifest = loadRealManifest();
  const isPipeline = manifest.systems[0]?.id !== 'placeholder';

  it.runIf(isPipeline)('系统 glb 文件存在且字节数一致', () => {
    for (const system of manifest.systems) {
      const file = resolve(assetsDir, system.file.replace(/^assets\//, ''));
      expect(statSync(file).size, system.file).toBe(system.bytes);
      expect(SYSTEM_IDS).toContain(system.id);
    }
  });

  it.runIf(isPipeline)('系统与结构互相对应，fma 保留', () => {
    const listed = new Set(manifest.systems.flatMap((s) => s.structures));
    const defined = new Set(Object.keys(manifest.structures));
    expect([...listed].sort()).toEqual([...defined].sort());
    for (const [slug, info] of Object.entries(manifest.structures)) {
      expect(info.fma.length, `${slug} 缺 fma（许可证铁律）`).toBeGreaterThan(0);
      expect(info.zh, slug).toBeTruthy();
      expect(info.en, slug).toBeTruthy();
    }
  });

  it.runIf(isPipeline)('bbox 为毫米级人体尺度', () => {
    for (const [slug, info] of Object.entries(manifest.structures)) {
      if (!info.bbox) continue;
      expect(info.bbox, slug).toHaveLength(6);
      for (const v of info.bbox)
        expect(Math.abs(v), `${slug} bbox 超出人体尺度`).toBeLessThan(2000);
    }
  });

  it.runIf(isPipeline)('体积预算：首屏 ≤ 5 MB，全部 ≤ 40 MB', () => {
    const manifestBytes = statSync(resolve(assetsDir, 'manifest.json')).size;
    const total = manifest.systems.reduce((sum, s) => sum + s.bytes, manifestBytes);
    const firstScreen = manifest.systems
      .filter((s) => s.id === 'skin' || s.id === 'skeleton')
      .reduce((sum, s) => sum + s.bytes, manifestBytes);
    expect(firstScreen).toBeLessThanOrEqual(5_000_000);
    expect(total).toBeLessThanOrEqual(40_000_000);
  });

  it.runIf(isPipeline)('attribution 含 BodyParts3D 署名', () => {
    expect(manifest.attribution.some((a) => a.includes('BodyParts3D'))).toBe(true);
  });
});

describe('manifest: 内部件层级（parent）', () => {
  const structures = loadRealManifest().structures as unknown as Record<
    string,
    { system: string; parent?: string; zh: string }
  >;

  it('每个 parent 都指向真实存在、同系统的结构', () => {
    for (const [slug, info] of Object.entries(structures)) {
      if (!info.parent) continue;
      const parent = structures[info.parent];
      expect(parent, `${slug} 的父结构 ${info.parent} 不存在`).toBeTruthy();
      expect(parent!.system, `${slug} 与父结构不在同一系统`).toBe(info.system);
    }
  });

  it('层级只有一层（父结构自己不能再有 parent）', () => {
    for (const [slug, info] of Object.entries(structures)) {
      if (!info.parent) continue;
      expect(structures[info.parent]?.parent, `${slug} 的层级超过一层`).toBeUndefined();
    }
  });

  it('心脏带出了内部件（心室壁/瓣膜等）', () => {
    const children = Object.entries(structures).filter(([, s]) => s.parent === 'heart');
    expect(children.length).toBeGreaterThanOrEqual(4);
    expect(children.map(([slug]) => slug)).toContain('heart_ventricle_wall');
  });
});
