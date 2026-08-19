import type { Wonder } from './engine';
import { structuresOf } from './engine';

/**
 * 内置奥秘。用 import.meta.glob 自动收录 content/wonders/*.json——
 * 以后每个器官一条、上百个文件时不必再逐条登记（docs/CONTENT-GUIDE.md 第三节）。
 * JSON 的合法性由 tests/unit/wonders.test.ts 保证。
 */
const MODULES = import.meta.glob('../../content/wonders/*.json', {
  eager: true,
  import: 'default',
}) as Record<string, Wonder>;

/** 稳定顺序：按文件名排，避免打包器的遍历顺序影响菜单。 */
export const WONDERS: Wonder[] = Object.keys(MODULES)
  .sort()
  .map((k) => MODULES[k]!);

/** 结构 slug → 讲到它的奥秘。点开一个结构时用这张表列出相关内容。 */
const BY_STRUCTURE = (() => {
  const index = new Map<string, Wonder[]>();
  for (const wonder of WONDERS) {
    for (const slug of structuresOf(wonder)) {
      const list = index.get(slug);
      if (list) list.push(wonder);
      else index.set(slug, [wonder]);
    }
  }
  return index;
})();

/**
 * 讲到某个结构的奥秘。内部件（心室壁）没有自己的内容时向上回退到父结构，
 * 免得点开一个瓣膜就什么都推荐不出来。
 */
export function wondersForStructure(slug: string, parent?: string): Wonder[] {
  const own = BY_STRUCTURE.get(slug) ?? [];
  if (own.length || !parent) return own;
  return BY_STRUCTURE.get(parent) ?? [];
}
