import { describe, expect, it } from 'vitest';
import { ShaderLib, MeshStandardMaterial, type Material } from 'three';
import { createSystemMaterial, setSurfaceDetail } from '../../src/viewer/materials';
import { QUALITY_CAPS } from '../../src/viewer/quality';
import type { SystemId } from '../../src/data/types';

/** 造一份和 three 真实来源一致的 shader 对象喂给 onBeforeCompile。 */
function compile(material: Material) {
  const shader = {
    uniforms: {} as Record<string, { value: unknown }>,
    vertexShader: ShaderLib.standard.vertexShader,
    fragmentShader: ShaderLib.standard.fragmentShader,
  };
  (material as MeshStandardMaterial).onBeforeCompile?.call(
    material,
    shader as never,
    null as never,
  );
  return shader;
}

const SYSTEMS: SystemId[] = ['muscles', 'skeleton', 'organs', 'vessels', 'nerves'];

describe('表面质感：注入点在 three 的真实着色器里确实存在', () => {
  // 这一条是冲着"锚点变了、replace 静默失效"来的。皮肤那次就是这么栽的：
  // 结构没变、数值全对、就是画面不对，单测和 e2e 都拦不住。three 升级后
  // 这里会先红，而不是等人在手机上看出一片光滑。
  const VERTEX_ANCHORS = [
    'void main() {',
    '#include <project_vertex>',
    '#include <beginnormal_vertex>',
  ];
  const FRAGMENT_ANCHORS = [
    'void main() {',
    '#include <roughnessmap_fragment>',
    '#include <color_fragment>',
    '#include <normal_fragment_begin>',
  ];

  for (const a of VERTEX_ANCHORS) {
    it(`顶点着色器里有 ${a}`, () => {
      expect(ShaderLib.standard.vertexShader).toContain(a);
    });
  }
  for (const a of FRAGMENT_ANCHORS) {
    it(`片元着色器里有 ${a}`, () => {
      expect(ShaderLib.standard.fragmentShader).toContain(a);
    });
  }
});

describe('表面质感：注入结果', () => {
  it.each(SYSTEMS)('%s 完整档把噪声、顺纹方向与法线扰动都注进去了', (sys) => {
    const s = compile(createSystemMaterial(sys, 0x888888, 2));
    expect(s.fragmentShader).toContain('hyiSurfField');
    expect(s.fragmentShader).toContain('hyiFiberDir');
    expect(s.fragmentShader).toContain('hyiNoise');
    // 法线扰动确实挂在 normal_fragment_begin 之后（而不是只声明了 uniform 没用上）
    const at = s.fragmentShader.indexOf('#include <normal_fragment_begin>');
    expect(at).toBeGreaterThan(0);
    expect(s.fragmentShader.slice(at, at + 1400)).toContain('normal = normalize(normal -');
    expect(s.fragmentShader.slice(at, at + 1400)).toContain('uSurfBump');
    // 顶点侧：世界坐标与世界法线两个 varying
    expect(s.vertexShader).toContain('vHyiSurf');
    expect(s.vertexShader).toContain('vHyiSurfN');
  });

  it('合批分支在：漏了它噪声采样域会从 ±800 毫米塌成 ±1', () => {
    const s = compile(createSystemMaterial('muscles', 0x888888, 2));
    // 世界坐标与世界法线都要乘上批矩阵，两处都不能漏
    const worldPos = s.vertexShader.match(/vHyiSurf = [^;]+;/g) ?? [];
    const worldNrm = s.vertexShader.match(/vHyiSurfN = [^;]+;/g) ?? [];
    expect(worldPos.some((l) => l.includes('batchingMatrix'))).toBe(true);
    expect(worldNrm.some((l) => l.includes('batchingMatrix'))).toBe(true);
    expect(s.vertexShader).toContain('#ifdef USE_BATCHING');
  });

  it('档位 0 一个字都不注入——low 档要真的零成本', () => {
    const s = compile(createSystemMaterial('muscles', 0x888888, 0));
    expect(s.fragmentShader).not.toContain('hyiSurfField');
    expect(s.vertexShader).not.toContain('vHyiSurf');
    // 但边缘光还在：档位 0 只关表面质感，不该顺手把别的也关掉
    expect(s.fragmentShader).toContain('uRimColor');
  });

  it('皮肤不走这条路（它有自己的毛孔着色器）', () => {
    const s = compile(createSystemMaterial('skin', 0x888888, 2));
    expect(s.fragmentShader).not.toContain('hyiSurfField');
  });
});

describe('表面质感：装饰器要能叠加', () => {
  // addFresnelRim 原来是直接 `material.onBeforeCompile = ...`，谁加在它之后
  // 都会被整个吞掉，而且吞得无声无息。这条锁住"两个都在"。
  it('边缘光与表面质感同时生效，不互相覆盖', () => {
    const s = compile(createSystemMaterial('muscles', 0x888888, 2));
    expect(s.fragmentShader).toContain('uRimColor');
    expect(s.fragmentShader).toContain('uSurfFreq');
    expect(Object.keys(s.uniforms)).toEqual(
      expect.arrayContaining(['uRimColor', 'uSurfFreq', 'uSurfFull']),
    );
  });

  it('两个装饰器的 cacheKey 都要留在 key 里，否则 three 不会重新编译', () => {
    const m = createSystemMaterial('muscles', 0x888888, 2);
    const key = m.customProgramCacheKey?.call(m) ?? '';
    expect(key).toContain('surf:muscles');
    expect(key).toContain('rim:');
  });
});

describe('表面质感：跟着画质开关实时切档', () => {
  it('高画质开关拨过去，uSurfFull 跟着变——材质是加载时建的，不能只在编译期定', () => {
    const m = createSystemMaterial('muscles', 0x888888, 1);
    const s = compile(m);
    expect(s.uniforms.uSurfFull!.value).toBe(0);
    setSurfaceDetail(m, 2);
    expect(s.uniforms.uSurfFull!.value).toBe(1);
    setSurfaceDetail(m, 1);
    expect(s.uniforms.uSurfFull!.value).toBe(0);
  });

  it('没编译过的材质上调用不炸', () => {
    expect(() => setSurfaceDetail(new MeshStandardMaterial(), 2)).not.toThrow();
  });
});

describe('画质档与表面质感的对应', () => {
  it('low 关掉（软件渲染兜底，e2e 也跑在这一档，加了质感不该拖慢它）', () => {
    expect(QUALITY_CAPS.low.surfaceDetail).toBe(0);
  });

  it('medium 走便宜档、high 走完整档', () => {
    expect(QUALITY_CAPS.medium.surfaceDetail).toBe(1);
    expect(QUALITY_CAPS.high.surfaceDetail).toBe(2);
  });
});
