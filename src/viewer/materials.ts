import {
  AdditiveBlending,
  Color,
  DoubleSide,
  MeshStandardMaterial,
  ShaderMaterial,
  type Material,
} from 'three';

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
      varying vec3 vNormalW;
      varying vec3 vViewDirW;
      void main() {
        float fresnel = pow(1.0 - abs(dot(normalize(vNormalW), normalize(vViewDirW))), uPower);
        gl_FragColor = vec4(uColor, fresnel * uOpacity);
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
  }
  material.visible = opacity > 0.005;
}
