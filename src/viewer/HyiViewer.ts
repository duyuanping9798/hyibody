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
  Scene,
  ShaderMaterial,
  Vector3,
  WebGLRenderer,
  type Material,
  type Object3D,
  type Plane,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { loadManifest } from '../data/manifest';
import type { Manifest, SystemId } from '../data/types';
import { ANIMATED_STRUCTURES, pulseTransform, type PulseBase } from './animation';
import {
  createCameraRig,
  poseForBox,
  poseForFocus,
  type CameraRig,
  type ViewPresetId,
} from './camera';
import { CAP_MIN_OPACITY, ClipCaps } from './clipCaps';
import { clipPlaneFor, clipPosForCoordinate, type ClipAxis } from './clipping';
import { applyHighlight } from './highlight';
import { computeSystemOpacity, PICKABLE_OPACITY_THRESHOLD } from './layers';
import {
  colorForStructure,
  createSystemMaterial,
  createXRayMaterial,
  setMaterialOpacity,
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
import { CLICK_MOVE_TOLERANCE_PX, StructurePicker } from './picking';

export interface HyiViewerOptions {
  /** 站点部署基路径，传 import.meta.env.BASE_URL */
  base: string;
  /** 强制画质档位（?hq= 或测试用）；不传则按设备能力自动判断 */
  quality?: QualityTier | undefined;
}

/** 首屏系统：先加载完这两个就派发 ready，其余后台补（KICKOFF 第 5 节 M1-6）。 */
const FIRST_SCREEN_SYSTEMS: readonly SystemId[] = ['skin', 'skeleton'];

/** 分层缓动：跨度超过阈值才缓动（拖滑块要跟手，故事线跳转要顺滑），时间常数秒。 */
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
  mesh: Mesh;
  material: Material;
  /** 结构本色，剖切封盖的断面用同一个颜色 */
  color: number;
  /** 内部件指向父结构（心室壁 → 心脏）；顶层结构为 null */
  parent: string | null;
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
  private clipPlane: Plane | null = null;
  private flight: {
    fromPos: Vector3;
    fromTarget: Vector3;
    toPos: Vector3;
    toTarget: Vector3;
    t: number;
  } | null = null;
  private pointerDownAt: { x: number; y: number } | null = null;
  /** 分层滑块缓动：大跳（故事线、预设）平滑过渡，小步（拖滑块）立即跟手 */
  private layerTarget = 0;
  private layerEasing = false;

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
    this.renderer.setClearColor(0x0b1020, 1);
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

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.renderer.setAnimationLoop(() => this.tick());
  }

  /**
   * 加载 manifest → 首屏系统（皮肤+骨骼）就绪即派发 'ready'，
   * 其余系统后台逐个加载并派发 'systemloaded'。
   */
  async load(): Promise<void> {
    try {
      this.manifest = await loadManifest(this.options.base);
      const systems = this.manifest.systems;
      const first = systems.filter((s) => (FIRST_SCREEN_SYSTEMS as string[]).includes(s.id));
      const rest = systems.filter((s) => !(FIRST_SCREEN_SYSTEMS as string[]).includes(s.id));
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
    for (const mesh of meshes) {
      const extras = (mesh.userData as { slug?: string; en?: string; parent?: string }) ?? {};
      const slug = extras.slug ?? mesh.name;
      const color = colorForStructure(sys, extras.en ?? slug, slug);
      const material =
        sys === 'skin' ? createXRayMaterial(color, 1) : createSystemMaterial(sys, color);
      mesh.material = material;
      mesh.renderOrder = RENDER_ORDER[sys];
      mesh.castShadow = QUALITY_CAPS[this.quality].softShadows && sys !== 'skin';
      mesh.geometry.computeBoundingBox();
      group.add(mesh);
      const parent = typeof extras.parent === 'string' ? extras.parent : null;
      this.structures.set(slug, { slug, system: sys, mesh, material, color, parent });
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
    if (!entry || !entry.material.visible) return null;
    const box = entry.mesh.geometry.boundingBox;
    if (!box) return null;
    const center = box.getCenter(new Vector3());
    entry.mesh.localToWorld(center);
    const ndc = center.project(this.rig.camera);
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
  }

  // ---- 分层与显隐 ----------------------------------------------------------

  setLayer(value: number, immediate = false): void {
    const next = Math.min(1, Math.max(0, value));
    this.layerTarget = next;
    // 拖滑块时每帧都在小步变化，缓动会拖泥带水；故事线/预设是大跳，缓动才有意义
    if (immediate || Math.abs(next - this.state.layer) < LAYER_EASE_THRESHOLD) {
      this.layerEasing = false;
      this.state.layer = next;
      this.applyVisibility();
      return;
    }
    this.layerEasing = true;
  }

  /** 每帧把当前分层值指数逼近目标值。 */
  private tickLayer(dt: number): void {
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

  setSystemVisible(system: SystemId, visible: boolean): void {
    this.state.systemsVisible[system] = visible;
    this.applyVisibility();
  }

  setSystemOpacity(system: SystemId, opacity: number): void {
    this.state.systemOpacity[system] = Math.min(1, Math.max(0, opacity));
    this.applyVisibility();
  }

  /** 隔离某结构（其余降为幽灵透明度）；传 null 取消。 */
  isolate(slug: string | null): void {
    this.state.isolated = slug;
    this.applyVisibility();
    // 隔离后自动飞到这个结构：否则一个拳头大的器官还停在全身取景里，等于没隔离
    const entry = slug ? this.structures.get(slug) : null;
    if (entry) this.focus(slug!);
    else if (!this.contentBox.isEmpty()) this.frameContent();
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
  private effectiveOpacity(entry: StructureEntry): number {
    const s = this.state;
    if (!s.systemsVisible[entry.system] || s.hidden.has(entry.slug)) return 0;
    // 内部件平时不出现；展开父结构时它们顶替父结构登场
    if (entry.parent !== null && s.expanded !== entry.parent) return 0;
    if (s.expanded === entry.slug) return 0;
    let opacity = computeSystemOpacity(entry.system, s.layer) * s.systemOpacity[entry.system];
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
    for (const entry of this.structures.values()) {
      setMaterialOpacity(entry.material, this.effectiveOpacity(entry));
    }
    this.updateClipCaps();
  }

  /**
   * 封盖候选：够实、可见、且不是 X-ray 外壳的结构。
   * 分层滑到哪里、隔离了谁，候选集就跟着变——所以每次 applyVisibility 都重算一遍。
   */
  private updateClipCaps(): void {
    if (!this.clipPlane) return;
    const candidates = [];
    for (const entry of this.structures.values()) {
      if (entry.material instanceof ShaderMaterial) continue; // 皮肤/X-ray 壳没有断面可言
      if (!entry.material.visible) continue;
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
    if (prev) applyHighlight(prev.mesh, 'none');
    this.state.selected = slug;
    const entry = slug ? this.structures.get(slug) : null;
    if (entry) {
      applyHighlight(entry.mesh, 'selected');
      this.setOutlineTarget([entry.mesh]);
      this.aimAt(entry);
    } else {
      this.setOutlineTarget([]);
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

  /** 相机平滑对准并框住某结构。 */
  focus(slug: string): void {
    const entry = this.structures.get(slug);
    if (!entry?.mesh.geometry.boundingBox) return;
    const box = entry.mesh.geometry.boundingBox.clone().applyMatrix4(entry.mesh.matrixWorld);
    const pose = poseForFocus(
      box,
      this.rig.camera.position,
      this.rig.controls.target,
      this.rig.camera.fov,
    );
    this.flyTo(pose.pos, pose.target);
  }

  applyPreset(preset: ViewPresetId): void {
    if (this.contentBox.isEmpty()) return;
    const pose = poseForBox(this.contentBox, preset, this.rig.camera.fov);
    this.flyTo(pose.pos, pose.target);
  }

  /** Kiosk 吸引动画用：开关相机自动旋转。 */
  setAutoRotate(enabled: boolean, speed = 1.2): void {
    this.rig.controls.autoRotate = enabled;
    this.rig.controls.autoRotateSpeed = speed;
  }

  private flyTo(pos: Vector3, target: Vector3): void {
    this.rig.controls.autoRotate = false;
    this.flight = {
      fromPos: this.rig.camera.position.clone(),
      fromTarget: this.rig.controls.target.clone(),
      toPos: pos.clone(),
      toTarget: target.clone(),
      t: 0,
    };
  }

  private pickAt(x: number, y: number): StructureEntry | null {
    const candidates: Mesh[] = [];
    for (const entry of this.structures.values()) {
      if (this.effectiveOpacity(entry) > PICKABLE_OPACITY_THRESHOLD) candidates.push(entry.mesh);
    }
    const mesh = this.picker.pick(x, y, this.renderer.domElement, this.rig.camera, candidates);
    if (!mesh) return null;
    for (const entry of this.structures.values()) if (entry.mesh === mesh) return entry;
    return null;
  }

  private readonly onPointerDown = (e: PointerEvent): void => {
    this.pointerDownAt = { x: e.clientX, y: e.clientY };
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    const down = this.pointerDownAt;
    this.pointerDownAt = null;
    if (!down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    if (moved > CLICK_MOVE_TOLERANCE_PX) return; // 拖拽相机，不算点击
    const entry = this.pickAt(e.clientX, e.clientY);
    this.select(entry ? entry.slug : null);
  };

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
    if (prev && prev.slug !== this.state.selected) applyHighlight(prev.mesh, 'none');
    this.hovered = slug;
    if (entry && entry.slug !== this.state.selected) applyHighlight(entry.mesh, 'hover');
    this.renderer.domElement.style.cursor = entry ? 'pointer' : '';
    this.dispatchEvent(new CustomEvent('hover', { detail: { slug } }));
  };

  private readonly onPointerLeave = (): void => {
    const prev = this.hovered ? this.structures.get(this.hovered) : null;
    if (prev && prev.slug !== this.state.selected) applyHighlight(prev.mesh, 'none');
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
      if (!entry || !base || !entry.material.visible) continue;
      const next = pulseTransform(base, scaleFn(elapsed));
      entry.mesh.position.set(next.position.x, next.position.y, next.position.z);
      entry.mesh.scale.setScalar(next.scale);
    }
    // 描边走 OutlinePass，直接描选中网格本身，动画时无需再同步 transform
  }

  // ---- 剖切 ----------------------------------------------------------------

  /**
   * 沿某个结构半剖：把剖切面移到该结构的中心，正好把它切成两半。
   * "想看心脏内部"最短的一条路——否则要手动拖滑块试半天。
   */
  clipThroughStructure(slug: string, axis: ClipAxis = 'y'): boolean {
    const entry = this.structures.get(slug);
    const box = entry?.mesh.geometry.boundingBox;
    if (!entry || !box || this.contentBox.isEmpty()) return false;
    const center = box.getCenter(new Vector3());
    entry.mesh.localToWorld(center);
    const pos = clipPosForCoordinate(
      center[axis],
      this.contentBox.min[axis],
      this.contentBox.max[axis],
    );
    // 切掉朝向相机的那一半，否则剖开了也只看到完整的外表面
    const flip = this.rig.camera.position[axis] < center[axis];
    this.setClip({ axis, pos, flip });
    return true;
  }

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
    for (const entry of this.structures.values()) {
      entry.material.clippingPlanes = planes;
      // 剖切时双面渲染，露出内壁形成"实心"断面感（X-ray 材质本就双面）
      if (!(entry.material instanceof ShaderMaterial)) {
        entry.material.side = planes ? DoubleSide : FrontSide;
      }
    }
    this.clipCaps.setPlane(this.clipPlane);
    this.updateClipCaps();
  }

  // ---- 帧循环等 ------------------------------------------------------------

  private frameContent(): void {
    if (this.contentBox.isEmpty()) return;
    const pose = poseForBox(this.contentBox, 'hero', this.rig.camera.fov);
    this.rig.controls.target.copy(pose.target);
    this.rig.camera.position.copy(pose.pos);
    const dist = pose.pos.distanceTo(pose.target);
    this.rig.camera.near = Math.max(1, dist / 100);
    this.rig.camera.far = dist * 10;
    this.rig.camera.updateProjectionMatrix();
  }

  private resize(): void {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
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
    this.setOutlineTarget(selected ? [selected.mesh] : []);
    this.dispatchEvent(new CustomEvent('quality', { detail: { quality: tier } }));
  }

  private applyQuality(): void {
    const caps = QUALITY_CAPS[this.quality];
    this.pipeline?.dispose();
    this.clipCaps.dispose();
    this.pipeline = caps.postprocessing
      ? createRenderPipeline(this.renderer, this.scene, this.rig.camera, caps)
      : null;

    this.renderer.shadowMap.enabled = caps.softShadows;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    this.stage.key.castShadow = caps.softShadows;
    this.stage.key.shadow.mapSize.set(2048, 2048);
    this.stage.key.shadow.bias = -0.0006;
    this.stage.key.shadow.normalBias = 2;
    this.stage.shadowCatcher.visible = caps.softShadows;
    // 真阴影开着时假接触阴影淡一点，免得脚下糊成一团黑
    (this.stage.contactShadow.material as Material).opacity = caps.softShadows ? 0.45 : 0.9;
    for (const entry of this.structures.values()) {
      entry.mesh.castShadow = caps.softShadows && entry.system !== 'skin';
    }

    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.pipeline?.setSize(w, h, this.renderer.getPixelRatio());
  }

  private setOutlineTarget(objects: Object3D[]): void {
    this.pipeline?.setSelected(objects);
  }

  private tick(): void {
    if (this.disposed) return;
    const dt = this.clock.getDelta();
    this.tickLayer(dt);
    this.animateOrgans(this.clock.elapsedTime);
    if (this.flight) {
      this.flight.t = Math.min(1, this.flight.t + dt / 0.6);
      const k = 1 - Math.pow(1 - this.flight.t, 3); // easeOutCubic
      this.rig.camera.position.lerpVectors(this.flight.fromPos, this.flight.toPos, k);
      this.rig.controls.target.lerpVectors(this.flight.fromTarget, this.flight.toTarget, k);
      if (this.flight.t >= 1) this.flight = null;
    }
    this.rig.controls.update();
    this.clipCaps.syncToPlane();
    if (this.pipeline) this.pipeline.render();
    else this.renderer.render(this.scene, this.rig.camera);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const dom = this.renderer.domElement;
    dom.removeEventListener('pointerdown', this.onPointerDown);
    dom.removeEventListener('pointerup', this.onPointerUp);
    dom.removeEventListener('pointermove', this.onPointerMove);
    dom.removeEventListener('pointerleave', this.onPointerLeave);
    this.pipeline?.dispose();
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    this.rig.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
