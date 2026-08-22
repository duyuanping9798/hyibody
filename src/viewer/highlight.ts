import { Color } from 'three';

export type HighlightLevel = 'none' | 'hover' | 'selected';

export const HIGHLIGHT_COLOR = new Color(0x4fe3e0); // 青色强调（原型视觉基调）

/**
 * 合批之后高亮怎么做：不再改材质的 emissive（材质是整个系统共享的，改一次全亮），
 * 改成把结构本色往强调色**插值**这么多，写进每实例颜色。
 *
 * 数值沿用原来 emissive 的量级——选中的识别度主要交给 OutlinePass 描边，
 * 颜色只做很轻的提示；给多了近看完全分不出那是心脏还是一块青色的东西。
 */
export const HIGHLIGHT_TINT: Record<HighlightLevel, number> = {
  none: 0,
  hover: 0.18,
  // 0.24 → 0.45（2026-08-22）：对标 Complete Anatomy 的"选中整块高亮成色"。
  // 原来靠描边 + 一点点染色，手机上选没选中要凑近找那圈青线。第一版试过 0.6，
  // 同机位截图里心脏成了一块青色玻璃、红色本性没了——0.45 是"一眼定位"与
  // "看得出这是心脏"之间实拍选出来的点，配合腔隙顶点色保住表面细节。
  selected: 0.45,
};
