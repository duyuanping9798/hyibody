import {
  ACESFilmicToneMapping,
  Box3,
  Clock,
  DoubleSide,
  FrontSide,
  Group,
  Mesh,
  PCFSoftShadowMap,
  PMREMGenerator,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
  Color,
  NormalBlending,
  type Material,
  type MeshStandardMaterial,
  type Plane,
  type Side,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { loadManifest } from '../data/manifest';
import type { Manifest, SystemId } from '../data/types';
import { backgroundOrder, FIRST_SCREEN_SYSTEMS } from './loadOrder';
import { ANIMATED_STRUCTURES, pulseTransform, type PulseBase } from './animation';
import { BufferGeometry, MeshBasicMaterial } from 'three';
import {
  createCameraRig,
  poseForBox,
  poseForFocus,
  type CameraRig,
  type SafeInsets,
  type ViewPresetId,
} from './camera';
import {
  applyDrift,
  CINEMATIC_FLIGHT,
  DIRECT_FLIGHT,
  EASINGS,
  MAX_DRIFT_S,
  type EaseId,
  type FlightOptions,
  type MotionId,
} from './cinematic';
import { CAP_MIN_OPACITY, ClipCaps } from './clipCaps';
import { clipPlaneFor, type ClipAxis } from './clipping';
import { HIGHLIGHT_COLOR, HIGHLIGHT_TINT, type HighlightLevel } from './highlight';
import { SystemBatch, type BatchInput } from './batching';
import { computeSystemOpacity, PICKABLE_OPACITY_THRESHOLD } from './layers';
import { probeBody, type Bbox, type ProbeResult, type ProbeTarget } from './regions';
import {
  batchModeFor,
  colorForStructure,
  createSystemMaterial,
  createXRayMaterial,
  setSurfaceDetail,
  type BatchMode,
  type SurfaceDetailLevel,
} from './materials';
import { createRenderPipeline, type RenderPipeline } from './postprocess';
import {
  canToggleHighQuality,
  defaultQuality,
  QUALITY_CAPS,
  readQualityEnv,
  type QualityTier,
} from './quality';
import { createStage, fitStage, type Stage } from './stage';
import { anchorPoint } from './anchor';
import { CLICK_MOVE_TOLERANCE_PX, StructurePicker } from './picking';

export interface HyiViewerOptions {
  /** 站点部署基路径，传 import.meta.env.BASE_URL */
  base: string;
  /** 强制画质档位（?hq= 或测试用）；不传则按设备能力自动判断 */
  quality?: QualityTier | undefined;
}

/** 近裁剪面的下限（毫米）：再近就没有深度精度可言了，也没人会凑得比这更近。 */
const NEAR_MIN_MM = 0.2;
/** 标签落点重算间隔（毫秒）。 */
const ANCHOR_CACHE_MS = 120;
const SCRATCH_SIZE = new Vector3();

/** 两次点击间隔小于这个毫秒数、位移小于这个像素，算一次双击（鼠标和触屏同一套逻辑）。 */
const DOUBLE_TAP_MS = 320;
const DOUBLE_TAP_MOVE_PX = 24;
/** 双击重新定心时凑近到原距离的这个比例，但不近于这个毫米数。 */
const RECENTER_FACTOR = 0.55;
const RECENTER_MIN_MM = 60;

export interface LoadOptions {
  /**
   * 分享链接点名的结构（`?v=` 里的 selected）。它所在的系统插到后台补载最前面。
   * 传 slug 而不是系统名：调用方在 manifest 到手之前并不知道结构属于哪个系统。
   */
  prioritizeStructure?: string;
}

/** 分层缓动：跨度超过阈值才缓动（拖滑块要跟手，奥秘跳转要顺滑），时间常数秒。 */
const LAYER_EASE_THRESHOLD = 0.08;
const LAYER_EASE_TAU = 0.12;

/** 透明排序辅助：由内到外的渲染顺序。 */
const RENDER_ORDER: Record<SystemId, number> = {
  nerves: 1,
  vessels: 2,
  organs: 3,
  skeleton: 4,
  muscles: 5,
  skin: 6,
};

interface StructureEntry {
  slug: string;
  system: SystemId;
  /**
   * 代理网格：几何体与变换还在、也还在场景里，但材质 `visible: false`，**不参与绘制**。
   *
   * 留着它是为了三件事一行都不用改——标签落点的射线求交（anchor.ts）、
   * 剖切封盖的模板网格（挂成它的子节点）、拾取。three 的 `projectObject` 按
   * **对象自己的材质**决定入不入渲染列表，所以连 AO 那种 override 通道也绕不过
   * `material.visible = false`；而子节点的渲染不受父节点材质影响。
   */
  mesh: Mesh;
  /** 代理的隐形材质，只用来挡住绘制；真正的外观走 batch */
  material: Material;
  /** 这个结构在哪个系统批里 */
  batch: SystemBatch;
  /** 当前生效的不透明度。以前靠读 material.opacity，合批之后材质是共享的，得自己记 */
  opacity: number;
  highlight: HighlightLevel;
  /** 结构本色，剖切封盖的断面用同一个颜色 */
  color: number;
  /** 内部件指向父结构（心室壁 → 心脏）；顶层结构为 null */
  parent: string | null;
}

/**
 * 是不是"整具人体的外壳"。
 *
 * 目前只有皮肤：它是一张罩住全身的网格，描边就是给整个剪影镶一圈光，
 * 自发光就是把人整个染色。其它任何结构都指得出具体位置，该高亮就高亮。
 */
function isWholeBody(entry: StructureEntry): boolean {
  return entry.system === 'skin' && entry.parent === null;
}

export interface ViewerState {
  layer: number;
  systemsVisible: Record<SystemId, boolean>;
  systemOpacity: Record<SystemId, number>;
  hidden: Set<string>;
  isolated: string | null;
  selected: string | null;
  /** 正在"展开内部"的父结构：它自己隐藏、内部件显示 */
  expanded: string | null;
  clip: { axis: ClipAxis; pos: number; flip?: boolean } | null;
}

function defaultViewerState(): ViewerState {
  return {
    layer: 0,
    systemsVisible: {
      skin: true,
      muscles: true,
      skeleton: true,
      organs: true,
      vessels: true,
      nerves: true,
    },
    systemOpacity: { skin: 1, muscles: 1, skeleton: 1, organs: 1, vessels: 1, nerves: 1 },
    hidden: new Set(),
    isolated: null,
    selected: null,
    expanded: null,
    clip: null,
  };
}

/**
 * 纯 three.js 渲染核心（禁止 import React）。
 * M1-6：首屏皮肤+骨骼 → 其余系统后台加载；分层滑块；点击识别 + 悬停高亮；
 * 隔离/隐藏；单剖切面；预设视角与平滑对准。UI 通过公开方法驱动，事件回传。
 */
export class HyiViewer extends EventTarget {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly root = new Group();

  private readonly container: HTMLElement;
  private readonly rig: CameraRig;
  private readonly clock = new Clock();
  private readonly resizeObserver: ResizeObserver;
  private readonly picker = new StructurePicker();
  /** 标签引线的落点计算复用同一根射线，别每帧新建 */
  private readonly anchorRay = new Raycaster();
  private anchorCache: { slug: string; point: Vector3; at: number } | null = null;
  private disposed = false;
  private manifest: Manifest | null = null;

  private readonly structures = new Map<string, StructureEntry>();
  private readonly systemGroups = new Map<SystemId, Group>();
  /** 会做微动画的结构（心/肺）的基准变换：glb 节点自带的反量化 TRS，动画只在其上叠加 */
  private readonly pulseBases = new Map<string, PulseBase>();
  private readonly state = defaultViewerState();
  private hovered: string | null = null;
  /** ?v= 分享链接选中的结构可能还在后台加载：记下来，等它注册进来再选中。 */
  private pendingSelect: string | null = null;
  private stage!: Stage;
  /** 剖切封盖：剖开的结构露出实心断面而不是空壳 */
  private readonly clipCaps = new ClipCaps();
  private pipeline: RenderPipeline | null = null;
  private quality: QualityTier = 'medium';
  private contentBox = new Box3();
  /** 画布上下被界面挡住多少（CSS 像素），由 UI 层量好了推进来 */
  private safeInsets = { top: 0, bottom: 0 };
  private framedWithInsets = false;
  /** 相机是否还停在自动算出来的全身取景上（用户一聚焦/一飞走就不是了） */
  private autoFramed = false;
  /** WebGL 上下文丢失期间停帧循环，别对着死的上下文空转 */
  private contextLost = false;
  private clipPlane: Plane | null = null;
  private flight: {
    fromPos: Vector3;
    fromTarget: Vector3;
    toPos: Vector3;
    toTarget: Vector3;
    /** 中途抬升方向 × 距离；直线插值会穿过人体，抬一点就绕开了 */
    lift: Vector3;
    t: number;
    durationS: number;
    ease: EaseId;
  } | null = null;
  /**
   * 奥秘播放时的运镜。`null` = 普通交互（飞行短促、停下就真的停住）；
   * 给了值就用"电影感"的飞行手感，并在飞到位之后继续做那个微动作。
   */
  private cinematic: { motion: MotionId; speed: number; flight: Required<FlightOptions> } | null =
    null;
  /**
   * 用户上手拖了，就把这一步剩下的微动作停掉。
   * 否则手一松相机还在自己滑，像"甩不掉"——奥秘播放时观众随时可以自己转一转，
   * 那一刻镜头必须完全交给他。下一步开始（下一次 flyTo）自动恢复。
   */
  private driftSuspended = false;
  /** 本步已经做了多久微动作。到 MAX_DRIFT_S 就停，免得一路推到贴脸。 */
  private driftElapsed = 0;
  /** 每系统一个合批。逐结构的外观全部经由它写进每实例纹理。 */
  private readonly batches = new Map<SystemId, SystemBatch>();
  /**
   * 描边专用代理：`OutlinePass` 要求被描的对象在场景里、且能进渲染列表，
   * 而结构代理的材质是 `visible: false`（不进列表）。给每个结构都放开就是
   * 235 次白画——所以只留**一份**，选中谁就把谁的几何体与变换换上来。
   * 材质 `colorWrite: false`：它自己什么都不画，只为 OutlinePass 提供一份可描的形。
   */
  /** 每个系统批当前的渲染形态（applyVisibility 里刷新，AO 闸门也读它） */
  private readonly batchMode = new Map<SystemId, BatchMode>();
  /** 正在走实心代理绘制的那一个结构（选中/隔离的特例），null = 没有 */
  private soloProxy: StructureEntry | null = null;
  /** 实心代理的材质缓存（每系统一份，省着色器编译） */
  private readonly soloMaterials = new Map<SystemId, MeshStandardMaterial>();
  /** AO 闸门每帧临时藏起来的批，渲完恢复 */
  private readonly aoHiddenMeshes: Mesh[] = [];

  private readonly outlineProxy = new Mesh(
    new BufferGeometry(),
    new MeshBasicMaterial({ colorWrite: false, depthWrite: false }),
  );
  private readonly statsEnabled =
    typeof location !== 'undefined' && new URLSearchParams(location.search).get('stats') === '1';
  /**
   * 每帧画完之后同步调一次，参数是 WebGL 画布本身。录像用。
   *
   * 为什么非要在渲染循环里给一个钩子，而不是让录像器自己 `requestAnimationFrame`：
   * 没开 `preserveDrawingBuffer` 时，WebGL 画布的内容在浏览器合成之后就作废了，
   * 隔一个任务再 `drawImage` 只能拿到黑帧。必须在 `render()` 之后、
   * 让出主线程之前把这一帧抄走。
   */
  private frameTap: ((canvas: HTMLCanvasElement) => void) | null = null;
  private pointerDownAt: { x: number; y: number } | null = null;
  private lastTap: { x: number; y: number; at: number } | null = null;
  /** 分层滑块缓动：大跳（奥秘、预设）平滑过渡，小步（拖滑块）立即跟手 */
  private layerTarget = 0;
  private layerEasing = false;
  /**
   * 扫描/混合两种模式（2026-08-22 控制条改独立推子）。
   * null = 扫描：不透明度 = 曲线(layer) × systemOpacity（倍率）——奥秘、展厅
   * 吸引动画、主场跳转与旧分享链接都走这条老路，行为一个字没改。
   * 非 null = 混合：这份六维向量就是每系统的最终不透明度，曲线与倍率都不参与。
   * **倍率（state.systemOpacity）在混合期间原样保留**——首版把混合值直接写进
   * 倍率字段，退出混合时两边就对不上了（奥秘压暗过的倍率被混合值顶掉）。
   */
  private mixCurrent: Record<SystemId, number> | null = null;
  /** 混合缓动目标（奥秘 mix 步骤、混合→扫描的交叉淡入用；拖推子是立即的） */
  private mixTarget: Record<SystemId, number> | null = null;
  /** 混合→扫描的过渡：先在混合空间缓动到目标扫描画面，落地那帧再交还曲线 */
  private scanAfterMix = false;

  constructor(
    container: HTMLElement,
    private readonly options: HyiViewerOptions,
  ) {
    super();
    this.container = container;
    this.renderer = new WebGLRenderer({
      antialias: true,
      alpha: false,
      // three r163 起 stencil 默认 false；剖切封盖靠模板测试实现，必须显式打开
      stencil: true,
      // 冒烟测试需要读回像素判断画面非空（tests/e2e/smoke.spec.ts）
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    // 清屏色跟着背景球一起压暗（背景球没盖到的角落用的是这个色）
    this.renderer.setClearColor(0x03050b, 1);
    this.renderer.localClippingEnabled = true;
    // 电影级色调映射 + 程序化环境光照（观感升级，无外部 HDR 资源）
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.98;
    container.appendChild(this.renderer.domElement);
    const pmrem = new PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    this.rig = createCameraRig(this.renderer.domElement, 1);
    this.scene.add(this.root);
    // 描边代理常驻场景（默认不可见）：OutlinePass 要求被描对象在场景图里
    this.outlineProxy.visible = false;
    this.outlineProxy.frustumCulled = false;
    this.root.add(this.outlineProxy);
    // 舞台：渐变背景球 + 三点光 + 接触阴影
    this.stage = createStage();
    this.scene.add(this.stage.root);
    this.scene.add(this.clipCaps.root);

    // 画质档位：软件渲染（云端 CI）自动退到 low，桌面默认 high，触摸屏默认 medium
    this.quality = options.quality ?? defaultQuality(readQualityEnv(this.renderer.getContext()));
    this.applyQuality();

    const dom = this.renderer.domElement;
    dom.addEventListener('pointerdown', this.onPointerDown);
    dom.addEventListener('pointerup', this.onPointerUp);
    dom.addEventListener('pointermove', this.onPointerMove);
    dom.addEventListener('pointerleave', this.onPointerLeave);
    dom.addEventListener('wheel', this.onWheel, { passive: true });
    dom.addEventListener('webglcontextlost', this.onContextLost);
    dom.addEventListener('webglcontextrestored', this.onContextRestored);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.renderer.setAnimationLoop(() => this.tick());
  }

  /**
   * 加载 manifest → 首屏系统（皮肤+骨骼）就绪即派发 'ready'，
   * 其余系统后台逐个加载并派发 'systemloaded'。
   */
  async load(opts: LoadOptions = {}): Promise<void> {
    try {
      this.manifest = await loadManifest(this.options.base);
      const systems = this.manifest.systems;
      const first = systems.filter((s) => (FIRST_SCREEN_SYSTEMS as string[]).includes(s.id));
      // 表里没有的系统排到最后：indexOf 找不到会返回 -1，直接拿去比大小
      // 等于把陌生系统排到骨骼**前面**——将来加个系统就会莫名其妙插队到首位
      // 分享链接点名了某个结构，就让它所在的系统排后台第一位。
      // 不这么做的话："?v=…selected=heart" 要等骨骼(4.9)+肌肉(9.5)共 14 MB 下完
      // 才轮到器官(4.5)：信息卡早就写着"心脏"，画面里却什么都没高亮，标签也不来。
      const wantedSystem = opts.prioritizeStructure
        ? this.manifest.structures[opts.prioritizeStructure]?.system
        : undefined;
      const rest = backgroundOrder(systems, wantedSystem);
      // 占位 manifest（无皮肤/骨骼）时退化为全量加载
      const firstBatch = first.length > 0 ? first : systems;
      let loaded = 0;
      this.emitProgress(0, systems.length);
      await Promise.all(
        firstBatch.map((s) =>
          this.loadSystem(s.id as SystemId, s.file).then(() => {
            loaded += 1;
            this.emitProgress(loaded, systems.length);
          }),
        ),
      );
      this.contentBox = new Box3().setFromObject(this.root);
      fitStage(this.stage, this.contentBox);
      this.frameContent();
      this.applyVisibility();
      this.container.dataset.hyiReady = '1';
      this.dispatchEvent(new CustomEvent('ready', { detail: { manifest: this.manifest } }));
      void (async () => {
        for (const s of first.length > 0 ? rest : []) {
          try {
            await this.loadSystem(s.id as SystemId, s.file);
            loaded += 1;
            this.emitProgress(loaded, systems.length);
            this.contentBox = new Box3().setFromObject(this.root);
            fitStage(this.stage, this.contentBox);
            this.applyVisibility();
            this.applyClip();
            this.dispatchEvent(new CustomEvent('systemloaded', { detail: { system: s.id } }));
          } catch (error) {
            this.dispatchEvent(new CustomEvent('loaderror', { detail: { system: s.id, error } }));
          }
        }
        // 首屏只剩皮肤之后，"ready" 与"画全了"之间隔了五个系统。截图脚本和
        // e2e 需要一个确定的信号来等，否则只能靠 waitForTimeout 猜——猜短了
        // 拍到的是一具光秃秃的皮肤，而且拍到什么全看当天机器多快。
        this.container.dataset.hyiLoaded = '1';
        this.dispatchEvent(new CustomEvent('allloaded'));
      })();
    } catch (error) {
      this.container.dataset.hyiError = String(error);
      this.dispatchEvent(new CustomEvent('error', { detail: error }));
      throw error;
    }
  }

  private async loadSystem(system: SystemId | 'placeholder', file: string): Promise<void> {
    const loader = new GLTFLoader();
    // 流水线 glb 经 meshopt 压缩（EXT_meshopt_compression，M1-4）
    loader.setMeshoptDecoder(MeshoptDecoder);
    const base = this.options.base.replace(/\/?$/, '/');
    const gltf = await loader.loadAsync(`${base}${file}`);
    const sys: SystemId = system === 'placeholder' ? 'skeleton' : system;
    const group = new Group();
    group.name = sys;
    const meshes: Mesh[] = [];
    gltf.scene.traverse((obj) => {
      if (obj instanceof Mesh) meshes.push(obj);
    });

    // 一个系统一份材质，不再一个结构一份。逐结构的**颜色**改由每实例颜色带，
    // 所以基色给白：着色器里 diffuseColor.rgb = 白 × 实例色。
    // vertexColors 必须开——否则 three 不定义 USE_COLOR_ALPHA，片元里拿不到 alpha，
    // 分层滑块的逐结构不透明度就没了（见 batching.ts 的长注释）。
    const shared =
      sys === 'skin'
        ? // 皮肤走 X-ray 壳（2026-08-21 人类拍板退回）：颜色与逐实例不透明度
          // 照旧由 setColorAt 乘进来，所以这里跟别的系统一样给白色
          createXRayMaterial(0xffffff, 1)
        : createSystemMaterial(sys, 0xffffff, this.surfaceDetailLevel());
    shared.vertexColors = true;
    // 合批之后没法逐结构切换 transparent：整批共用一份材质状态。
    // 保留混合、同时**写深度**——完全不透明的实例照样正确遮挡，
    // 半透明的靠 renderOrder 与逐实例排序，和以前一样。
    shared.transparent = true;
    // depthWrite 由 syncDepthWrite 按这一层当前的不透明度动态切——
    // 写死 true 会让半透明的层碎成一片（见那个方法的注释）
    shared.depthWrite = true;

    const inputs: BatchInput[] = [];
    for (const mesh of meshes) {
      const extras = (mesh.userData as { slug?: string; en?: string; parent?: string }) ?? {};
      const slug = extras.slug ?? mesh.name;
      const color = colorForStructure(sys, extras.en ?? slug, slug);
      mesh.geometry.computeBoundingBox();
      mesh.updateMatrixWorld(true);
      inputs.push({ slug, geometry: mesh.geometry, matrix: mesh.matrixWorld.clone(), color });
    }
    const batch = new SystemBatch(sys, shared, inputs);
    batch.mesh.renderOrder = RENDER_ORDER[sys];
    // 自阴影才是深度感的来源：器官互相投影、肋骨在肺上留下条纹。
    // 皮肤不投影（一张 20 万面的薄壳自投影只会长痤疮），但要接影。
    batch.mesh.castShadow = QUALITY_CAPS[this.quality].softShadows && sys !== 'skin';
    batch.mesh.receiveShadow = QUALITY_CAPS[this.quality].softShadows;
    this.batches.set(sys, batch);
    this.root.add(batch.mesh);

    for (const mesh of meshes) {
      const extras = (mesh.userData as { slug?: string; en?: string; parent?: string }) ?? {};
      const slug = extras.slug ?? mesh.name;
      const color = colorForStructure(sys, extras.en ?? slug, slug);
      // 代理网格：不画（材质 visible:false），但留在场景里给标签射线、
      // 剖切封盖的模板子节点、以及拾取用
      const material = new MeshBasicMaterial({ visible: false });
      mesh.material = material;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      group.add(mesh);
      const parent = typeof extras.parent === 'string' ? extras.parent : null;
      this.structures.set(slug, {
        slug,
        system: sys,
        mesh,
        material,
        batch,
        opacity: 1,
        highlight: 'none',
        color,
        parent,
      });
      // 记下 glb 节点自带的反量化 TRS：微动画只能在它之上叠加，不能覆盖
      if (slug in ANIMATED_STRUCTURES) {
        const center = mesh.geometry.boundingBox?.getCenter(new Vector3()) ?? new Vector3();
        this.pulseBases.set(slug, {
          position: { x: mesh.position.x, y: mesh.position.y, z: mesh.position.z },
          scale: mesh.scale.x,
          center: { x: center.x, y: center.y, z: center.z },
        });
      }
    }
    this.systemGroups.set(sys, group);
    this.root.add(group);
    if (this.pendingSelect && this.structures.has(this.pendingSelect)) {
      const slug = this.pendingSelect;
      this.pendingSelect = null;
      this.select(slug);
    }
  }

  private emitProgress(loaded: number, total: number): void {
    this.dispatchEvent(new CustomEvent('progress', { detail: { loaded, total } }));
  }

  /**
   * 结构中心投影到容器像素坐标，供 3D 标签引线用。
   * 结构不存在、不可见或在相机背后时返回 null。
   */
  projectStructure(slug: string): { x: number; y: number } | null {
    const entry = this.structures.get(slug);
    if (!entry || entry.opacity <= 0.005) return null;
    const point = this.cachedAnchor(slug, entry);
    if (!point) return null;
    const ndc = point.clone().project(this.rig.camera);
    if (ndc.z > 1) return null;
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    return { x: ((ndc.x + 1) / 2) * w, y: ((1 - ndc.y) / 2) * h };
  }

  getManifest(): Manifest | null {
    return this.manifest;
  }

  getState(): ViewerState {
    return {
      ...this.state,
      hidden: new Set(this.state.hidden),
      systemsVisible: { ...this.state.systemsVisible },
      systemOpacity: { ...this.state.systemOpacity },
    };
  }

  getCameraPose(): { pos: [number, number, number]; target: [number, number, number] } {
    const p = this.rig.camera.position;
    const t = this.rig.controls.target;
    return { pos: [p.x, p.y, p.z], target: [t.x, t.y, t.z] };
  }

  setCameraPose(pos: [number, number, number], target: [number, number, number]): void {
    this.rig.camera.position.set(...pos);
    this.rig.controls.target.set(...target);
    this.rig.controls.update();
    // 明确记下"这个机位是人定的，不是自动全身取景"。
    //
    // 漏了这一行的后果是**每条分享链接都丢机位**：`toUrlState` 无条件把相机位姿
    // 写进 ?v=，恢复时走到这里；可紧接着 UI 量完面板高度会调 `setSafeInsets`，
    // 它看见 `autoFramed` 还是 true，就"好心"重新框一次全身，把刚恢复的机位顶掉。
    // 带 selected 的链接因为随后还会 aimAt 到那个结构，症状被盖住了一半——
    // 纯粹分享一个角度（转过身、推近了、没选中任何结构）的链接则是整个失效。
    this.autoFramed = false;
  }

  // ---- 分层与显隐 ----------------------------------------------------------

  /** 目标扫描画面：曲线(layer) × 当前倍率，逐系统。 */
  private scanMixAt(layer: number): Record<SystemId, number> {
    const out = {} as Record<SystemId, number>;
    for (const system of Object.keys(this.state.systemOpacity) as SystemId[]) {
      out[system] = computeSystemOpacity(system, layer) * this.state.systemOpacity[system];
    }
    return out;
  }

  /**
   * 屏幕上此刻每个系统的实际不透明度（不含隐藏/隔离等结构级覆盖）。
   * 混合/过渡中给缓动向量；扫描中按**正在渲染的** layer 值算——store 里的
   * layer 是缓动终点，缓动进行时两者不同，推子首触的固化必须用这份真值，
   * 否则"固化那一帧画面纹丝不动"的契约会被打破（审查逮到的跳变）。
   */
  getDisplayMix(): Record<SystemId, number> {
    return this.mixCurrent ? { ...this.mixCurrent } : this.scanMixAt(this.state.layer);
  }

  setLayer(value: number, immediate = false): void {
    const next = Math.min(1, Math.max(0, value));
    this.layerTarget = next;
    if (this.mixCurrent) {
      // 混合 → 扫描。不能瞬间把画面拍成 曲线×倍率（那是从任意混合硬切），
      // 也没法把混合反推成一个扫描标量——所以先在**混合空间**缓动到目标
      // 扫描画面，落地那一帧再交还曲线。观感是一次干净的交叉淡入。
      this.state.layer = next;
      this.layerEasing = false;
      if (immediate) {
        this.mixCurrent = null;
        this.mixTarget = null;
        this.scanAfterMix = false;
        this.applyVisibility();
        return;
      }
      this.mixTarget = this.scanMixAt(next);
      this.scanAfterMix = true;
      return;
    }
    // 拖滑块时每帧都在小步变化，缓动会拖泥带水；奥秘/预设是大跳，缓动才有意义
    if (immediate || Math.abs(next - this.state.layer) < LAYER_EASE_THRESHOLD) {
      this.layerEasing = false;
      this.state.layer = next;
      this.applyVisibility();
      return;
    }
    this.layerEasing = true;
  }

  /**
   * 手动混合：六个系统各给一个 0–1 的最终不透明度，曲线与倍率不再参与。
   * 拖推子传 immediate（要跟手）；奥秘 mix 步骤不传，沿用分层同款的指数缓动。
   * 从扫描进来时缓动起点是**当前画面**（getDisplayMix 固化）——首版从"倍率
   * 全 1"起步，每个 mix 步开场都闪一帧六层全亮的白（审查逮到的）。
   */
  setMix(mix: Record<SystemId, number>, immediate = false): void {
    this.layerEasing = false;
    this.scanAfterMix = false;
    if (!this.mixCurrent) this.mixCurrent = this.scanMixAt(this.state.layer);
    const target = {} as Record<SystemId, number>;
    for (const [system, value] of Object.entries(mix) as [SystemId, number][]) {
      target[system] = Math.min(1, Math.max(0, value));
    }
    if (immediate) {
      this.mixTarget = null;
      this.mixCurrent = target;
      this.applyVisibility();
      return;
    }
    this.mixTarget = target;
  }

  /** 每帧把当前分层值指数逼近目标值。 */
  private tickLayer(dt: number): void {
    if (this.mixTarget) {
      this.tickMix(dt);
      return;
    }
    if (!this.layerEasing) return;
    const k = 1 - Math.exp(-dt / LAYER_EASE_TAU);
    const next = this.state.layer + (this.layerTarget - this.state.layer) * k;
    if (Math.abs(this.layerTarget - next) < 0.002) {
      this.state.layer = this.layerTarget;
      this.layerEasing = false;
    } else {
      this.state.layer = next;
    }
    this.applyVisibility();
  }

  /** 混合空间的缓动：对六维向量做同一款指数逼近。 */
  private tickMix(dt: number): void {
    const target = this.mixTarget;
    const current = this.mixCurrent;
    if (!target || !current) return;
    const k = 1 - Math.exp(-dt / LAYER_EASE_TAU);
    let settled = true;
    for (const system of Object.keys(target) as SystemId[]) {
      const cur = current[system] ?? 0;
      const next = cur + (target[system] - cur) * k;
      if (Math.abs(target[system] - next) < 0.002) {
        current[system] = target[system];
      } else {
        current[system] = next;
        settled = false;
      }
    }
    if (settled) {
      this.mixTarget = null;
      if (this.scanAfterMix) {
        // 混合 → 扫描的过渡落地：画面正好等于 曲线×倍率，交还曲线不会跳
        this.scanAfterMix = false;
        this.mixCurrent = null;
      }
    }
    this.applyVisibility();
  }

  setSystemVisible(system: SystemId, visible: boolean): void {
    this.state.systemsVisible[system] = visible;
    this.applyVisibility();
  }

  setSystemOpacity(system: SystemId, opacity: number): void {
    this.state.systemOpacity[system] = Math.min(1, Math.max(0, opacity));
    // 正在做混合→扫描的过渡时，倍率（奥秘的 systems 压暗）要反映进过渡目标，
    // 否则缓动落地那帧才突然生效
    if (this.scanAfterMix) this.mixTarget = this.scanMixAt(this.state.layer);
    this.applyVisibility();
  }

  /** 隔离某结构（其余降为幽灵透明度）；传 null 取消。 */
  isolate(slug: string | null): void {
    this.state.isolated = slug;
    this.applyVisibility();
    // 隔离后自动飞到这个结构：否则一个拳头大的器官还停在全身取景里，等于没隔离
    const entry = slug ? this.structures.get(slug) : null;
    if (entry) this.focus(slug!);
    // 收起隔离/展开时飞回去而不是硬切——硬切会在收起内部件时"弹"一下
    else if (!this.contentBox.isEmpty()) this.frameContent(false);
  }

  /** 有哪些内部件（心脏 → 心室壁/瓣膜…）。 */
  childrenOf(slug: string): string[] {
    const out: string[] = [];
    for (const entry of this.structures.values()) {
      if (entry.parent === slug) out.push(entry.slug);
    }
    return out;
  }

  /**
   * 展开内部：父结构隐藏、内部件登场，并顺手隔离+取景到这一家人。
   * 传 null 收起。展开时若选中的是父结构，选中转移到"无"，免得信息卡指着一个隐形结构。
   */
  expand(slug: string | null): void {
    if (slug !== null && this.childrenOf(slug).length === 0) return;
    this.state.expanded = slug;
    if (slug) {
      if (this.state.selected === slug) this.select(null);
      this.isolate(slug);
    } else {
      this.isolate(null);
    }
    this.applyVisibility();
    this.dispatchEvent(new CustomEvent('expand', { detail: { slug } }));
  }

  hide(slug: string): void {
    this.state.hidden.add(slug);
    if (this.state.selected === slug) this.select(null);
    this.applyVisibility();
  }

  /** 恢复所有隐藏/隔离。 */
  resetVisibility(): void {
    this.state.hidden.clear();
    this.state.isolated = null;
    this.applyVisibility();
  }

  hiddenCount(): number {
    return this.state.hidden.size;
  }

  /** 结构的最终不透明度：分层 × 系统开关/透明度 × 隐藏/隔离。 */
  /** `slug` 是不是 `expanded` 本身、或它的某一级祖先。 */
  private coversExpanded(slug: string, expanded: string): boolean {
    let cursor: string | null = expanded;
    // 层级最多几级，加个上限只为防数据里出现环
    for (let depth = 0; cursor !== null && depth < 8; depth += 1) {
      if (cursor === slug) return true;
      cursor = this.structures.get(cursor)?.parent ?? null;
    }
    return false;
  }

  private effectiveOpacity(entry: StructureEntry): number {
    const s = this.state;
    if (!s.systemsVisible[entry.system] || s.hidden.has(entry.slug)) return 0;
    // 内部件平时不出现；展开父结构时它们顶替父结构登场
    if (entry.parent !== null && s.expanded !== entry.parent) return 0;
    // 展开的那一个让位给自己的内部件——**连同它的所有祖先**。
    // 层级现在有三层（颅骨 → 额骨、脑 → 大脑 → 额叶）：只让位一级的话，
    // 钻进「大脑」时外面那层「脑」会重新冒出来，把刚露出的脑叶又罩住。
    if (s.expanded !== null && this.coversExpanded(entry.slug, s.expanded)) return 0;
    let opacity = this.mixCurrent
      ? this.mixCurrent[entry.system]
      : computeSystemOpacity(entry.system, s.layer) * s.systemOpacity[entry.system];
    if (s.isolated) {
      // 隔离 = 只看这一个。其他结构压到只剩一点点轮廓做参照——
      // 0.06 × 130 个结构叠起来仍是一团糊，主角照样看不清
      // 隔离父结构时，它的内部件跟着一起留下（展开心脏就是要看这几件）
      if (s.isolated !== entry.slug && entry.parent !== s.isolated) return Math.min(opacity, 0.015);
      return 1;
    }
    // 选中的结构渲染成不透明：0.85 的心脏后面会透出肋骨，形状根本读不出来
    if (s.selected === entry.slug) opacity = Math.max(opacity, 1);
    return opacity;
  }

  private applyVisibility(): void {
    // 第一遍：算好每个结构的不透明度
    for (const entry of this.structures.values()) entry.opacity = this.effectiveOpacity(entry);

    // 选中/隔离的"实心特例"：它是 1.0，但它所在的批可能整批半透明。
    // 老做法是让它把整批峰值抬到 1、整批 depthWrite 打开——批里其他 0.12–0.78
    // 的半透明实例互相深度淘汰，碎成一片（2026-08-22 真机实拍的"硬切"乱象）。
    // 新做法：批的形态按**除它之外**的实例判定；批不实心时它改走实心代理绘制。
    const soloSlug = this.state.isolated ?? this.state.selected;
    const soloEntry = soloSlug ? (this.structures.get(soloSlug) ?? null) : null;

    const peak = new Map<SystemId, number>();
    const minVisible = new Map<SystemId, number>();
    for (const entry of this.structures.values()) {
      if (entry === soloEntry) continue;
      if (entry.opacity <= 0.005) continue;
      peak.set(entry.system, Math.max(peak.get(entry.system) ?? 0, entry.opacity));
      minVisible.set(entry.system, Math.min(minVisible.get(entry.system) ?? 1, entry.opacity));
    }
    this.updateBatchModes(peak, minVisible);

    const routed =
      soloEntry !== null &&
      soloEntry.opacity >= 0.999 &&
      this.batchMode.get(soloEntry.system) !== 'opaque'
        ? soloEntry
        : null;
    this.syncSoloProxy(routed);

    // 第二遍：落到批。代理接管的那一个在批里隐藏，免得同一份几何画两遍
    for (const entry of this.structures.values()) {
      if (entry === routed) entry.batch.setAppearance(entry.slug, 0, 0);
      else this.paint(entry);
    }
    this.updateClipCaps();
  }

  /**
   * 批的三种渲染形态。
   *
   * - `opaque`：整批实心（可见实例最小 alpha ≥ 0.999）→ 真正的不透明路径：
   *   transparent=false 进不透明队列、写深度。这是 2026-08-22 那条"器官刻度下
   *   位于器官前方的血管被 α=1 的器官盖掉"的修复：不透明的批先画、写下深度，
   *   半透明批随后对着这份深度混合，前后关系立刻正确。
   * - `blend-depth`：半透明但峰值 > 0.55 → 沿用旧的峰值判据写深度。
   * - `blend`：纯混合，不写深度。X-ray 加色壳（皮肤）**永远**在这一档——
   *   它天生 AdditiveBlending + depthWrite:false，旧的 syncDepthWrite 会在
   *   分层 0 时把它的深度写入静默改成 true，这里顺带修掉。
   *
   * AO 闸门用同一份形态表：`blend` 档的批在 GTAO 的法线/深度通道里被藏起来，
   * 半透明的骨骼/血管不再以实体进 AO 深度（真机马赛克的另一半成因）。
   */
  private updateBatchModes(
    peak: ReadonlyMap<SystemId, number>,
    minVisible: ReadonlyMap<SystemId, number>,
  ): void {
    for (const [sys, batch] of this.batches) {
      const material = batch.mesh.material as Material & {
        depthWrite: boolean;
        transparent: boolean;
      };
      const additive = material.blending !== NormalBlending;
      const mode = batchModeFor(peak.get(sys) ?? 0, minVisible.get(sys) ?? 1, additive);
      this.batchMode.set(sys, mode);
      const transparent = additive || mode !== 'opaque';
      // transparent 只影响渲染队列归属，不改着色器程序，来回切没有编译开销
      if (material.transparent !== transparent) material.transparent = transparent;
      const write = !additive && mode !== 'blend';
      if (material.depthWrite !== write) material.depthWrite = write;
    }
  }

  /** 实心特例的代理材质：每系统缓存一份，颜色/高亮在启用时现写。 */
  private soloMaterialFor(system: SystemId): MeshStandardMaterial {
    let material = this.soloMaterials.get(system);
    if (!material) {
      material = createSystemMaterial(system, 0xffffff, this.surfaceDetailLevel());
      material.transparent = false;
      material.depthWrite = true;
      // 代理几何体带 ensureVertexColor 补的白色 COLOR_0（alpha=1）；开着它，
      // 流水线烘焙的顶点 AO 在代理路径上同样生效
      material.vertexColors = true;
      this.soloMaterials.set(system, material);
    }
    const planes = this.clipPlane ? [this.clipPlane] : null;
    material.clippingPlanes = planes;
    material.side = planes ? DoubleSide : FrontSide;
    return material;
  }

  /** 把实心特例切到代理网格上绘制（或撤下来）。 */
  private syncSoloProxy(entry: StructureEntry | null): void {
    if (this.soloProxy && this.soloProxy !== entry) {
      // 回到隐形代理：材质 visible:false，绘制立刻停，标签/拾取/封盖照旧
      this.soloProxy.mesh.material = this.soloProxy.material;
      this.soloProxy = null;
    }
    if (!entry) return;
    const material = this.soloMaterialFor(entry.system);
    entry.mesh.material = material;
    material.color.setHex(entry.color);
    const tint = HIGHLIGHT_TINT[entry.highlight];
    if (tint > 0) material.color.lerp(new Color(HIGHLIGHT_COLOR), tint);
    this.soloProxy = entry;
  }

  /**
   * 封盖候选：够实、可见、且不是 X-ray 外壳的结构。
   * 分层滑到哪里、隔离了谁，候选集就跟着变——所以每次 applyVisibility 都重算一遍。
   */
  private updateClipCaps(): void {
    if (!this.clipPlane) return;
    const candidates = [];
    for (const entry of this.structures.values()) {
      // 皮肤是一整张外壳：给它做封盖会把整个人体断面填成一片肤色，
      // 里面刚剖开的器官全被盖住。壳没有断面可言，跳过。
      if (entry.system === 'skin') continue;
      if (entry.opacity <= 0.005) continue;
      if (this.effectiveOpacity(entry) < CAP_MIN_OPACITY) continue;
      candidates.push({ slug: entry.slug, mesh: entry.mesh, color: entry.color });
    }
    this.clipCaps.update(candidates);
  }

  // ---- 选中 / 悬停 / 拾取 --------------------------------------------------

  select(slug: string | null): void {
    if (slug && !this.structures.has(slug)) {
      // 器官/血管/神经是首屏之后才加载的，此时选中先挂起（loadSystem 里补选）
      this.pendingSelect = slug;
      return;
    }
    this.pendingSelect = null;
    if (this.state.selected === slug) return;
    const prev = this.state.selected ? this.structures.get(this.state.selected) : null;
    if (prev) this.highlight(prev, 'none');
    this.state.selected = slug;
    const entry = slug ? this.structures.get(slug) : null;
    if (entry) {
      this.highlight(entry, 'selected');
      // 皮肤是整具人体的外壳：给它描边就是给整个剪影镶一圈青光，
      // 手机实拍上那一圈"青色边框"就是这么来的。选中状态由信息卡表达就够了。
      this.setOutlineTarget(isWholeBody(entry) ? null : entry);
      this.aimAt(entry);
    } else {
      this.setOutlineTarget(null);
    }
    this.applyVisibility();
    this.dispatchEvent(new CustomEvent('select', { detail: { slug: entry ? slug : null } }));
  }

  /** 选中后相机平滑对准（保持当前距离与方向，只移目标点——KICKOFF 第 6 节）。 */
  private aimAt(entry: StructureEntry): void {
    const box = entry.mesh.geometry.boundingBox;
    if (!box) return;
    // 包围盒是物体空间的（量化后在 ±1 附近），必须先转世界坐标——
    // 否则相机永远对准坐标原点附近，缩进去看某个部件时会直接飞到体外
    const center = box.getCenter(new Vector3());
    entry.mesh.localToWorld(center);
    const offset = this.rig.camera.position.clone().sub(this.rig.controls.target);
    // 已经贴得比结构本身还近时，改成重新框住它，免得相机停在结构内部什么也看不到
    const radius = (box.getSize(new Vector3()).length() / 2) * (entry.mesh.scale.x || 1);
    if (offset.length() < radius * 1.6) {
      this.focus(entry.slug);
      return;
    }
    this.flyTo(center.clone().add(offset), center);
  }

  getSelected(): string | null {
    return this.state.selected;
  }

  /**
   * 相机平滑对准并框住某结构。`from` 只决定方向，距离仍由结构包围盒算——
   * 这样奥秘脚本能说"从左侧凑近看"，而不必在 preset（整具人体宽景）与
   * focus（当前角度特写）之间二选一。
   */
  focus(slug: string, from?: ViewPresetId, zoomOut?: number): void {
    const entry = this.structures.get(slug);
    if (!entry?.mesh.geometry.boundingBox) return;
    const box = entry.mesh.geometry.boundingBox.clone().applyMatrix4(entry.mesh.matrixWorld);
    const pose = poseForFocus(
      box,
      this.rig.camera.position,
      this.rig.controls.target,
      this.rig.camera.fov,
      from,
      this.safeArea(),
      zoomOut,
    );
    this.flyTo(pose.pos, pose.target);
  }

  /**
   * 切预设视角。隔离或展开某个结构之后，框住的应该是**它**而不是整具人体——
   * 否则"隔离眼球 → 正面"会一下子退回全身，等于把刚做的隔离白做了。
   */
  applyPreset(preset: ViewPresetId): void {
    const box = this.focusBox() ?? this.contentBox;
    if (box.isEmpty()) return;
    const pose = poseForBox(box, preset, this.rig.camera.fov, undefined, this.safeArea());
    this.flyTo(pose.pos, pose.target);
  }

  /**
   * 告诉查看器画布上下各被界面挡住多少（CSS 像素）。UI 层量真实 DOM 之后推进来，
   * 渲染核心不认识 React，也就不该猜面板有多高。
   */
  setSafeInsets(insets: { top: number; bottom: number }): void {
    const top = Math.max(0, insets.top);
    const bottom = Math.max(0, insets.bottom);
    if (top === this.safeInsets.top && bottom === this.safeInsets.bottom) return;
    this.safeInsets = { top, bottom };
    // 只有当前还是"自动全身取景"时才重取景。用户点了聚焦、或者分享链接
    // (?v=selected=heart) 已经把相机飞到心脏上，这时候再框一次全身就把它顶掉了
    if (this.contentBox.isEmpty() || !this.autoFramed) return;
    // 第一次量到真实的界面高度时硬切（那还在开场，用户没动过相机），
    // 之后再变（转屏、拉窗口、奥秘播放器换高度）就飞过去
    this.frameContent(!this.framedWithInsets);
    this.framedWithInsets = true;
  }

  private safeArea(): SafeInsets {
    return {
      width: this.container.clientWidth || 1,
      height: this.container.clientHeight || 1,
      top: this.safeInsets.top,
      bottom: this.safeInsets.bottom,
    };
  }

  /** 当前"正在看"的那块的包围盒：隔离 > 展开 > 无。 */
  private focusBox(): Box3 | null {
    const slug = this.state.isolated ?? this.state.expanded;
    if (!slug) return null;
    const entry = this.structures.get(slug);
    const local = entry?.mesh.geometry.boundingBox;
    if (!entry || !local) return null;
    return local.clone().applyMatrix4(entry.mesh.matrixWorld);
  }

  /** Kiosk 吸引动画用：开关相机自动旋转。 */
  setAutoRotate(enabled: boolean, speed = 1.2): void {
    this.rig.controls.autoRotate = enabled;
    this.rig.controls.autoRotateSpeed = speed;
  }

  /**
   * 奥秘播放的运镜。传 `null` 退回普通交互手感。
   *
   * 之所以是"设一次、之后每次飞行都用"而不是"每次飞行带参数"：一步奥秘里
   * 可能连着触发 preset + focus 两次飞行（见 store 的 applyWonderStep），
   * 参数挂在调用点上就得两处都记得传，漏一处画面手感就跳。
   */
  setCinematic(motion: MotionId | null, opts?: { speed?: number; flight?: FlightOptions }): void {
    if (motion === null) {
      this.cinematic = null;
      this.driftElapsed = 0;
      return;
    }
    this.driftElapsed = 0;
    this.cinematic = {
      motion,
      speed: opts?.speed ?? 1,
      flight: { ...CINEMATIC_FLIGHT, ...opts?.flight },
    };
  }

  /**
   * `?stats=1` 时把每帧的绘制统计挂到 `window.__hyiStats`。
   *
   * 加这个开关是因为"同屏 draw call ≤ 600"这条预算一直没人量过——
   * 云端没有 GPU，帧率测不了，但**绘制调用数是 CPU 侧的账，软件渲染下照样准**。
   * 合批改造这种事，改之前必须先有一个能对比的数。
   */
  private publishStats(): void {
    if (!this.statsEnabled) return;
    this.renderer.info.autoReset = false;
    const info = this.renderer.info;
    (window as unknown as { __hyiStats?: unknown }).__hyiStats = {
      calls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      programs: info.programs?.length ?? 0,
      structures: this.structures.size,
    };
  }

  /** WebGL 画布本体。录像要按它的尺寸开合成画布。 */
  getCanvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  /** 注册/注销逐帧回调（录像）。传 `null` 取消。 */
  setFrameTap(fn: ((canvas: HTMLCanvasElement) => void) | null): void {
    this.frameTap = fn;
  }

  private flyTo(pos: Vector3, target: Vector3): void {
    this.autoFramed = false;
    this.rig.controls.autoRotate = false;
    const style = this.cinematic?.flight ?? DIRECT_FLIGHT;
    const fromPos = this.rig.camera.position.clone();
    const fromTarget = this.rig.controls.target.clone();
    // 抬升方向取"屏幕上方"的世界近似：飞行两端连线与世界 Z 的叉积再叉回来。
    // 正上方飞正下方时叉积退化，退回 +Z。
    const travel = pos.clone().sub(fromPos);
    const span = travel.length();
    let lift = new Vector3(0, 0, 1);
    if (style.arc > 0 && span > 1e-3) {
      const right = new Vector3().crossVectors(travel, new Vector3(0, 0, 1));
      if (right.lengthSq() > 1e-8) {
        lift = new Vector3().crossVectors(right, travel).normalize();
        if (lift.z < 0) lift.negate();
      }
      lift.multiplyScalar(span * style.arc);
    } else {
      lift.set(0, 0, 0);
    }
    this.driftSuspended = false;
    this.flight = {
      fromPos,
      fromTarget,
      toPos: pos.clone(),
      toTarget: target.clone(),
      lift,
      t: 0,
      durationS: style.durationS,
      ease: style.ease,
    };
  }

  /**
   * 高亮，但整具外壳（皮肤）不吃这一套。
   *
   * 青色自发光铺在一整张人皮上不是"选中"，是把人染青了；配上 OutlinePass 的
   * 剪影描边，就是人类在手机上看到的那一圈青边。选中皮肤这件事本来也不需要
   * 视觉强调——它是唯一一个"选中了也还是它"的结构，信息卡已经说清楚了。
   */
  private highlight(entry: StructureEntry, level: HighlightLevel): void {
    entry.highlight = isWholeBody(entry) ? 'none' : level;
    this.paint(entry);
  }

  /** 把这个结构当前的不透明度与高亮一并写进它所在的批。 */
  private paint(entry: StructureEntry): void {
    entry.batch.setAppearance(
      entry.slug,
      entry.opacity,
      HIGHLIGHT_TINT[entry.highlight],
      HIGHLIGHT_COLOR,
    );
  }

  /** 当前不透明度够高、可以被射线打中的网格。 */
  private pickables(): Mesh[] {
    const candidates: Mesh[] = [];
    for (const entry of this.structures.values()) {
      if (this.effectiveOpacity(entry) > PICKABLE_OPACITY_THRESHOLD) candidates.push(entry.mesh);
    }
    return candidates;
  }

  private pickAt(x: number, y: number): StructureEntry | null {
    const candidates = this.pickables();
    const mesh = this.picker.pick(x, y, this.renderer.domElement, this.rig.camera, candidates);
    if (!mesh) return null;
    for (const entry of this.structures.values()) if (entry.mesh === mesh) return entry;
    return null;
  }

  /** 滚轮缩放也算"观众上手了"：推近的微动作不该跟用户的滚轮抢方向。 */
  private readonly onWheel = (): void => {
    this.driftSuspended = true;
  };

  private readonly onPointerDown = (e: PointerEvent): void => {
    this.pointerDownAt = { x: e.clientX, y: e.clientY };
    // 观众上手了，这一步剩下的运镜就此打住（下一步开始自动恢复）
    this.driftSuspended = true;
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    const down = this.pointerDownAt;
    this.pointerDownAt = null;
    if (!down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    if (moved > CLICK_MOVE_TOLERANCE_PX) return; // 拖拽相机，不算点击
    const now = performance.now();
    const prev = this.lastTap;
    this.lastTap = { x: e.clientX, y: e.clientY, at: now };
    if (
      prev &&
      now - prev.at < DOUBLE_TAP_MS &&
      Math.hypot(e.clientX - prev.x, e.clientY - prev.y) < DOUBLE_TAP_MOVE_PX
    ) {
      this.lastTap = null;
      this.recenterAt(e.clientX, e.clientY);
      return;
    }
    const entry = this.pickAt(e.clientX, e.clientY);
    this.select(entry ? entry.slug : null);
    // 点在皮肤上时额外报一次"这是身体的哪儿、底下是什么"。皮肤是一整张外壳，
    // 只有一个结构，不这么做的话点头顶和点小腿弹出的是同一张卡片。
    if (entry?.system === 'skin') {
      const point = this.pickPoint(e.clientX, e.clientY);
      this.dispatchEvent(new CustomEvent('probe', { detail: point ? this.probeAt(point) : null }));
    } else {
      this.dispatchEvent(new CustomEvent('probe', { detail: null }));
    }
  };

  /**
   * 反查命中点属于哪个部位、底下压着哪几个结构。
   *
   * 目标表只按 manifest 建一次：235 个结构里排掉皮肤本身和 `region: whole`
   * 这类"罩住一切"的条目，剩下的都是能指得出地方的。
   */
  private probeTargets: ProbeTarget[] | null = null;

  private probeAt(point: Vector3): ProbeResult | null {
    const manifest = this.manifest;
    if (!manifest) return null;
    if (!this.probeTargets) {
      this.probeTargets = Object.entries(manifest.structures)
        .filter(([, info]) => info.system !== 'skin' && info.region !== 'whole' && info.bbox)
        .map(([slug, info]) => ({
          slug,
          region: info.region,
          bbox: info.bbox as unknown as Bbox,
        }));
    }
    const body = manifest.structures.skin?.bbox as unknown as Bbox | undefined;
    if (!body) return null;
    return probeBody([point.x, point.y, point.z], this.probeTargets, body);
  }

  /**
   * 双击/双指双击：把轨道中心挪到点中的那个点上，并凑近一半。
   *
   * 滚轮有 zoomToCursor 顶着，但旋转和平移仍然绕着旧中心转；看肝门的时候
   * 一转就把肝甩出画面。给一个"我要看这儿"的显式手势最省事：中心一挪，
   * 旋转、平移、缩放就都围着它了。点空白处则退回整体视角。
   */
  recenterAt(clientX: number, clientY: number): void {
    const hit = this.pickPoint(clientX, clientY);
    if (!hit) {
      this.frameContent(false);
      return;
    }
    const cam = this.rig.camera.position;
    const dir = cam.clone().sub(hit);
    const dist = Math.max(RECENTER_MIN_MM, dir.length() * RECENTER_FACTOR);
    this.flyTo(hit.clone().add(dir.normalize().multiplyScalar(dist)), hit.clone());
  }

  /**
   * 标签落点带缓存：射线求交每帧都算太贵（三万面的结构约 1~2 ms），
   * 但落点本身变化很慢。每 120 ms 重算一次，中间几帧沿用上次的世界坐标点
   * ——反正投影是每帧做的，标签照样贴着结构走。
   */
  private cachedAnchor(slug: string, entry: StructureEntry): Vector3 | null {
    const now = performance.now();
    const hit = this.anchorCache;
    if (hit && hit.slug === slug && now - hit.at < ANCHOR_CACHE_MS) return hit.point;
    const point = anchorPoint(entry.mesh, this.rig.camera, this.anchorRay);
    this.anchorCache = point ? { slug, point, at: now } : null;
    return point;
  }

  /** 射线打到的世界坐标点（只算当前可拾取的结构）。 */
  private pickPoint(clientX: number, clientY: number): Vector3 | null {
    const candidates = this.pickables();
    if (candidates.length === 0) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    this.anchorRay.setFromCamera(
      new Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
      ),
      this.rig.camera,
    );
    return this.anchorRay.intersectObjects(candidates, false)[0]?.point.clone() ?? null;
  }

  private lastHoverCheck = 0;
  private readonly onPointerMove = (e: PointerEvent): void => {
    if (this.pointerDownAt) return; // 拖拽中不做悬停
    const now = performance.now();
    if (now - this.lastHoverCheck < 40) return;
    this.lastHoverCheck = now;
    const entry = this.pickAt(e.clientX, e.clientY);
    const slug = entry?.slug ?? null;
    if (slug === this.hovered) return;
    const prev = this.hovered ? this.structures.get(this.hovered) : null;
    if (prev && prev.slug !== this.state.selected) this.highlight(prev, 'none');
    this.hovered = slug;
    if (entry && entry.slug !== this.state.selected) this.highlight(entry, 'hover');
    this.renderer.domElement.style.cursor = entry ? 'pointer' : '';
    this.dispatchEvent(new CustomEvent('hover', { detail: { slug } }));
  };

  /**
   * WebGL 上下文丢了。
   *
   * iOS Safari 切后台、来电话、内存紧张时会主动回收 GPU 上下文；安卓和桌面在
   * 显卡驱动更新、休眠唤醒时也会。默认行为是画布直接变成一片空白，而且**不会**
   * 自己恢复——必须 preventDefault 才能让浏览器后续派发 restored 事件。
   */
  private readonly onContextLost = (e: Event): void => {
    e.preventDefault();
    this.contextLost = true;
    this.renderer.setAnimationLoop(null);
    this.dispatchEvent(new CustomEvent('contextlost'));
  };

  /**
   * 上下文回来了。three 的 WebGLRenderer 会自己重建着色器与缓冲（材质、几何都还在
   * CPU 侧），这里只需要把后处理链重建一遍并恢复帧循环——EffectComposer 的
   * 渲染目标是跟着旧上下文一起没的。
   */
  private readonly onContextRestored = (): void => {
    if (this.disposed) return;
    this.contextLost = false;
    this.applyQuality();
    this.resize();
    this.renderer.setAnimationLoop(() => this.tick());
    this.dispatchEvent(new CustomEvent('contextrestored'));
  };

  private readonly onPointerLeave = (): void => {
    const prev = this.hovered ? this.structures.get(this.hovered) : null;
    if (prev && prev.slug !== this.state.selected) this.highlight(prev, 'none');
    this.hovered = null;
  };

  // ---- 器官微动画（心跳/呼吸；respect prefers-reduced-motion）-------------

  private readonly reducedMotion =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /** 绕结构自身中心做微缩放：scale=s 时把 position 设为 center×(1−s)。 */
  private animateOrgans(elapsed: number): void {
    if (this.reducedMotion) return;
    for (const [slug, scaleFn] of Object.entries(ANIMATED_STRUCTURES)) {
      const entry = this.structures.get(slug);
      const base = this.pulseBases.get(slug);
      if (!entry || !base || entry.opacity <= 0.005) continue;
      const next = pulseTransform(base, scaleFn(elapsed));
      // 代理要动：剖切封盖的模板网格是它的子节点，跟着一起走。
      // 但**画出来的是批**，所以同一份变换还得写进每实例矩阵，否则只有封盖在跳。
      entry.mesh.position.set(next.position.x, next.position.y, next.position.z);
      entry.mesh.scale.setScalar(next.scale);
      entry.mesh.updateMatrixWorld(true);
      entry.batch.setMatrix(slug, entry.mesh.matrixWorld);
    }
    // 描边走 OutlinePass，描的是一份专用代理（见 outlineProxy）
  }

  // ---- 剖切 ----------------------------------------------------------------
  // （2026-08-22 界面上的剖切面板随「沿此结构半剖」一起砍掉了；剖切能力保留，
  // 由奥秘步骤与旧分享链接经 setClip 使用。）

  setClip(clip: { axis: ClipAxis; pos: number; flip?: boolean } | null): void {
    this.state.clip = clip;
    this.applyClip();
  }

  private applyClip(): void {
    const clip = this.state.clip;
    this.clipPlane =
      clip && !this.contentBox.isEmpty()
        ? clipPlaneFor(clip.axis, clip.pos, this.contentBox, clip.flip === true)
        : null;
    const planes = this.clipPlane ? [this.clipPlane] : null;
    // 设在**批的共享材质**上，不是结构代理的材质上——代理压根不参与绘制，
    // 设在它上面等于没设（合批改造后实拍：剖切完全不生效）。
    for (const batch of this.batches.values()) {
      const material = batch.mesh.material as Material;
      material.clippingPlanes = planes;
      // 剖切时双面渲染，露出内壁形成"实心"断面感
      if ('side' in material) (material as { side: Side }).side = planes ? DoubleSide : FrontSide;
      material.needsUpdate = true;
    }
    // 实心代理（选中/隔离的特例）不在批里画，剖切平面要单独同步
    for (const material of this.soloMaterials.values()) {
      material.clippingPlanes = planes;
      material.side = planes ? DoubleSide : FrontSide;
      material.needsUpdate = true;
    }
    this.clipCaps.setPlane(this.clipPlane);
    this.updateClipCaps();
  }

  // ---- 帧循环等 ------------------------------------------------------------

  /** `immediate` 只在首次加载时为真：那时还没有"上一个机位"可以飞。 */
  private frameContent(immediate = true): void {
    if (this.contentBox.isEmpty()) return;
    const pose = poseForBox(
      this.contentBox,
      'hero',
      this.rig.camera.fov,
      undefined,
      this.safeArea(),
    );
    if (immediate) {
      this.rig.controls.target.copy(pose.target);
      this.rig.camera.position.copy(pose.pos);
    } else {
      this.flyTo(pose.pos, pose.target);
    }
    this.autoFramed = true;
    this.syncClipPlanes();
  }

  /**
   * 近远裁剪面跟着当前观察距离走。
   *
   * 原来只在取景时按当时的距离算一次：全身取景算出 near ≈ 26 mm，之后凑到
   * 晶状体跟前（25 mm）就整个被裁掉了。反过来，如果一开始就把 near 写死成很小，
   * 全身视角下深度缓冲的精度会浪费在近处，远端 z-fighting。所以每帧按距离重算，
   * 变化超过 1% 才写回（updateProjectionMatrix 不算便宜）。
   */
  private syncClipPlanes(): void {
    const cam = this.rig.camera;
    const dist = cam.position.distanceTo(this.rig.controls.target);
    if (!Number.isFinite(dist) || dist <= 0) return;
    const span = this.contentBox.isEmpty()
      ? dist * 4
      : this.contentBox.getSize(SCRATCH_SIZE).length();
    const near = Math.max(NEAR_MIN_MM, dist / 100);
    const far = Math.max(dist * 4, span * 2);
    if (Math.abs(cam.near - near) < near * 0.01 && Math.abs(cam.far - far) < far * 0.01) return;
    cam.near = near;
    cam.far = far;
    cam.updateProjectionMatrix();
  }

  private resize(): void {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    // 第三个参数（updateStyle）必须留默认的 true：它负责把 canvas.style.width/height
    // 设成 CSS 像素尺寸。传 false 时 three 只设绘制缓冲（= 尺寸 × 像素比），canvas
    // 元素就按固有尺寸显示——在 DPR 2 的设备（所有 Retina 苹果设备、多数手机）上
    // 画布被撑成容器的两倍，用户只看得见整幅画面的左上四分之一。ui.css 里还有一条
    // 兜底规则，两边都改了才不会再踩。
    this.renderer.setSize(w, h);
    this.rig.camera.aspect = w / h;
    this.rig.camera.updateProjectionMatrix();
    this.pipeline?.setSize(w, h, this.renderer.getPixelRatio());
  }

  // ---- 画质档位 ------------------------------------------------------------

  getQuality(): QualityTier {
    return this.quality;
  }

  canToggleQuality(): boolean {
    return canToggleHighQuality(this.quality);
  }

  /** 切换画质：重建后处理链、开关阴影，并把当前选中重新交给描边通道。 */
  setQuality(tier: QualityTier): void {
    if (tier === this.quality) return;
    this.quality = tier;
    this.applyQuality();
    const selected = this.state.selected ? this.structures.get(this.state.selected) : null;
    this.setOutlineTarget(selected ?? null);
    this.dispatchEvent(new CustomEvent('quality', { detail: { quality: tier } }));
  }

  private applyQuality(): void {
    const caps = QUALITY_CAPS[this.quality];
    this.pipeline?.dispose();
    this.clipCaps.dispose();
    this.pipeline = caps.postprocessing
      ? createRenderPipeline(this.renderer, this.scene, this.rig.camera, caps)
      : null;
    // AO 只喂"够实"的几何：纯混合档的批在 GTAO 的法线/深度通道里临时藏起来。
    // 不藏的话 0.12 的半透明骨骼会以实体进 AO 深度，把幽灵暗影整片印在器官上。
    this.pipeline?.setAOGate({
      prepare: () => {
        for (const [sys, batch] of this.batches) {
          if (this.batchMode.get(sys) === 'blend' && batch.mesh.visible) {
            batch.mesh.visible = false;
            this.aoHiddenMeshes.push(batch.mesh);
          }
        }
      },
      restore: () => {
        for (const mesh of this.aoHiddenMeshes) mesh.visible = true;
        this.aoHiddenMeshes.length = 0;
      },
    });

    this.renderer.shadowMap.enabled = caps.softShadows;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    this.stage.key.castShadow = caps.softShadows;
    this.stage.key.shadow.mapSize.set(2048, 2048);
    this.stage.key.shadow.bias = -0.0006;
    this.stage.key.shadow.normalBias = 2;
    // 真阴影开着时假接触阴影淡一点，免得脚下糊成一团黑
    (this.stage.contactShadow.material as Material).opacity = caps.softShadows ? 0.45 : 0.9;
    for (const entry of this.structures.values()) {
      entry.mesh.castShadow = false;
      entry.mesh.receiveShadow = false;
    }
    // 表面质感的档位也要跟着拨过去。材质是系统加载时建的，不跟着改的话
    // 用户拨了高画质开关，阴影和 AO 变了、表面纹理却停在原档——只有看像素才发现。
    for (const batch of this.batches.values()) {
      setSurfaceDetail(batch.mesh.material as Material, this.surfaceDetailLevel());
    }

    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.pipeline?.setSize(w, h, this.renderer.getPixelRatio());
  }

  /**
   * 表面质感档位：默认跟画质档走，`?surf=0|1|2` 可以强制覆盖。
   *
   * 这个开关是给**同机位 A/B** 用的：着色器改动只能看像素验证，而"看起来好像
   * 更细了"是最不可靠的一种判断。有了它就能拍两张只差这一个变量的图。
   * 跟 `?stats=1`、`?aodebug=` 是同一类调试钩子。
   */
  private surfaceDetailLevel(): SurfaceDetailLevel {
    const raw = new URLSearchParams(location.search).get('surf');
    if (raw === '0') return 0;
    if (raw === '1') return 1;
    if (raw === '2') return 2;
    return QUALITY_CAPS[this.quality].surfaceDetail;
  }

  /** 把描边目标换成某个结构（传 null 清空）。 */
  private setOutlineTarget(entry: StructureEntry | null): void {
    if (!entry) {
      this.outlineProxy.visible = false;
      this.pipeline?.setSelected([]);
      return;
    }
    this.outlineProxy.geometry = entry.mesh.geometry;
    this.outlineProxy.matrixAutoUpdate = false;
    this.outlineProxy.matrix.copy(entry.mesh.matrixWorld);
    this.outlineProxy.matrixWorld.copy(entry.mesh.matrixWorld);
    this.outlineProxy.visible = true;
    this.pipeline?.setSelected([this.outlineProxy]);
  }

  private tick(): void {
    if (this.disposed || this.contextLost) return;
    const dt = this.clock.getDelta();
    this.tickLayer(dt);
    this.animateOrgans(this.clock.elapsedTime);
    if (this.flight) {
      const f = this.flight;
      f.t = Math.min(1, f.t + dt / f.durationS);
      const k = EASINGS[f.ease](f.t);
      this.rig.camera.position.lerpVectors(f.fromPos, f.toPos, k);
      this.rig.controls.target.lerpVectors(f.fromTarget, f.toTarget, k);
      // 中间鼓、两头零的抛物线：sin(πk) 在 k=0/1 处正好归零，落点不受影响
      if (f.lift.lengthSq() > 0) {
        this.rig.camera.position.addScaledVector(f.lift, Math.sin(Math.PI * k));
      }
      if (f.t >= 1) this.flight = null;
    } else if (
      this.cinematic &&
      this.cinematic.motion !== 'still' &&
      !this.driftSuspended &&
      this.driftElapsed < MAX_DRIFT_S
    ) {
      this.driftElapsed += dt;
      applyDrift(
        this.rig.camera,
        this.rig.controls.target,
        this.cinematic.motion,
        dt,
        { minDistance: this.rig.controls.minDistance, maxDistance: this.rig.controls.maxDistance },
        this.cinematic.speed,
      );
    }
    this.rig.controls.update();
    this.syncClipPlanes();
    this.clipCaps.syncToPlane();
    // 统计要把**整帧**（含后处理各趟）算进来：renderer.info 默认每次 render()
    // 清零一次，不关掉自动清零就只能量到最后那个全屏四边形（实测 calls:1）
    if (this.statsEnabled) this.renderer.info.reset();
    if (this.pipeline) this.pipeline.render();
    else this.renderer.render(this.scene, this.rig.camera);
    this.publishStats();
    // 抄帧必须紧跟在 render 后面，见 frameTap 的注释
    if (this.frameTap) this.frameTap(this.renderer.domElement);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const dom = this.renderer.domElement;
    dom.removeEventListener('pointerdown', this.onPointerDown);
    dom.removeEventListener('pointerup', this.onPointerUp);
    dom.removeEventListener('pointermove', this.onPointerMove);
    dom.removeEventListener('pointerleave', this.onPointerLeave);
    dom.removeEventListener('wheel', this.onWheel);
    dom.removeEventListener('webglcontextlost', this.onContextLost);
    dom.removeEventListener('webglcontextrestored', this.onContextRestored);
    this.frameTap = null;
    for (const batch of this.batches.values()) batch.dispose();
    this.batches.clear();
    this.pipeline?.dispose();
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    this.rig.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
