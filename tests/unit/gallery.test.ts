import { describe, expect, it } from 'vitest';
import { pickTab } from '../../src/ui/Gallery';
import { thumbUrl } from '../../src/data/thumbs';

describe('画廊：标签挑选', () => {
  const T = (id: string, n: number) => ({ id, items: Array.from({ length: n }, (_, i) => i) });

  it('空标签不出现', () => {
    const { shown } = pickTab([T('a', 3), T('b', 0), T('c', 1)], 0);
    expect(shown.map((t) => t.id)).toEqual(['a', 'c']);
  });

  it('选中下标越界时夹回最后一个，不返回 undefined', () => {
    // 真会发生：站在第 5 个标签上，内容变得只剩 2 个标签。
    // 不夹的话渲染出一个空网格，看着像"内容全没了"。
    const { tab, index } = pickTab([T('a', 1), T('b', 1)], 5);
    expect(tab?.id).toBe('b');
    expect(index).toBe(1);
  });

  it('负数下标夹回第一个', () => {
    const { tab, index } = pickTab([T('a', 1), T('b', 1)], -3);
    expect(tab?.id).toBe('a');
    expect(index).toBe(0);
  });

  it('一个有内容的标签都没有时给 undefined，而不是崩', () => {
    const { shown, tab } = pickTab([T('a', 0), T('b', 0)], 0);
    expect(shown).toEqual([]);
    expect(tab).toBeUndefined();
  });

  it('挑中的永远是过滤之后的那一列，不是原列表', () => {
    // 下标 1 在原列表里是空的 b，过滤之后应该指向 c
    const { tab } = pickTab([T('a', 2), T('b', 0), T('c', 4)], 1);
    expect(tab?.id).toBe('c');
  });
});

describe('缩略图地址', () => {
  it('不会拼出双斜杠', () => {
    expect(thumbUrl('wonder', 'heartbeat')).not.toContain('//thumbs');
    expect(thumbUrl('view', 'skull_front')).not.toContain('//thumbs');
  });

  it('按种类分前缀，和 scripts/thumbs.mjs 的命名一致', () => {
    expect(thumbUrl('wonder', 'heartbeat')).toMatch(/thumbs\/wonder-heartbeat\.webp$/);
    expect(thumbUrl('view', 'skull_front')).toMatch(/thumbs\/view-skull_front\.webp$/);
  });
});
