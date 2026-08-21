import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertManifest } from '../../src/data/manifest';
import { BACKGROUND_ORDER, FIRST_SCREEN_SYSTEMS } from '../../src/viewer/loadOrder';
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
      // 许可证铁律：每个结构都要留一个本体 id。BP3D 没有的概念（室间隔）
      // 用 HRA 给的 UBERON 顶上，两者都没有才算缺
      expect(
        info.fma.length > 0 || Boolean(info.uberon),
        `${slug} 既没有 fma 也没有 uberon（许可证铁律）`,
      ).toBe(true);
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
    // 首屏是哪些系统，只认 loadOrder.ts 那一份。这里以前硬编码 skin+skeleton，
    // 2026-08-21 把骨骼挪出首屏时忘了改，于是这条测试继续按"皮肤+骨骼"量，
    // 量的是另一回事——它当时确实红了，但红的理由是"多算了 4.9 MB"。
    const firstScreen = manifest.systems
      .filter((s) => (FIRST_SCREEN_SYSTEMS as readonly string[]).includes(s.id))
      .reduce((sum, s) => sum + s.bytes, manifestBytes);
    expect(firstScreen).toBeLessThanOrEqual(5_000_000);
    expect(total).toBeLessThanOrEqual(40_000_000);
  });

  it.runIf(isPipeline)('后台补载顺序覆盖了除首屏之外的每一个系统', () => {
    // 漏一个系统不会报错，只会让它排到队尾——是那种"慢一点但看不出错"的 bug
    const rest = manifest.systems
      .map((s) => s.id)
      .filter((id) => !(FIRST_SCREEN_SYSTEMS as readonly string[]).includes(id));
    for (const id of rest) expect(BACKGROUND_ORDER as readonly string[], id).toContain(id);
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

  /**
   * 层级最多三层：脑 → 大脑 → 额叶。
   *
   * 原来卡死在一层。2026-08-20 补颅骨分块与脑叶时放宽到三层，配套改了两处：
   * `HyiViewer.coversExpanded` 让展开项的**所有祖先**一起让位（只让一级的话，
   * 钻进「大脑」时外面那层「脑」会重新罩上来），`store.collapseParts` 收起时
   * 退一级而不是直接回全身。再深就没人跟得住了，所以上限留在三层。
   */
  it('层级最多三层，且不成环', () => {
    for (const [slug, info] of Object.entries(structures)) {
      if (!info.parent) continue;
      const chain: string[] = [];
      let cursor: string | undefined = info.parent;
      while (cursor) {
        expect(chain, `${slug} 的父结构链成环`).not.toContain(cursor);
        chain.push(cursor);
        expect(
          chain.length,
          `${slug} 的父结构链超过三层：${chain.join(' → ')}`,
        ).toBeLessThanOrEqual(2);
        cursor = structures[cursor]?.parent;
      }
    }
  });

  it('心脏带出了内部件（心腔/瓣膜等）', () => {
    const children = Object.entries(structures).filter(([, s]) => s.parent === 'heart');
    expect(children.length).toBeGreaterThanOrEqual(4);
    expect(children.map(([slug]) => slug)).toContain('heart_left_ventricle');
    // 四个瓣膜都在，心脏才算真打开了
    for (const valve of ['mitral', 'tricuspid', 'aortic', 'pulmonary']) {
      expect(children.map(([slug]) => slug)).toContain(`heart_${valve}_valve`);
    }
  });
});
