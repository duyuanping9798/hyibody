import {
  AdditiveBlending,
  BackSide,
  Color,
  DoubleSide,
  MeshPhysicalMaterial,
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

/** slug → [0,1) 的确定性伪随机（FNV-1a），保证同一结构每次配色一致。 */
function hash01(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 0x100000000;
}

/**
 * 同系统内的微小色相/明度抖动幅度。相邻肌肉若是同一个红，挨在一起就分不出边界；
 * 抖一点点既能看清"这是两块肌肉"，又不破坏系统配色identity。
 */
const TINT_SPREAD: Partial<Record<SystemId, { hue: number; light: number }>> = {
  muscles: { hue: 0.012, light: 0.1 },
  organs: { hue: 0.022, light: 0.09 },
  skeleton: { hue: 0.004, light: 0.05 },
};

/**
 * 结构基色：血管按名称区分动脉红 / 静脉蓝，其余用系统色，
 * 并按 key（默认用英文名，viewer 传 slug）做确定性微抖动区分相邻结构。
 */
export function colorForStructure(system: SystemId, en: string, key: string = en): number {
  const base =
    system === 'vessels' && /vein|venous|vena/i.test(en) ? 0x4a6fd6 : SYSTEM_COLORS[system];
  const spread = TINT_SPREAD[system];
  if (!spread) return base;
  const color = new Color(base);
  const hsl = { h: 0, s: 0, l: 0 };
  color.getHSL(hsl);
  const dh = (hash01(key) - 0.5) * 2 * spread.hue;
  const dl = (hash01(`${key}#light`) - 0.5) * 2 * spread.light;
  color.setHSL((hsl.h + dh + 1) % 1, hsl.s, Math.min(0.94, Math.max(0.06, hsl.l * (1 + dl))));
  return color.getHex();
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
 * 按系统分质感（环境光照下的观感升级）：骨骼哑光、肌肉半哑光纤维感、
 * 器官/血管湿润高光带清漆层、神经缎面。只有皮肤走 X-ray 菲涅尔壳——
 * 肌肉曾经也是 X-ray，结果轮到肌肉层时只剩一圈红边、看不出肌肉形状（2026-08-18 改）。
 */
export function createSystemMaterial(
  system: SystemId,
  color: string | number,
): MeshStandardMaterial {
  const c = new Color(color);
  switch (system) {
    case 'skeleton':
      return new MeshStandardMaterial({
        color: c,
        roughness: 0.62,
        metalness: 0.02,
        envMapIntensity: 0.65,
        transparent: true,
      });
    case 'muscles':
      return new MeshStandardMaterial({
        color: c,
        roughness: 0.72,
        metalness: 0.0,
        envMapIntensity: 0.7,
        transparent: true,
      });
    case 'organs':
      return new MeshPhysicalMaterial({
        color: c,
        roughness: 0.38,
        metalness: 0.0,
        clearcoat: 0.35,
        clearcoatRoughness: 0.45,
        envMapIntensity: 0.9,
        transparent: true,
      });
    case 'vessels':
      return new MeshPhysicalMaterial({
        color: c,
        roughness: 0.3,
        metalness: 0.0,
        clearcoat: 0.5,
        clearcoatRoughness: 0.35,
        envMapIntensity: 1.0,
        transparent: true,
      });
    case 'nerves':
      return new MeshStandardMaterial({
        color: c,
        roughness: 0.45,
        metalness: 0.0,
        envMapIntensity: 0.8,
        transparent: true,
      });
    default:
      return createStructureMaterial(color);
  }
}

/**
 * 选中描边：反壳法——同几何体沿法线外扩、背面渲染，形成稳定轮廓线。
 *
 * 外扩量在**视图空间**按深度换算成固定像素宽度，不能直接加在物体空间的 position 上：
 * 流水线用 KHR_mesh_quantization，每个节点自带缩放（皮肤那条是 859.88），
 * 物体空间加 2.2 会被放大成 1891 mm 的巨壳，把整个视口糊成青色（2026-08-18 修）。
 */
export function createOutlineMaterial(color: string | number, widthPx = 2.5): ShaderMaterial {
  return new ShaderMaterial({
    side: BackSide,
    transparent: true,
    depthWrite: false,
    uniforms: {
      uColor: { value: new Color(color) },
      uWidthPx: { value: widthPx },
      // 2·tan(fov/2)/视口高度：把像素宽度换算成该深度处的世界尺寸，由 viewer 在 resize 时更新
      uPixelScale: { value: 0.001 },
      uOpacity: { value: 0.95 },
    },
    vertexShader: /* glsl */ `
      uniform float uWidthPx;
      uniform float uPixelScale;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vec3 n = normalize(normalMatrix * normal);
        mv.xyz += n * (uWidthPx * uPixelScale * max(-mv.z, 0.0));
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      void main() {
        gl_FragColor = vec4(uColor, uOpacity);
      }
    `,
  });
}

/** 渐变舞台背景：内翻大球，深色底 + 顶部冷光晕，替代纯色清屏。 */
export function createBackdropMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    uniforms: {
      uBottom: { value: new Color(0x070b16) },
      uMid: { value: new Color(0x0b1020) },
      uTop: { value: new Color(0x14223c) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vPos;
      void main() {
        vPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uBottom;
      uniform vec3 uMid;
      uniform vec3 uTop;
      varying vec3 vPos;
      void main() {
        float h = clamp(vPos.z / length(vPos) * 0.5 + 0.5, 0.0, 1.0);
        vec3 color = h < 0.5 ? mix(uBottom, uMid, h * 2.0) : mix(uMid, uTop, (h - 0.5) * 2.0);
        gl_FragColor = vec4(color, 1.0);
      }
    `,
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
