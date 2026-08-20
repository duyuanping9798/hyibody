import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WonderEngine, type Wonder } from '../../src/wonders/engine';
// schema 声明的是 draft 2020-12，要用 ajv 的 2020 入口，默认入口只认 draft-07
import Ajv from 'ajv/dist/2020';
import { WONDERS, wondersForStructure } from '../../src/wonders';
import { WONDER_SCHEMA, estimatedSeconds, structuresOf } from '../../src/wonders/engine';
import { clipConstant } from '../../src/viewer/clipping';
import { computeSystemOpacity } from '../../src/viewer/layers';
import type { SystemId } from '../../src/data/types';

interface StructureInfo {
  system: string;
  bbox?: [number, number, number, number, number, number];
  parent?: string;
}
const manifest = JSON.parse(
  readFileSync(resolve(__dirname, '../../public/assets/manifest.json'), 'utf8'),
) as { structures: Record<string, StructureInfo> };

const AXIS_INDEX = { x: 0, y: 1, z: 2 } as const;

/** 整具人体的包围盒——剖切滑块的 [-1,1] 就映射在它上面，不是结构自己的盒子。 */
const CONTENT_BOX = (() => {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const info of Object.values(manifest.structures)) {
    if (!info.bbox) continue;
    for (let a = 0; a < 3; a += 1) {
      lo[a] = Math.min(lo[a]!, info.bbox[a]!);
      hi[a] = Math.max(hi[a]!, info.bbox[a + 3]!);
    }
  }
  return { lo, hi };
})();

describe('奥秘内容契约', () => {
  /**
   * content/schema/wonder.schema.json 是 UGC 投稿的校验依据——内置内容自己得先合规，
   * 否则等外部作者按 schema 写出来的东西反而和内置的不是一回事。
   */
  it('每条奥秘都通过 JSON Schema 校验', () => {
    const schema = JSON.parse(
      readFileSync(resolve(__dirname, '../../content/schema/wonder.schema.json'), 'utf8'),
    );
    const validate = new Ajv({ allErrors: true, strict: false }).compile(schema);
    for (const wonder of WONDERS) {
      const ok = validate(wonder);
      const errs = (validate.errors ?? [])
        .map((e) => `${e.instancePath || '/'} ${e.message}`)
        .join('; ');
      expect(ok, `${wonder.id} 不符合 schema：${errs}`).toBe(true);
      expect(wonder.schema, `${wonder.id} 缺 schema 版本号`).toBe(WONDER_SCHEMA);
    }
  });

  it('内置奥秘按文件名自动收录，顺序稳定', () => {
    expect(WONDERS.map((t) => t.id)).toEqual([
      'aorta',
      'breathing',
      'digestion',
      'hand',
      'heartbeat',
      'nerve',
      'reach',
      'ribcage',
      'spine',
      'standing',
      'urine',
      'vision',
      'voice',
    ]);
  });

  /**
   * 有父结构的部件，必须在该步 expand 它的父结构，否则它的不透明度直接是 0
   * （HyiViewer.effectiveOpacity：`parent !== null && expanded !== parent` → 0）。
   * 「主角在该分层下可见」那条测试只看系统不透明度，漏得掉这一种看不见。
   */
  it('选中内部件的步骤必须展开它的父结构', () => {
    for (const wonder of WONDERS) {
      for (const [i, step] of wonder.steps.entries()) {
        const parent = step.selected && manifest.structures[step.selected]?.parent;
        if (!parent) continue;
        expect(
          step.expand,
          `${wonder.id}[${i}] 选中了内部件 ${step.selected}，但没有 expand 它的父结构 ${parent}，` +
            `这一步观众什么都看不到`,
        ).toBe(parent);
      }
    }
  });

  it('每条奥秘都声明了主系统与涉及的结构，且结构真实存在', () => {
    for (const wonder of WONDERS) {
      expect(wonder.system, `${wonder.id} 缺 system`).toBeTruthy();
      const slugs = structuresOf(wonder);
      expect(slugs.length, `${wonder.id} 没有声明任何结构`).toBeGreaterThan(3);
      for (const slug of slugs) {
        expect(manifest.structures[slug], `${wonder.id} 引用不存在的 ${slug}`).toBeDefined();
      }
      // 每一步点名的主角都该在声明里，否则反向索引会漏掉它
      for (const step of wonder.steps) {
        if (step.selected)
          expect(slugs, `${wonder.id} 漏声明 ${step.selected}`).toContain(step.selected);
      }
      expect(estimatedSeconds(wonder)).toBeGreaterThan(30);
    }
  });

  it('反向索引：点开结构能找到讲它的奥秘，内部件回退到父结构', () => {
    expect(wondersForStructure('heart').map((w) => w.id)).toContain('heartbeat');
    expect(wondersForStructure('liver').map((w) => w.id)).toContain('digestion');
    // 二尖瓣自己没被 heartbeat 声明时，应回退到父结构 heart 的内容
    expect(wondersForStructure('heart_tricuspid_valve', 'heart').length).toBeGreaterThan(0);
    // 没人讲到的结构就是空，不许瞎推荐
    expect(wondersForStructure('patella_left')).toEqual([]);
  });

  it('步骤字段合法且引用的结构真实存在', () => {
    for (const wonder of WONDERS) {
      expect(wonder.steps.length, wonder.id).toBeGreaterThanOrEqual(4);
      for (const [i, step] of wonder.steps.entries()) {
        const where = `${wonder.id}[${i}]`;
        expect(step.text.zh, where).toBeTruthy();
        expect(step.text.en, where).toBeTruthy();
        expect(step.layer, where).toBeGreaterThanOrEqual(0);
        expect(step.layer, where).toBeLessThanOrEqual(1);
        expect(step.durationMs, where).toBeGreaterThanOrEqual(3000);
        if (step.selected)
          expect(
            manifest.structures[step.selected],
            `${where} 引用不存在的 ${step.selected}`,
          ).toBeDefined();
        if (step.expand)
          expect(
            manifest.structures[step.expand],
            `${where} 展开不存在的 ${step.expand}`,
          ).toBeDefined();
      }
    }
  });

  /**
   * 剖切面必须真的切到主角。clip.pos ∈ [-1,1] 映射的是**整具人体**的包围盒，
   * 不是选中结构自己的——手写这个数几乎必错。心跳之旅第 4 步曾把 pos 写成 0.52，
   * 切面落在 y ≈ +76 mm，而心脏在 y ∈ [-72, 27]，整颗心被切掉，11 秒白屏。
   */
  it('带剖切的步骤，切面必须与选中结构相交', () => {
    for (const wonder of WONDERS) {
      for (const [i, step] of wonder.steps.entries()) {
        if (!step.clip || !step.selected) continue;
        const info = manifest.structures[step.selected];
        if (!info?.bbox) continue;
        const a = AXIS_INDEX[step.clip.axis];
        const cut = clipConstant(step.clip.pos, CONTENT_BOX.lo[a]!, CONTENT_BOX.hi[a]!);
        const [min, max] = [info.bbox[a]!, info.bbox[a + 3]!];
        expect(
          cut > min && cut < max,
          `${wonder.id}[${i}] 剖切面 ${step.clip.axis}=${cut.toFixed(1)} 没落在 ` +
            `${step.selected} 的 [${min.toFixed(1)}, ${max.toFixed(1)}] 里，这一步会切出空画面`,
        ).toBe(true);
      }
    }
  });

  /** 主角必须看得见：选中结构所属系统在该 layer 下不透明度得大于拾取阈值。 */
  it('每一步的主角在该分层下可见', () => {
    for (const wonder of WONDERS) {
      for (const [i, step] of wonder.steps.entries()) {
        if (!step.selected) continue;
        const info = manifest.structures[step.selected];
        if (!info) continue;
        if (step.systems?.[info.system as SystemId] === false) continue;
        const opacity = computeSystemOpacity(info.system as SystemId, step.layer);
        expect(
          opacity,
          `${wonder.id}[${i}] 主角 ${step.selected}（${info.system}）在 layer=${step.layer} 下` +
            `不透明度只有 ${opacity.toFixed(2)}，观众看不到它`,
        ).toBeGreaterThan(0.15);
      }
    }
  });

  /**
   * 相邻两步不许是同一帧。神经之旅第 4、5 步曾经完全一致，20 秒画面不动，
   * 观众会以为卡住了。至少要在 selected / expand / clip / preset / layer 里变一项。
   */
  it('相邻两步画面必须有变化', () => {
    for (const wonder of WONDERS) {
      for (let i = 1; i < wonder.steps.length; i += 1) {
        const a = wonder.steps[i - 1]!;
        const b = wonder.steps[i]!;
        const changed =
          a.selected !== b.selected ||
          a.expand !== b.expand ||
          a.preset !== b.preset ||
          JSON.stringify(a.clip ?? null) !== JSON.stringify(b.clip ?? null) ||
          JSON.stringify(a.systems ?? null) !== JSON.stringify(b.systems ?? null) ||
          Math.abs(a.layer - b.layer) >= 0.1;
        expect(changed, `${wonder.id}[${i}] 与上一步画面完全相同`).toBe(true);
      }
    }
  });

  /** 展词是给观众看的，不该出现开发排期与占位说明。 */
  it('展词里没有生产备注', () => {
    const leak = /(后续版本|待补充|尚未补齐|暂缺|TODO|待定|placeholder)/i;
    for (const wonder of WONDERS) {
      for (const [i, step] of wonder.steps.entries()) {
        for (const lang of ['zh', 'en'] as const) {
          expect(leak.test(step.text[lang]), `${wonder.id}[${i}].${lang} 混入了生产备注`).toBe(
            false,
          );
        }
      }
    }
  });

  /** 中英必须讲同一件事：一边有内容另一边只剩半句，等于英文观众少看一半。 */
  it('中英文案长度相当，不许一边缺内容', () => {
    for (const wonder of WONDERS) {
      for (const [i, step] of wonder.steps.entries()) {
        // 同一句话英文字符数约为中文的两倍，低于 1.2 倍说明英文丢了内容
        const ratio = step.text.en.length / step.text.zh.length;
        expect(
          ratio,
          `${wonder.id}[${i}] 英文只有中文的 ${ratio.toFixed(1)} 倍长，多半漏译了具体意象`,
        ).toBeGreaterThan(1.2);
      }
    }
  });
});

describe('WonderEngine 播放状态机', () => {
  const wonder: Wonder = {
    id: 't',
    title: { zh: '测试', en: 'Test' },
    steps: [
      { text: { zh: '一', en: '1' }, layer: 0.5, durationMs: 5000 },
      { text: { zh: '二', en: '2' }, layer: 0.6, durationMs: 5000 },
    ],
  };

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('start 后自动按时长推进并在末尾结束', () => {
    const engine = new WonderEngine();
    const events: string[] = [];
    for (const ev of ['step', 'end'] as const) engine.addEventListener(ev, () => events.push(ev));

    engine.start(wonder);
    expect(engine.currentIndex).toBe(0);
    vi.advanceTimersByTime(5000);
    expect(engine.currentIndex).toBe(1);
    vi.advanceTimersByTime(5000);
    expect(engine.currentWonder).toBeNull();
    expect(events).toEqual(['step', 'step', 'end']);
  });

  it('pause 停止计时，play 恢复；prev/next 手动跳步', () => {
    const engine = new WonderEngine();
    engine.start(wonder);
    engine.pause();
    vi.advanceTimersByTime(20000);
    expect(engine.currentIndex).toBe(0);
    engine.next();
    expect(engine.currentIndex).toBe(1);
    engine.prev();
    expect(engine.currentIndex).toBe(0);
    engine.play();
    vi.advanceTimersByTime(5000);
    expect(engine.currentIndex).toBe(1);
  });
});

describe('奥秘：展开与剖切字段（M2 收尾）', () => {
  it('expand 指向的结构必须真的有内部件', () => {
    const manifest = JSON.parse(
      readFileSync(resolve(__dirname, '../../public/assets/manifest.json'), 'utf8'),
    ) as { structures: Record<string, { parent?: string }> };
    for (const wonder of WONDERS) {
      for (const step of wonder.steps) {
        if (!step.expand) continue;
        const children = Object.values(manifest.structures).filter((s) => s.parent === step.expand);
        expect(children.length, `${wonder.id}: ${step.expand} 没有内部件`).toBeGreaterThan(0);
      }
    }
  });

  it('展开状态下选中的结构要么是父结构的内部件，要么与展开无关', () => {
    const manifest = JSON.parse(
      readFileSync(resolve(__dirname, '../../public/assets/manifest.json'), 'utf8'),
    ) as { structures: Record<string, { parent?: string }> };
    for (const wonder of WONDERS) {
      for (const step of wonder.steps) {
        if (!step.expand || !step.selected) continue;
        const info = manifest.structures[step.selected];
        expect(info, `${wonder.id}: 选中的 ${step.selected} 不存在`).toBeTruthy();
        // 展开某结构时若选中它自己，界面上会指着一个隐形结构
        expect(step.selected, `${wonder.id}: 展开 ${step.expand} 时不该选中它自己`).not.toBe(
          step.expand,
        );
      }
    }
  });

  it('剖切位置在 [-1, 1] 之内', () => {
    for (const wonder of WONDERS) {
      for (const step of wonder.steps) {
        if (!step.clip) continue;
        expect(Math.abs(step.clip.pos), `${wonder.id}: 剖切位置越界`).toBeLessThanOrEqual(1);
      }
    }
  });
});
