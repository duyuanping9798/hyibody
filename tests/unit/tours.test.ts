import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TourEngine, type Tour } from '../../src/tours/engine';
import { TOURS } from '../../src/tours';

const manifest = JSON.parse(
  readFileSync(resolve(__dirname, '../../public/assets/manifest.json'), 'utf8'),
) as { structures: Record<string, unknown> };

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
