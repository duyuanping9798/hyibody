import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { REGION_ORDER, viewsByRegion, type AtlasView } from '../../src/data/views';
import { computeSystemOpacity, PICKABLE_OPACITY_THRESHOLD } from '../../src/viewer/layers';
import type { SystemId } from '../../src/data/types';

const DIR = join(process.cwd(), 'content/views');
const MANIFEST = JSON.parse(
  readFileSync(join(process.cwd(), 'public/assets/manifest.json'), 'utf8'),
) as { structures: Record<string, { system: SystemId; zh: string }> };

const VIEWS: AtlasView[] = readdirSync(DIR)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((f) => JSON.parse(readFileSync(join(DIR, f), 'utf8')) as AtlasView);

const PRESETS = ['front', 'back', 'left', 'right', 'top', 'hero'];

describe('局部细剖视图（content/views）', () => {
  it('有内容，而且 id 与文件名对得上', () => {
    expect(VIEWS.length).toBeGreaterThanOrEqual(20);
    const files = readdirSync(DIR).filter((f) => f.endsWith('.json'));
    for (const f of files) {
      const v = JSON.parse(readFileSync(join(DIR, f), 'utf8')) as AtlasView;
      expect(`${v.id}.json`, `${f} 的 id 与文件名不一致`).toBe(f);
    }
    expect(new Set(VIEWS.map((v) => v.id)).size, 'id 有重复').toBe(VIEWS.length);
  });

  it('中英标题都写了', () => {
    for (const v of VIEWS) {
      expect(v.title.zh.trim(), `${v.id} 缺中文标题`).not.toBe('');
      expect(v.title.en.trim(), `${v.id} 缺英文标题`).not.toBe('');
    }
  });

  it('部位与系统都是合法值', () => {
    for (const v of VIEWS) {
      expect(REGION_ORDER, `${v.id} 的 region=${v.region} 不认识`).toContain(v.region);
      expect(
        ['skin', 'muscles', 'skeleton', 'organs', 'vessels', 'nerves'],
        `${v.id} 的 system=${v.system} 不认识`,
      ).toContain(v.system);
    }
  });

  // 这一条是真会出事的：写错一个 slug，卡片点下去画面什么都不会发生，
  // 而且不报错——只是安静地什么都不选中。
  it('selected / expand 指到的结构必须在 manifest 里', () => {
    for (const v of VIEWS) {
      for (const key of ['selected', 'expand'] as const) {
        const slug = v.view[key];
        if (!slug) continue;
        expect(
          MANIFEST.structures[slug],
          `${v.id} 的 ${key}=${slug} 不在 manifest 里`,
        ).toBeTruthy();
      }
    }
  });

  it('from / preset 只能用那六个视角', () => {
    for (const v of VIEWS) {
      if (v.view.from) expect(PRESETS, `${v.id} 的 from`).toContain(v.view.from);
      if (v.view.preset) expect(PRESETS, `${v.id} 的 preset`).toContain(v.view.preset);
    }
  });

  it('layer 在 0–1 之间', () => {
    for (const v of VIEWS) {
      expect(v.view.layer, `${v.id} 的 layer`).toBeGreaterThanOrEqual(0);
      expect(v.view.layer, `${v.id} 的 layer`).toBeLessThanOrEqual(1);
    }
  });

  // 卡片上写着「胸廓」，点进去主角却是半透明的——这是分层曲线与内容脱钩的
  // 老毛病（2026-08-21 那 27 个奥秘步骤就是这么红的）。这里提前锁住。
  it('主角在该视图的分层下看得见，也点得中', () => {
    for (const v of VIEWS) {
      const slug = v.view.selected;
      if (!slug) continue;
      const system = MANIFEST.structures[slug]!.system;
      // systems 覆盖里明确关掉/压暗的，以覆盖值为准
      const override = v.view.systems?.[system];
      if (override === false) {
        throw new Error(`${v.id} 把主角所在的 ${system} 关掉了`);
      }
      const base = computeSystemOpacity(system, v.view.layer);
      const opacity = typeof override === 'number' ? override : base;
      expect(
        opacity,
        `${v.id} 的主角 ${slug}（${system}）在 layer=${v.view.layer} 下只有 ${opacity.toFixed(2)}`,
      ).toBeGreaterThan(PICKABLE_OPACITY_THRESHOLD);
    }
  });

  it('按部位分组不丢条目，且只列有内容的部位', () => {
    const groups = viewsByRegion(VIEWS);
    const total = groups.reduce((n, g) => n + g.items.length, 0);
    expect(total).toBe(VIEWS.length);
    for (const g of groups) expect(g.items.length).toBeGreaterThan(0);
    // 顺序按 REGION_ORDER，不是按字母
    const order = groups.map((g) => g.region);
    expect(order).toEqual(REGION_ORDER.filter((r) => order.includes(r)));
  });
});
