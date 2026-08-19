import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TourEngine, type Tour } from '../../src/tours/engine';
import { TOURS } from '../../src/tours';
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

describe('故事线内容契约', () => {
  it('内置三条故事线', () => {
    expect(TOURS.map((t) => t.id)).toEqual(['heartbeat', 'digestion', 'nerve']);
  });

  it('步骤字段合法且引用的结构真实存在', () => {
    for (const tour of TOURS) {
      expect(tour.steps.length, tour.id).toBeGreaterThanOrEqual(4);
      for (const [i, step] of tour.steps.entries()) {
        const where = `${tour.id}[${i}]`;
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
    for (const tour of TOURS) {
      for (const [i, step] of tour.steps.entries()) {
        if (!step.clip || !step.selected) continue;
        const info = manifest.structures[step.selected];
        if (!info?.bbox) continue;
        const a = AXIS_INDEX[step.clip.axis];
        const cut = clipConstant(step.clip.pos, CONTENT_BOX.lo[a]!, CONTENT_BOX.hi[a]!);
        const [min, max] = [info.bbox[a]!, info.bbox[a + 3]!];
        expect(
          cut > min && cut < max,
          `${tour.id}[${i}] 剖切面 ${step.clip.axis}=${cut.toFixed(1)} 没落在 ` +
            `${step.selected} 的 [${min.toFixed(1)}, ${max.toFixed(1)}] 里，这一步会切出空画面`,
        ).toBe(true);
      }
    }
  });

  /** 主角必须看得见：选中结构所属系统在该 layer 下不透明度得大于拾取阈值。 */
  it('每一步的主角在该分层下可见', () => {
    for (const tour of TOURS) {
      for (const [i, step] of tour.steps.entries()) {
        if (!step.selected) continue;
        const info = manifest.structures[step.selected];
        if (!info) continue;
        if (step.systems?.[info.system as SystemId] === false) continue;
        const opacity = computeSystemOpacity(info.system as SystemId, step.layer);
        expect(
          opacity,
          `${tour.id}[${i}] 主角 ${step.selected}（${info.system}）在 layer=${step.layer} 下` +
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
    for (const tour of TOURS) {
      for (let i = 1; i < tour.steps.length; i += 1) {
        const a = tour.steps[i - 1]!;
        const b = tour.steps[i]!;
        const changed =
          a.selected !== b.selected ||
          a.expand !== b.expand ||
          a.preset !== b.preset ||
          JSON.stringify(a.clip ?? null) !== JSON.stringify(b.clip ?? null) ||
          JSON.stringify(a.systems ?? null) !== JSON.stringify(b.systems ?? null) ||
          Math.abs(a.layer - b.layer) >= 0.1;
        expect(changed, `${tour.id}[${i}] 与上一步画面完全相同`).toBe(true);
      }
    }
  });

  /** 展词是给观众看的，不该出现开发排期与占位说明。 */
  it('展词里没有生产备注', () => {
    const leak = /(后续版本|待补充|尚未补齐|暂缺|TODO|待定|placeholder)/i;
    for (const tour of TOURS) {
      for (const [i, step] of tour.steps.entries()) {
        for (const lang of ['zh', 'en'] as const) {
          expect(leak.test(step.text[lang]), `${tour.id}[${i}].${lang} 混入了生产备注`).toBe(false);
        }
      }
    }
  });

  /** 中英必须讲同一件事：一边有内容另一边只剩半句，等于英文观众少看一半。 */
  it('中英文案长度相当，不许一边缺内容', () => {
    for (const tour of TOURS) {
      for (const [i, step] of tour.steps.entries()) {
        // 同一句话英文字符数约为中文的两倍，低于 1.2 倍说明英文丢了内容
        const ratio = step.text.en.length / step.text.zh.length;
        expect(
          ratio,
          `${tour.id}[${i}] 英文只有中文的 ${ratio.toFixed(1)} 倍长，多半漏译了具体意象`,
        ).toBeGreaterThan(1.2);
      }
    }
  });
});

describe('TourEngine 播放状态机', () => {
  const tour: Tour = {
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
    const engine = new TourEngine();
    const events: string[] = [];
    for (const ev of ['step', 'end'] as const) engine.addEventListener(ev, () => events.push(ev));

    engine.start(tour);
    expect(engine.currentIndex).toBe(0);
    vi.advanceTimersByTime(5000);
    expect(engine.currentIndex).toBe(1);
    vi.advanceTimersByTime(5000);
    expect(engine.currentTour).toBeNull();
    expect(events).toEqual(['step', 'step', 'end']);
  });

  it('pause 停止计时，play 恢复；prev/next 手动跳步', () => {
    const engine = new TourEngine();
    engine.start(tour);
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

describe('故事线：展开与剖切字段（M2 收尾）', () => {
  it('expand 指向的结构必须真的有内部件', () => {
    const manifest = JSON.parse(
      readFileSync(resolve(__dirname, '../../public/assets/manifest.json'), 'utf8'),
    ) as { structures: Record<string, { parent?: string }> };
    for (const tour of TOURS) {
      for (const step of tour.steps) {
        if (!step.expand) continue;
        const children = Object.values(manifest.structures).filter((s) => s.parent === step.expand);
        expect(children.length, `${tour.id}: ${step.expand} 没有内部件`).toBeGreaterThan(0);
      }
    }
  });

  it('展开状态下选中的结构要么是父结构的内部件，要么与展开无关', () => {
    const manifest = JSON.parse(
      readFileSync(resolve(__dirname, '../../public/assets/manifest.json'), 'utf8'),
    ) as { structures: Record<string, { parent?: string }> };
    for (const tour of TOURS) {
      for (const step of tour.steps) {
        if (!step.expand || !step.selected) continue;
        const info = manifest.structures[step.selected];
        expect(info, `${tour.id}: 选中的 ${step.selected} 不存在`).toBeTruthy();
        // 展开某结构时若选中它自己，界面上会指着一个隐形结构
        expect(step.selected, `${tour.id}: 展开 ${step.expand} 时不该选中它自己`).not.toBe(
          step.expand,
        );
      }
    }
  });

  it('剖切位置在 [-1, 1] 之内', () => {
    for (const tour of TOURS) {
      for (const step of tour.steps) {
        if (!step.clip) continue;
        expect(Math.abs(step.clip.pos), `${tour.id}: 剖切位置越界`).toBeLessThanOrEqual(1);
      }
    }
  });
});
