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
 * 菲涅尔边缘光：给受光材质加一圈掠射角高光，并在低不透明度时补一点 alpha。
 *
 * 这样同一份材质既能当"实体"（不透明度高时看得清形状），又能当"X-ray 壳"
 * （不透明度低时只剩一圈发光的轮廓）。肌肉曾经用纯 X-ray 着色器，轮到肌肉层时
 * 只剩一圈红边、看不出肌肉走向；纯受光材质又没有透视感——这里两者兼得。
 */
function addFresnelRim(
  material: MeshStandardMaterial,
  options: { color: Color; strength: number; power: number; alpha: number },
): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uRimColor = { value: options.color };
    shader.uniforms.uRimStrength = { value: options.strength };
    shader.uniforms.uRimPower = { value: options.power };
    shader.uniforms.uRimAlpha = { value: options.alpha };
    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        `uniform vec3 uRimColor;
         uniform float uRimStrength;
         uniform float uRimPower;
         uniform float uRimAlpha;
         void main() {`,
      )
      .replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
         float rimFacing = abs(dot(normalize(vNormal), normalize(vViewPosition)));
         float rim = pow(1.0 - clamp(rimFacing, 0.0, 1.0), uRimPower);
         gl_FragColor.rgb += uRimColor * rim * uRimStrength;
         gl_FragColor.a = clamp(gl_FragColor.a + rim * uRimAlpha * (1.0 - gl_FragColor.a), 0.0, 1.0);`,
      );
  };
  // onBeforeCompile 变了要让 three 重新编译
  material.customProgramCacheKey = () =>
    `rim:${options.strength}:${options.power}:${options.alpha}`;
}

/**
 * 按系统分质感（环境光照下的观感升级）：骨骼哑光、肌肉半哑光纤维感、
 * 器官/血管湿润高光带清漆层、神经缎面，全部带菲涅尔边缘光。
 * 只有皮肤走独立的 X-ray 菲涅尔壳（加色混合）。
 */
/** 各系统的边缘光参数：越靠外的层越需要"透"，边缘光就越强。 */
const RIM: Partial<
  Record<SystemId, { color: number; strength: number; power: number; alpha: number }>
> = {
  muscles: { color: 0xff9a7a, strength: 0.5, power: 2.6, alpha: 0.42 },
  skeleton: { color: 0xbfd8ff, strength: 0.26, power: 3.2, alpha: 0.2 },
  organs: { color: 0xffc79a, strength: 0.34, power: 2.8, alpha: 0.3 },
  vessels: { color: 0xff8f9a, strength: 0.42, power: 2.4, alpha: 0.34 },
  nerves: { color: 0xfff0a6, strength: 0.4, power: 2.4, alpha: 0.34 },
};

export function createSystemMaterial(
  system: SystemId,
  color: string | number,
): MeshStandardMaterial {
  const c = new Color(color);
  let material: MeshStandardMaterial;
  switch (system) {
    case 'skeleton':
      material = new MeshStandardMaterial({
        color: c,
        roughness: 0.58,
        metalness: 0.03,
        envMapIntensity: 0.8,
        transparent: true,
      });
      break;
    case 'muscles':
      // 肌肉：半哑光、略带次表面感的暖红，粗糙度高一点才不像塑料
      material = new MeshStandardMaterial({
        color: c,
        roughness: 0.68,
        metalness: 0.0,
        envMapIntensity: 0.85,
        transparent: true,
      });
      break;
    case 'organs':
      material = new MeshPhysicalMaterial({
        color: c,
        roughness: 0.34,
        metalness: 0.0,
        clearcoat: 0.45,
        clearcoatRoughness: 0.4,
        sheen: 0.35,
        sheenColor: new Color(0xffd9c0),
        envMapIntensity: 1.0,
        transparent: true,
      });
      break;
    case 'vessels':
      material = new MeshPhysicalMaterial({
        color: c,
        roughness: 0.26,
        metalness: 0.0,
        clearcoat: 0.6,
        clearcoatRoughness: 0.3,
        envMapIntensity: 1.15,
        transparent: true,
      });
      break;
    case 'nerves':
      material = new MeshStandardMaterial({
        color: c,
        roughness: 0.42,
        metalness: 0.0,
        envMapIntensity: 0.9,
        transparent: true,
      });
      break;
    default:
      return createStructureMaterial(color);
  }
  const rim = RIM[system];
  if (rim) {
    addFresnelRim(material, {
      color: new Color(rim.color),
      strength: rim.strength,
      power: rim.power,
      alpha: rim.alpha,
    });
  }
  return material;
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
      // 边缘收窄（2.2 → 2.7）：叠在 109 万面的内脏之上时，宽边缘会把画面糊白
      uPower: { value: 2.7 },
      // 加色混合的总强度，低一点才压得住内层的高光
      uIntensity: { value: 0.85 },
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
      uniform float uIntensity;
      uniform float uHighlight;
      varying vec3 vNormalW;
      varying vec3 vViewDirW;
      void main() {
        float fresnel = pow(1.0 - abs(dot(normalize(vNormalW), normalize(vViewDirW))), uPower);
        vec3 color = mix(uColor, vec3(1.0), uHighlight);
        float alpha = (fresnel * uIntensity + uHighlight * 0.22) * uOpacity;
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
    // 完全不透明时关掉混合：留着 transparent 的话，选中的器官后面会透出肋骨，
    // 看着像磨砂玻璃而不是实体
    const solid = opacity >= 0.999;
    if (material.transparent === solid) {
      material.transparent = !solid;
      material.needsUpdate = true;
    }
  }
  material.visible = opacity > 0.005;
}
