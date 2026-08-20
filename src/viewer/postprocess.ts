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
    ao.updateGtaoMaterial({
      radius: 30,
      distanceExponent: 1.2,
      thickness: 12,
      scale: 1.1,
      samples: caps.aoSamples,
      screenSpaceRadius: false,
    });
    // 1.0 会把阴影压得太狠、像描了一圈脏边；0.85 刚好只在真凹处见效
    ao.blendIntensity = 0.85;
    composer.addPass(ao);
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
      composer.setSize(width, height);
      outline?.setSize(width, height);
      // AO 可以按比例降分辨率跑：它是低频信号，半分辨率肉眼看不出，
      // 但填充率省一半——手机上开不开 AO 的分界线就在这儿
      ao?.setSize(
        Math.max(1, Math.round(width * caps.aoScale)),
        Math.max(1, Math.round(height * caps.aoScale)),
      );
    },
    setSelected(objects) {
      if (outline) outline.selectedObjects = objects;
    },
    render() {
      composer.render();
    },
    dispose() {
      composer.dispose();
    },
  };
}
