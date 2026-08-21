/**
 * 卡片缩略图的地址。
 *
 * 图由 `scripts/thumbs.mjs` 离线渲出来，提交在 `public/thumbs/` 下。
 * 不在运行时现渲：一屏几十张卡片，每张都要摆一次相机再截一次图，
 * 软件渲染的机器上要等好几分钟，而这些画面是固定的、没有理由每次重算。
 *
 * 图缺了不是错误——`Gallery` 里 `onError` 会让它隐掉，露出底下的系统色占位块。
 * 所以新增一条奥秘/细剖视图时**不必**同时补图，补图是可以延后的一步。
 */
const BASE = import.meta.env.BASE_URL ?? '/';

export type ThumbKind = 'wonder' | 'view';

export function thumbUrl(kind: ThumbKind, id: string): string {
  return `${BASE.replace(/\/?$/, '/')}thumbs/${kind}-${id}.webp`;
}
