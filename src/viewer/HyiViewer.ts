import {
  ACESFilmicToneMapping,
  AmbientLight,
  Box3,
  Clock,
  DirectionalLight,
  DoubleSide,
  FrontSide,
  Group,
  Mesh,
  PMREMGenerator,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  WebGLRenderer,
  type Material,
  type Plane,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { loadManifest } from '../data/manifest';
import type { Manifest, SystemId } from '../data/types';
import { ANIMATED_STRUCTURES } from './animation';
import {
  createCameraRig,
  poseForBox,
  poseForFocus,
  type CameraRig,
  type ViewPresetId,
} from './camera';
import { clipPlaneFor, type ClipAxis } from './clipping';
import { applyHighlight } from './highlight';
import { computeSystemOpacity, PICKABLE_OPACITY_THRESHOLD } from './layers';
import {
  colorForStructure,
  createBackdropMaterial,
  createOutlineMaterial,
  createSystemMaterial,
  createXRayMaterial,
  setMaterialOpacity,
} from './materials';
import { CLICK_MOVE_TOLERANCE_PX, StructurePicker } from './picking';

export interface HyiViewerOptions {
  /** 站点部署基路径，传 import.meta.env.BASE_URL */
  base: string;
}

/** 首屏系统：先加载完这两个就派发 ready，其余后台补（KICKOFF 第 5 节 M1-6）。 */
const FIRST_SCREEN_SYSTEMS: readonly SystemId[] = ['skin', 'skeleton'];

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
}

export interface ViewerState {
  layer: number;
  systemsVisible: Record<SystemId, boolean>;
  systemOpacity: Record<SystemId, number>;
  hidden: Set<string>;
  isolated: string | null;
  selected: string | null;
  clip: { axis: ClipAxis; pos: number } | null;
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
  private readonly state = defaultViewerState();
  private hovered: string | null = null;
  private outline!: Mesh;
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

  constructor(
    container: HTMLElement,
    private readonly options: HyiViewerOptions,
  ) {
    super();
    this.container = container;
    this.renderer = new WebGLRenderer({
      antialias: true,
      alpha: false,
      // 冒烟测试需要读回像素判断画面非空（tests/e2e/smoke.spec.ts）
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x0b1020, 1);
    this.renderer.localClippingEnabled = true;
    // 电影级色调映射 + 程序化环境光照（观感升级，无外部 HDR 资源）
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    container.appendChild(this.renderer.domElement);
    const pmrem = new PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    this.rig = createCameraRig(this.renderer.domElement, 1);
    this.scene.add(this.root);
    this.scene.add(new AmbientLight(0x8899bb, 0.35));
    const key = new DirectionalLight(0xffffff, 1.1);
    key.position.set(1200, -2000, 1800);
    this.scene.add(key);
    const rim = new DirectionalLight(0x33ddee, 0.5);
    rim.position.set(-1500, 1200, 600);
    this.scene.add(rim);
    // 渐变舞台背景（内翻大球，替代纯色清屏；不参与拾取与取景框）
    const backdrop = new Mesh(new SphereGeometry(15000, 32, 24), createBackdropMaterial());
    backdrop.renderOrder = -1;
    this.scene.add(backdrop);
    // 选中描边（反壳），select() 时挂到对应网格几何体上
    this.outline = new Mesh(undefined, createOutlineMaterial(0x4fe3e0));
    this.outline.visible = false;
    this.outline.renderOrder = 0;
    this.scene.add(this.outline);

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
      await Promise.all(firstBatch.map((s) => this.loadSystem(s.id as SystemId, s.file)));
      this.contentBox = new Box3().setFromObject(this.root);
      this.frameContent();
      this.applyVisibility();
      this.container.dataset.hyiReady = '1';
      this.dispatchEvent(new CustomEvent('ready', { detail: { manifest: this.manifest } }));
      void (async () => {
        for (const s of first.length > 0 ? rest : []) {
          try {
            await this.loadSystem(s.id as SystemId, s.file);
            this.contentBox = new Box3().setFromObject(this.root);
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
      const extras = (mesh.userData as { slug?: string; en?: string }) ?? {};
      const slug = extras.slug ?? mesh.name;
      const color = colorForStructure(sys, extras.en ?? slug);
      const material =
        sys === 'skin' || sys === 'muscles'
          ? createXRayMaterial(color, 1)
          : createSystemMaterial(sys, color);
      mesh.material = material;
      mesh.renderOrder = RENDER_ORDER[sys];
      mesh.geometry.computeBoundingBox();
      group.add(mesh);
      this.structures.set(slug, { slug, system: sys, mesh, material });
    }
    this.systemGroups.set(sys, group);
    this.root.add(group);
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

  setLayer(value: number): void {
    this.state.layer = Math.min(1, Math.max(0, value));
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
    let opacity = computeSystemOpacity(entry.system, s.layer) * s.systemOpacity[entry.system];
    if (s.isolated && s.isolated !== entry.slug) opacity = Math.min(opacity, 0.06);
    if (s.selected === entry.slug) opacity = Math.max(opacity, 0.85);
    return opacity;
  }

  private applyVisibility(): void {
    for (const entry of this.structures.values()) {
      setMaterialOpacity(entry.material, this.effectiveOpacity(entry));
    }
  }

  // ---- 选中 / 悬停 / 拾取 --------------------------------------------------

  select(slug: string | null): void {
    if (this.state.selected === slug) return;
    const prev = this.state.selected ? this.structures.get(this.state.selected) : null;
    if (prev) applyHighlight(prev.mesh, 'none');
    this.state.selected = slug;
    const entry = slug ? this.structures.get(slug) : null;
    if (entry) {
      applyHighlight(entry.mesh, 'selected');
      this.outline.geometry = entry.mesh.geometry;
      this.outline.visible = true;
      this.aimAt(entry);
    } else {
      this.outline.visible = false;
    }
    this.applyVisibility();
    this.dispatchEvent(new CustomEvent('select', { detail: { slug: entry ? slug : null } }));
  }

  /** 选中后相机平滑对准（保持当前距离与方向，只移目标点——KICKOFF 第 6 节）。 */
  private aimAt(entry: StructureEntry): void {
    const box = entry.mesh.geometry.boundingBox;
    if (!box) return;
    const center = box.getCenter(new Vector3());
    const offset = this.rig.camera.position.clone().sub(this.rig.controls.target);
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
      const box = entry?.mesh.geometry.boundingBox;
      if (!entry || !box || !entry.material.visible) continue;
      const s = scaleFn(elapsed);
      const center = box.getCenter(new Vector3());
      entry.mesh.scale.setScalar(s);
      entry.mesh.position.copy(center).multiplyScalar(1 - s);
    }
    // 选中描边跟随动画中的网格
    if (this.outline.visible && this.state.selected) {
      const sel = this.structures.get(this.state.selected);
      if (sel) {
        this.outline.position.copy(sel.mesh.position);
        this.outline.scale.copy(sel.mesh.scale);
      }
    }
  }

  // ---- 剖切 ----------------------------------------------------------------

  setClip(clip: { axis: ClipAxis; pos: number } | null): void {
    this.state.clip = clip;
    this.applyClip();
  }

  private applyClip(): void {
    const clip = this.state.clip;
    this.clipPlane =
      clip && !this.contentBox.isEmpty()
        ? clipPlaneFor(clip.axis, clip.pos, this.contentBox)
        : null;
    const planes = this.clipPlane ? [this.clipPlane] : null;
    for (const entry of this.structures.values()) {
      entry.material.clippingPlanes = planes;
      // 剖切时双面渲染，露出内壁形成"实心"断面感（X-ray 材质本就双面）
      if (!(entry.material instanceof ShaderMaterial)) {
        entry.material.side = planes ? DoubleSide : FrontSide;
      }
    }
    (this.outline.material as Material).clippingPlanes = planes;
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
  }

  private tick(): void {
    if (this.disposed) return;
    const dt = this.clock.getDelta();
    this.animateOrgans(this.clock.elapsedTime);
    if (this.flight) {
      this.flight.t = Math.min(1, this.flight.t + dt / 0.6);
      const k = 1 - Math.pow(1 - this.flight.t, 3); // easeOutCubic
      this.rig.camera.position.lerpVectors(this.flight.fromPos, this.flight.toPos, k);
      this.rig.controls.target.lerpVectors(this.flight.fromTarget, this.flight.toTarget, k);
      if (this.flight.t >= 1) this.flight = null;
    }
    this.rig.controls.update();
    this.renderer.render(this.scene, this.rig.camera);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const dom = this.renderer.domElement;
    dom.removeEventListener('pointerdown', this.onPointerDown);
    dom.removeEventListener('pointerup', this.onPointerUp);
    dom.removeEventListener('pointermove', this.onPointerMove);
    dom.removeEventListener('pointerleave', this.onPointerLeave);
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    this.rig.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
