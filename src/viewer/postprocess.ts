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
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
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

  let ssao: SSAOPass | null = null;
  if (caps.ssao) {
    ssao = new SSAOPass(scene, camera);
    // 人体尺度是毫米：AO 半径按毫米给，否则默认值（8）在这个场景里等于没有
    ssao.kernelRadius = 24;
    ssao.minDistance = 0.0006;
    ssao.maxDistance = 0.06;
    composer.addPass(ssao);
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
    // 阈值低了整具骨架都会罩一层白雾（实测 0.92 就糊）
    const bloom = new UnrealBloomPass(new Vector2(1, 1), 0.17, 0.6, 1.05);
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
      ssao?.setSize(width, height);
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
