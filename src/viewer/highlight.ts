import { Color, MeshStandardMaterial, ShaderMaterial, type Mesh } from 'three';

export type HighlightLevel = 'none' | 'hover' | 'selected';

const EMISSIVE: Record<HighlightLevel, [number, number]> = {
  // [emissive 强度, X-ray uHighlight]。选中的识别度交给 OutlinePass 描边，
  // 自发光只做很轻的提亮——0.35 会把器官本色洗成一片白，近看完全看不出是心脏
  none: [0, 0],
  hover: [0.14, 0.3],
  selected: [0.18, 0.42],
};

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
  selected: 0.24,
};

/**
 * 悬停 / 选中高亮：标准材质用自发光叠加青色；X-ray 材质用 uHighlight 混白。
 * 不引入后处理描边（无 GPU 的云端冒烟也要能跑），强度差异区分悬停与选中。
 */
export function applyHighlight(mesh: Mesh, level: HighlightLevel): void {
  const material = mesh.material;
  const [intensity, xray] = EMISSIVE[level];
  if (material instanceof MeshStandardMaterial) {
    material.emissive.copy(HIGHLIGHT_COLOR);
    material.emissiveIntensity = intensity;
  } else if (material instanceof ShaderMaterial && material.uniforms.uHighlight) {
    material.uniforms.uHighlight.value = xray;
  }
}
