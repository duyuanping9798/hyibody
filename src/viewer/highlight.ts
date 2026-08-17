import { Color, MeshStandardMaterial, ShaderMaterial, type Mesh } from 'three';

export type HighlightLevel = 'none' | 'hover' | 'selected';

const EMISSIVE: Record<HighlightLevel, [number, number]> = {
  // [emissive 强度, X-ray uHighlight]；选中主要靠反壳描边，自发光只做轻提亮
  none: [0, 0],
  hover: [0.3, 0.35],
  selected: [0.35, 0.5],
};

const HIGHLIGHT_COLOR = new Color(0x4fe3e0); // 青色强调（原型视觉基调）

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
