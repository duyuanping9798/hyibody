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
  /** 环境光遮蔽（GTAO）。人体看起来有没有体积，八成靠这一档 */
  ssao: boolean;
  /** AO 采样数：越多越干净，越贵 */
  aoSamples: number;
  /**
   * AO 的渲染分辨率倍率。AO 是低频信号，半分辨率肉眼看不出，填充率省一半——
   * 手机上"开不开得起 AO"的分界线就在这儿。
   */
  aoScale: number;
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
    aoSamples: 8,
    aoScale: 0.5,
    softShadows: false,
  },
  medium: {
    postprocessing: true,
    outline: true,
    bloom: true,
    smaa: true,
    // AO 在 medium 也开：它不是锦上添花，是"皮肤看起来有没有肉"的分界线，
    // 而 medium 正是绝大多数手机拿到的档位。代价用半分辨率 + 8 次采样买单。
    // 真机上若掉帧，先把 aoScale 调到 0.4 或把这一行改回 false（人类待办）。
    ssao: true,
    aoSamples: 8,
    aoScale: 0.5,
    softShadows: false,
  },
  high: {
    postprocessing: true,
    outline: true,
    bloom: true,
    smaa: true,
    ssao: true,
    aoSamples: 16,
    aoScale: 1,
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
