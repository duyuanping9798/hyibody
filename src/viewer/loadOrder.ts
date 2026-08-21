import type { SystemId } from '../data/types';

/**
 * 加载顺序的**单一事实来源**。
 *
 * 这两个常量以前只写在 HyiViewer.ts 里，而"首屏是哪些系统"同时被
 * `pipeline/validate.py`（卡 5 MB 预算）和 `tests/unit/manifest.test.ts`
 * （卡体积契约）各自硬编码了一份。2026-08-21 把骨骼挪出首屏时三处只改了一处，
 * 校验和单测继续按"皮肤+骨骼"量——量的是另一回事，而且**看不出错在哪**。
 * 单独成文件是为了不带 three.js：Node 环境的单测要能直接 import 它。
 */

/**
 * 首屏系统：加载完它就派发 ready，其余后台补（KICKOFF 第 5 节 M1-6）。
 *
 * 2026-08-21 全量之后骨骼从这里退出了：骨骼原样导出是 75.7 万面 / 4.86 MB，
 * 连皮肤一起算首屏就是 6.14 MB，越过 KICKOFF 的 5 MB 硬顶。而默认 layer=0 时
 * **骨骼本来就完全不可见**——把它算进首屏是在为看不见的东西让用户等。
 * 现在首屏只剩皮肤 + manifest（1.29 MB），骨骼降级为后台第一个补载的系统。
 */
export const FIRST_SCREEN_SYSTEMS: readonly SystemId[] = ['skin'];

/**
 * 后台补载顺序：由"用户下一步最可能滑到哪一层"决定，不是 manifest 里的顺序。
 * 骨骼排头，因为分层滑块往里推的第一站就是它（也因为它刚从首屏退下来）。
 * 不在表里的系统排到最后，顺序保持 manifest 原样。
 *
 * 例外：分享链接点名了某个结构时，它所在的系统插到最前面（见 HyiViewer.LoadOptions）。
 */
export const BACKGROUND_ORDER: readonly SystemId[] = [
  'skeleton',
  'muscles',
  'organs',
  'vessels',
  'nerves',
];

/**
 * 后台补载的排序：`priority` 指定的系统插到最前，其余按 `BACKGROUND_ORDER`，
 * 表里没有的排到最后（保持传入的相对顺序）。
 *
 * 单独成函数是为了能测：这段逻辑原来内联在 `load()` 里，而它有两个很容易写错的
 * 边界——`indexOf` 找不到返回 −1（会把陌生系统排到骨骼前面），以及 `priority`
 * 指向的结构可能压根不在后台队列里（比如皮肤，它在首屏）。
 */
export function backgroundOrder<T extends { id: string }>(
  systems: readonly T[],
  priority?: string,
): T[] {
  const rank = (id: string) => {
    if (priority && id === priority) return -1;
    const i = (BACKGROUND_ORDER as readonly string[]).indexOf(id);
    return i < 0 ? BACKGROUND_ORDER.length : i;
  };
  return (
    systems
      .filter((s) => !(FIRST_SCREEN_SYSTEMS as readonly string[]).includes(s.id))
      .map((s, i) => [s, i] as const)
      // 同名次时保持原顺序：Array.prototype.sort 在 V8 上虽然稳定，但别把正确性
      // 押在引擎实现上——尤其这里"表外系统"全都并列最后一名
      .sort((a, b) => rank(a[0].id) - rank(b[0].id) || a[1] - b[1])
      .map(([s]) => s)
  );
}
