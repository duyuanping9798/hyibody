/**
 * 画质档位（B 步：渲染升级）。
 *
 * - `low`：直接 renderer.render，不走后处理。软件渲染（云端 CI、无 GPU 的机器）
 *   走这一档，否则 bloom/SMAA 一帧要好几秒。
 * - `medium`：EffectComposer（描边 + 轻 bloom + SMAA）。移动端与桌面的默认。
 * - `high`：再加软阴影与 SSAO。桌面默认开、移动端默认关（KICKOFF 的"高画质"开关）。
 */
export type QualityTier = 'low' | 'medium' | 'high';

export interface QualityCaps {
  /** 是否走 EffectComposer */
  postprocessing: boolean;
  /** OutlinePass 选中描边 */
  outline: boolean;
  /** UnrealBloomPass 轻辉光 */
  bloom: boolean;
  /** SMAA 抗锯齿（关掉时退回 renderer 自带的 MSAA） */
  smaa: boolean;
  /** 屏幕空间环境光遮蔽 */
  ssao: boolean;
  /** 平行光软阴影 + 地面接影 */
  softShadows: boolean;
}

export const QUALITY_CAPS: Record<QualityTier, QualityCaps> = {
  low: {
    postprocessing: false,
    outline: false,
    bloom: false,
    smaa: false,
    ssao: false,
    softShadows: false,
  },
  medium: {
    postprocessing: true,
    outline: true,
    bloom: true,
    smaa: true,
    ssao: false,
    softShadows: false,
  },
  high: {
    postprocessing: true,
    outline: true,
    bloom: true,
    smaa: true,
    ssao: true,
    softShadows: true,
  },
};

export interface QualityEnv {
  /** WEBGL_debug_renderer_info 报出来的渲染器名里带 swiftshader/llvmpipe/software */
  softwareRenderer: boolean;
  /** 粗指针（触摸屏） */
  coarsePointer: boolean;
  viewportWidth: number;
  /** 逻辑核数，navigator.hardwareConcurrency */
  cores: number;
}

/**
 * 默认档位：软件渲染永远 low；触摸屏/窄屏/低核数用 medium（高画质开关默认关）；
 * 其余桌面默认 high。用户可以在界面上手动切换 medium ⇄ high，但 low 不给切——
 * 那是"这台机器跑不动"的兜底。
 */
export function defaultQuality(env: QualityEnv): QualityTier {
  if (env.softwareRenderer) return 'low';
  if (env.coarsePointer || env.viewportWidth < 900 || env.cores <= 4) return 'medium';
  return 'high';
}

/** 高画质开关能否切换（low 档是硬件兜底，不给切）。 */
export function canToggleHighQuality(tier: QualityTier): boolean {
  return tier !== 'low';
}

/** 读浏览器环境；测试里直接构造 QualityEnv，不走这个函数。 */
export function readQualityEnv(gl: WebGLRenderingContext | WebGL2RenderingContext): QualityEnv {
  let renderer = '';
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (ext) renderer = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) ?? '');
  } catch {
    renderer = '';
  }
  return {
    softwareRenderer: /swiftshader|llvmpipe|software|mesa offscreen/i.test(renderer),
    coarsePointer:
      typeof matchMedia === 'function' ? matchMedia('(pointer: coarse)').matches : false,
    viewportWidth: typeof window === 'undefined' ? 1280 : window.innerWidth,
    cores: typeof navigator === 'undefined' ? 8 : (navigator.hardwareConcurrency ?? 8),
  };
}
