import {
  Color,
  HalfFloatType,
  Vector2,
  WebGLRenderTarget,
  type Camera,
  type Object3D,
  type Scene,
  type WebGLRenderer,
} from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutlinePass } from 'three/addons/postprocessing/OutlinePass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import type { QualityCaps } from './quality';

/** 选中描边配色（与界面强调色一致）。 */
export const OUTLINE_VISIBLE = 0x5ef0ea;
export const OUTLINE_HIDDEN = 0x1d6f8c;

export interface RenderPipeline {
  composer: EffectComposer;
  outline: OutlinePass | null;
  setSize(width: number, height: number, pixelRatio: number): void;
  setSelected(objects: Object3D[]): void;
  /**
   * AO 闸门：GTAO 渲法线/深度前后各回调一次。
   *
   * GTAO 用 overrideMaterial 渲场景，逐实例 alpha 完全不参与——0.12 的半透明
   * 骨骼会以**实体**进深度缓冲，AO 把它的轮廓当真实遮挡物整片印在器官上
   * （2026-08-22 真机马赛克的另一半成因）。查看器用这个闸门在 AO 通道里
   * 临时藏起"不够实"的批，渲完恢复。
   */
  setAOGate(gate: { prepare(): void; restore(): void } | null): void;
  render(): void;
  dispose(): void;
}

/**
 * 组装后处理链：RenderPass →（SSAO）→ 描边 → 轻 bloom → OutputPass（色调映射 +
 * 色彩空间）→ SMAA。
 *
 * 顺序上有两个坑：OutputPass 必须在 bloom 之后——bloom 要在线性 HDR 上做，
 * 放到色调映射之后会把已经压过的高光再糊一遍；SMAA 必须在 OutputPass 之后——
 * 它是按感知亮度找边的，喂 HDR 值会到处误判。
 */
export function createRenderPipeline(
  renderer: WebGLRenderer,
  scene: Scene,
  camera: Camera,
  caps: QualityCaps,
): RenderPipeline {
  // 自建渲染目标：EffectComposer 默认不给模板缓冲，而剖切封盖靠模板测试实现
  const size = renderer.getSize(new Vector2());
  const target = new WebGLRenderTarget(Math.max(1, size.x), Math.max(1, size.y), {
    type: HalfFloatType,
    stencilBuffer: true,
    // MSAA：走 EffectComposer 之后 canvas 自带的 antialias 完全失效（场景画进
    // 这个自建 target），SMAA 是形态学 AA，救不了解剖网格这种亚像素三角形密度。
    // WebGL2 的多重采样 target 由 three 自动 blit 解析，iOS 也支持。
    samples: 4,
  });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));

  /**
   * 环境光遮蔽：SSAO → GTAO。
   *
   * 换的理由不是"新的更好"，是**这一档决定了人体看起来有没有体积**。
   * SSAO 靠半球采样凑遮蔽，人体这种大片平滑曲面上出来的是一层灰雾；
   * GTAO 算的是水平角遮蔽，腋窝、颈侧、锁骨窝、指缝这些真正的凹处才会暗下去
   * ——皮肤从"塑料模特"变成"有肉"，八成靠这个，而且一个三角面都不用多加。
   *
   * 半径按毫米给：人体的褶皱在 10–40 mm 这个量级，默认值（场景单位 0.25）
   * 在毫米坐标系里等于没有。
   */
  let ao: GTAOPass | null = null;
  if (caps.ssao) {
    ao = new GTAOPass(scene, camera, Math.max(1, size.x), Math.max(1, size.y));
    /*
     * 半径走**屏幕空间**，不走世界空间。
     *
     * 第一版按毫米给（radius: 30），用 `?aodebug=1` 把 AO 缓冲直接画出来一看：
     * 几乎全白，只有手指和腿缝有几道游丝——也就是说 AO 在跑，但等于没有。
     * 原因是这个查看器的观察距离跨了两个数量级：整具人体（相机 2.6 米外）到
     * 一颗晶状体（25 毫米外）。任何固定的世界半径，在一头是看不见的游丝，
     * 在另一头是糊成一片的脏。
     *
     * `screenSpaceRadius` 把半径钉在屏幕上（1.0 ≈ 100 像素），于是无论推到多近，
     * 遮蔽的尺度始终是"眼睛看到的那么大"。
     */
    ao.updateGtaoMaterial({
      radius: 0.6,
      distanceExponent: 1.0,
      /*
       * `thickness` **不是**屏幕空间的，它按视图空间的毫米比：着色器里那一行是
       * `if (abs(viewDelta.z) < thickness)`——采样点与本像素的深度差超过它就被
       * 当成"另一个物体"丢掉。默认值 1 是给单位尺度的场景用的，在毫米坐标系里
       * 等于"只接受 1 毫米以内的遮挡"，于是几乎所有采样都被丢掉，AO 恒等于 1。
       * 这就是 AO 缓冲一片全白的真正原因（`?aodebug=4` 看出来的）。
       * 人体的凹处（腋窝、腹股沟、指缝）深度差在几十到两百毫米量级。
       */
      thickness: 200,
      scale: 1.2,
      samples: caps.aoSamples,
      screenSpaceRadius: true,
    });
    ao.blendIntensity = 1;
    // `?aodebug=1` 直接输出 AO 缓冲。留着是有代价的（一行生产代码），
    // 但没有它就只能盯着成片猜"AO 到底有没有生效"——上面那个坑正是这么找出来的。
    // 2=深度 3=法线 4=AO 5=降噪后：查"到底哪一环是空的"要靠逐环看
    const debug = Number(new URLSearchParams(location.search).get('aodebug'));
    if (debug >= 2 && debug <= 5) ao.output = debug;
    composer.addPass(ao);
  }

  // AO 闸门（见接口注释）。包的是 pass.render 而不是加新 pass：
  // GTAO 的法线/深度预通道在它自己的 render 里，外面没有别的挂点。
  let aoGate: { prepare(): void; restore(): void } | null = null;
  if (ao) {
    const originalRender = ao.render.bind(ao);
    ao.render = (...args: Parameters<GTAOPass['render']>) => {
      aoGate?.prepare();
      try {
        originalRender(...args);
      } finally {
        aoGate?.restore();
      }
    };
  }

  let outline: OutlinePass | null = null;
  if (caps.outline) {
    outline = new OutlinePass(new Vector2(1, 1), scene, camera);
    // 描边亮度压在 bloom 阈值附近：再高一点整个选中结构会罩上一圈光晕
    outline.edgeStrength = 2.0;
    outline.edgeGlow = 0.1;
    outline.edgeThickness = 1.0;
    outline.pulsePeriod = 0;
    outline.visibleEdgeColor = new Color(OUTLINE_VISIBLE);
    outline.hiddenEdgeColor = new Color(OUTLINE_HIDDEN);
    composer.addPass(outline);
  }

  if (caps.bloom) {
    // 轻 bloom：阈值卡在 1.0 以上——只有真正过曝的像素才发光，
    // 阈值低了整具骨架都会罩一层白雾（实测 0.92 就糊）。
    //
    // radius 0.6 → 0.25：0.6 会把过曝像素铺到屏幕很大一片，人体越亮铺得越开，
    // 最后在深色背景上糊出一个圆盘——用户看到直接问"那个圆圈是什么背景"。
    // 它根本不是背景，是 bloom 的最大那几级 mip。收紧之后只在真正过曝处发光。
    const bloom = new UnrealBloomPass(new Vector2(1, 1), 0.14, 0.25, 1.15);
    composer.addPass(bloom);
  }

  composer.addPass(new OutputPass());

  if (caps.smaa) composer.addPass(new SMAAPass());

  return {
    composer,
    outline,
    setSize(width, height, pixelRatio) {
      composer.setPixelRatio(pixelRatio);
      // composer.setSize 内部会以 width × pixelRatio 调每个 pass 的 setSize——
      // **不要再用 CSS 像素覆盖回去**。原来这里跟着一行
      // `outline?.setSize(width, height)`，等于把描边缓冲降回 1/pixelRatio；
      // AO 那行更糟：CSS × aoScale，而帧缓冲是 CSS × pixelRatio——iPhone
      // （DPR 3，pixelRatio 取 2）上 AO 只有帧缓冲 1/4 的线性分辨率，放大回屏
      // 就是人类实拍里 4–8px 的硬锯齿色块。桌面恰好 aoScale=1、DPR=1 抵消，
      // e2e 又全跑无 AO 的 low 档，这个 bug 藏了三个版本（2026-08-22 真机逮到）。
      composer.setSize(width, height);
      // AO 仍按比例降分辨率（低频信号，省一半填充率），但基数必须是设备像素
      ao?.setSize(
        Math.max(1, Math.round(width * pixelRatio * caps.aoScale)),
        Math.max(1, Math.round(height * pixelRatio * caps.aoScale)),
      );
    },
    setSelected(objects) {
      if (outline) outline.selectedObjects = objects;
    },
    setAOGate(gate) {
      aoGate = gate;
    },
    render() {
      composer.render();
    },
    dispose() {
      composer.dispose();
    },
  };
}
