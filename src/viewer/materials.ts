import {
  AdditiveBlending,
  Color,
  DoubleSide,
  MeshStandardMaterial,
  ShaderMaterial,
  type Material,
} from 'three';
import type { SystemId } from '../data/types';

/** 各系统基色（深色舞台上的科普配色：动脉红/静脉蓝/神经黄/骨米白）。 */
export const SYSTEM_COLORS: Record<SystemId, number> = {
  skin: 0x4fc3d9,
  muscles: 0xc75948,
  skeleton: 0xd8d3c3,
  organs: 0xcf8a5b,
  vessels: 0xd64541,
  nerves: 0xe6cf4e,
};

/** 结构基色：血管按名称区分动脉红 / 静脉蓝，其余用系统色。 */
export function colorForStructure(system: SystemId, en: string): number {
  if (system === 'vessels' && /vein|venous|vena/i.test(en)) return 0x4a6fd6;
  return SYSTEM_COLORS[system];
}

/** 常规结构材质（骨骼、器官等实体感）。 */
export function createStructureMaterial(color: string | number): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color: new Color(color),
    roughness: 0.55,
    metalness: 0.05,
    transparent: true,
  });
}

/**
 * 菲涅尔 X-ray 材质：边缘亮、正对相机处透明，呈现"透视"外壳效果。
 * 迁移自 prototype/index.html 已验证的思路，供皮肤/肌肉层使用。
 */
export function createXRayMaterial(color: string | number, opacity = 1): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    blending: AdditiveBlending,
    uniforms: {
      uColor: { value: new Color(color) },
      uOpacity: { value: opacity },
      uPower: { value: 2.2 },
      uHighlight: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vNormalW;
      varying vec3 vViewDirW;
      void main() {
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vNormalW = normalize(mat3(modelMatrix) * normal);
        vViewDirW = normalize(cameraPosition - worldPos.xyz);
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform float uPower;
      uniform float uHighlight;
      varying vec3 vNormalW;
      varying vec3 vViewDirW;
      void main() {
        float fresnel = pow(1.0 - abs(dot(normalize(vNormalW), normalize(vViewDirW))), uPower);
        vec3 color = mix(uColor, vec3(1.0), uHighlight);
        float alpha = fresnel * uOpacity + uHighlight * 0.25 * uOpacity;
        gl_FragColor = vec4(color, alpha);
      }
    `,
  });
}

/** 统一设置材质整体不透明度（分层滑块用）。 */
export function setMaterialOpacity(material: Material, opacity: number): void {
  if (material instanceof ShaderMaterial && material.uniforms.uOpacity) {
    material.uniforms.uOpacity.value = opacity;
  } else if ('opacity' in material) {
    material.opacity = opacity;
    // 半透明叠加时关闭深度写入，减少互相遮挡的闪面
    material.depthWrite = opacity > 0.55;
  }
  material.visible = opacity > 0.005;
}
