import { describe, expect, it } from 'vitest';
import { ShaderLib, MeshStandardMaterial, type Material } from 'three';
import {
  batchModeFor,
  createSystemMaterial,
  createXRayMaterial,
  DEPTH_WRITE_MIN_OPACITY,
  setMaterialOpacity,
  setSurfaceDetail,
  shouldWriteDepth,
  SYSTEM_COLORS,
} from '../../src/viewer/materials';
import { QUALITY_CAPS } from '../../src/viewer/quality';
import type { SystemId } from '../../src/data/types';

/** 造一份和 three 真实来源一致的 shader 对象喂给 onBeforeCompile。 */
function compile(material: Material, lib: 'standard' | 'basic' = 'standard') {
  const shader = {
    uniforms: {} as Record<string, { value: unknown }>,
    vertexShader: ShaderLib[lib].vertexShader,
    fragmentShader: ShaderLib[lib].fragmentShader,
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

describe('X-ray 皮肤壳', () => {
  // 2026-08-21 人类拍板把皮肤退回 X-ray 壳。**不能直接用回旧实现**：旧版是裸
  // ShaderMaterial，顶点写死 `modelMatrix * vec4(position, 1.0)`，不认合批矩阵；
  // 而皮肤自 v1.1 起走 BatchedMesh，glb 顶点又是量化过的（局部坐标在 ±1 附近），
  // 直接用回去皮肤会缩成原点附近的一小团。这几条就是锁这个。
  it('世界法线的注入点必须是无条件执行的那一段', () => {
    // 真踩过：原来挂在 <beginnormal_vertex> 之后，而 basic 的顶点着色器里那一句
    // 被 `#if defined(USE_ENVMAP) || defined(USE_SKINNING)` 包着——我们两个都没有，
    // 整段被预处理器编译掉，vXrayN 永远不被赋值。normalize(未初始化) 得到 NaN，
    // 皮肤一个像素都画不出来，**而着色器编译得好好的、控制台一声不吭**。
    const v = compile(createXRayMaterial(0xffffff, 1), 'basic').vertexShader;
    const guard = v.indexOf('USE_ENVMAP');
    const assign = v.indexOf('vXrayN =');
    expect(assign).toBeGreaterThan(0);
    expect(guard).toBeGreaterThan(0);
    expect(assign, '法线赋值落在 USE_ENVMAP 守卫之后 = 会被编译掉').toBeLessThan(guard);
  });

  it('认合批矩阵——世界坐标与世界法线两处都要乘', () => {
    const s = compile(createXRayMaterial(0xffffff, 1), 'basic');
    expect(s.vertexShader).toContain('#ifdef USE_BATCHING');
    const world = s.vertexShader.match(/vXrayW = [^;]+;/g) ?? [];
    const normal = s.vertexShader.match(/vXrayN = [^;]+;/g) ?? [];
    expect(world.some((l) => l.includes('batchingMatrix'))).toBe(true);
    expect(normal.some((l) => l.includes('batchingMatrix'))).toBe(true);
  });

  it('菲涅尔与逐实例不透明度都进了最终输出', () => {
    const s = compile(createXRayMaterial(0xffffff, 1), 'basic');
    // 颜色和不透明度由 setColorAt 经 vColor 乘进 diffuseColor，这里只叠菲涅尔
    expect(s.fragmentShader).toContain('uXrayPower');
    expect(s.fragmentShader).toMatch(
      /gl_FragColor = vec4\(diffuseColor\.rgb,[^)]*diffuseColor\.a\)/,
    );
  });

  it('开了顶点色——否则每实例的 alpha 到不了片元，分层滑块就推不动皮肤', () => {
    expect(createXRayMaterial(0xffffff, 1).vertexColors).toBe(true);
  });

  it('加色混合且不写深度——透视壳不该挡住里面的结构', () => {
    const m = createXRayMaterial(0xffffff, 1);
    expect(m.depthWrite).toBe(false);
    expect(m.transparent).toBe(true);
  });

  it('皮肤配色退回品牌青', () => {
    expect(SYSTEM_COLORS.skin).toBe(0x4fc3d9);
  });
});

describe('半透明的层不写深度', () => {
  // 合批改造时弄丢的一条老修复：合批前每结构一份材质，setMaterialOpacity 里有
  // `depthWrite = opacity > 0.55`（"半透明叠加时关闭深度写入，减少互相遮挡的闪面"）。
  // 改成一系统一份材质后 depthWrite 被写死 true，那个函数也再没人调用——
  // 静默失效。人类实拍看到的是"许多断裂的地方"：颅骨是 21 块骨头的并集、
  // 表面互相重叠，半透明又写深度时只留下赢了深度测试的片，碎成一片。
  it('判据本身：半透明不写、够实才写', () => {
    expect(shouldWriteDepth(0.35), '半透明时应关掉深度写入').toBe(false);
    expect(shouldWriteDepth(0.9), '够实时应恢复深度写入').toBe(true);
    expect(shouldWriteDepth(DEPTH_WRITE_MIN_OPACITY), '阈值本身不算实').toBe(false);
  });

  it('materials 与 viewer 走同一条判据，不是各写一个魔数', () => {
    const m = new MeshStandardMaterial({ transparent: true });
    setMaterialOpacity(m, 0.35);
    expect(m.depthWrite).toBe(shouldWriteDepth(0.35));
    setMaterialOpacity(m, 0.9);
    expect(m.depthWrite).toBe(shouldWriteDepth(0.9));
  });
});

describe('批的渲染形态（batchModeFor）——2026-08-22 真机马赛克的修复判据', () => {
  it('整批实心走真正的不透明路径', () => {
    expect(batchModeFor(1, 1, false)).toBe('opaque');
  });

  it('批里还有半透明实例时不能进不透明队列——器官 1.0 + 展开件 0.6 仍是混合', () => {
    expect(batchModeFor(1, 0.6, false)).toBe('blend-depth');
  });

  it('峰值过了 0.55 写深度、没过不写（沿用旧判据）', () => {
    expect(batchModeFor(0.78, 0.78, false)).toBe('blend-depth');
    expect(batchModeFor(0.3, 0.3, false)).toBe('blend');
  });

  it('加色壳（X-ray 皮肤）永远纯混合——旧的 syncDepthWrite 会在分层 0 时把它的深度写入静默改成 true', () => {
    expect(batchModeFor(1, 1, true)).toBe('blend');
  });

  it('空批（没有可见实例）不实心也不写深度', () => {
    // applyVisibility 对空批传 peak=0 / minVisible=1
    expect(batchModeFor(0, 1, false)).toBe('blend');
  });
});
