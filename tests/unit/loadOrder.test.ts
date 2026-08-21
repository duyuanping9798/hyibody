import { describe, expect, it } from 'vitest';
import manifest from '../../public/assets/manifest.json';
import {
  backgroundOrder,
  BACKGROUND_ORDER,
  FIRST_SCREEN_SYSTEMS,
} from '../../src/viewer/loadOrder';

const sys = (...ids: string[]) => ids.map((id) => ({ id }));

describe('后台补载顺序', () => {
  it('首屏系统不进后台队列', () => {
    expect(backgroundOrder(sys('skin', 'skeleton')).map((s) => s.id)).toEqual(['skeleton']);
  });

  it('按 BACKGROUND_ORDER 排，不是 manifest 里的顺序', () => {
    const got = backgroundOrder(sys('nerves', 'organs', 'skeleton', 'vessels', 'muscles'));
    expect(got.map((s) => s.id)).toEqual(['skeleton', 'muscles', 'organs', 'vessels', 'nerves']);
  });

  it('分享链接点名的系统插到最前面', () => {
    const got = backgroundOrder(sys('skeleton', 'muscles', 'organs', 'nerves'), 'organs');
    expect(got.map((s) => s.id)).toEqual(['organs', 'skeleton', 'muscles', 'nerves']);
  });

  it('点名的是首屏系统（皮肤）时不影响后台顺序', () => {
    const got = backgroundOrder(sys('skin', 'skeleton', 'muscles'), 'skin');
    expect(got.map((s) => s.id)).toEqual(['skeleton', 'muscles']);
  });

  it('没点名时行为不变', () => {
    expect(backgroundOrder(sys('muscles', 'skeleton')).map((s) => s.id)).toEqual([
      'skeleton',
      'muscles',
    ]);
  });

  it('表里没有的系统排到最后，而不是靠 indexOf 的 −1 抢到第一', () => {
    // 这条是真踩过的坑：indexOf 找不到返回 −1，直接拿去比大小就是最小值
    const got = backgroundOrder(sys('muscles', 'lymph', 'skeleton'));
    expect(got.map((s) => s.id)).toEqual(['skeleton', 'muscles', 'lymph']);
  });

  it('并列最后一名时保持传入顺序', () => {
    const got = backgroundOrder(sys('lymph', 'fascia', 'skeleton'));
    expect(got.map((s) => s.id)).toEqual(['skeleton', 'lymph', 'fascia']);
  });

  it('真实 manifest：每个非首屏系统都在 BACKGROUND_ORDER 里，一个都不落队尾', () => {
    const ids = manifest.systems.map((s) => s.id);
    const rest = ids.filter((id) => !(FIRST_SCREEN_SYSTEMS as readonly string[]).includes(id));
    expect(rest.length).toBeGreaterThan(0);
    for (const id of rest) expect(BACKGROUND_ORDER as readonly string[], id).toContain(id);
    // 排完之后个数不变——过滤条件写错会静悄悄地少加载一个系统
    expect(backgroundOrder(manifest.systems)).toHaveLength(rest.length);
  });
});
