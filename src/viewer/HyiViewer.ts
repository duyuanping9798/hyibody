import {
  AmbientLight,
  Box3,
  Clock,
  DirectionalLight,
  Group,
  Mesh,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { loadManifest } from '../data/manifest';
import type { Manifest } from '../data/types';
import { createCameraRig, type CameraRig } from './camera';
import { createStructureMaterial } from './materials';

export interface HyiViewerOptions {
  /** 站点部署基路径，传 import.meta.env.BASE_URL */
  base: string;
}

/**
 * 纯 three.js 渲染核心（禁止 import React）。
 * M0：加载 manifest 声明的 glb（当前为程序生成的占位模型）并轨道旋转。
 * M1 起在此基础上扩展分层、拾取、剖切、高亮（见 docs/KICKOFF.md 第 5–6 节）。
 */
export class HyiViewer extends EventTarget {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly root = new Group();

  private readonly container: HTMLElement;
  private readonly rig: CameraRig;
  private readonly clock = new Clock();
  private readonly resizeObserver: ResizeObserver;
  private disposed = false;
  private manifest: Manifest | null = null;

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
    container.appendChild(this.renderer.domElement);

    this.rig = createCameraRig(this.renderer.domElement, 1);
    this.scene.add(this.root);
    this.scene.add(new AmbientLight(0x8899bb, 0.9));
    const key = new DirectionalLight(0xffffff, 1.6);
    key.position.set(1200, -2000, 1800);
    this.scene.add(key);
    const rim = new DirectionalLight(0x33ddee, 0.6);
    rim.position.set(-1500, 1200, 600);
    this.scene.add(rim);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.renderer.setAnimationLoop(() => this.tick());
  }

  /** 加载 manifest 及其声明的全部系统 glb。完成后派发 'ready'。 */
  async load(): Promise<void> {
    try {
      this.manifest = await loadManifest(this.options.base);
      const loader = new GLTFLoader();
      // 流水线 glb 经 meshopt 压缩（EXT_meshopt_compression，M1-4）
      loader.setMeshoptDecoder(MeshoptDecoder);
      const base = this.options.base.replace(/\/?$/, '/');
      await Promise.all(
        this.manifest.systems.map(async (system) => {
          const gltf = await loader.loadAsync(`${base}${system.file}`);
          gltf.scene.traverse((obj) => {
            if (obj instanceof Mesh) {
              obj.material = createStructureMaterial(0x9fb8d8);
            }
          });
          this.root.add(gltf.scene);
        }),
      );
      this.frameContent();
      this.container.dataset.hyiReady = '1';
      this.dispatchEvent(new CustomEvent('ready', { detail: { manifest: this.manifest } }));
    } catch (error) {
      this.container.dataset.hyiError = String(error);
      this.dispatchEvent(new CustomEvent('error', { detail: error }));
      throw error;
    }
  }

  getManifest(): Manifest | null {
    return this.manifest;
  }

  /** 相机取景框住当前内容 */
  private frameContent(): void {
    const box = new Box3().setFromObject(this.root);
    if (box.isEmpty()) return;
    const center = box.getCenter(new Vector3());
    const size = box.getSize(new Vector3());
    const radius = Math.max(size.x, size.y, size.z) * 0.5;
    this.rig.controls.target.copy(center);
    const dist = radius / Math.tan(((this.rig.camera.fov / 2) * Math.PI) / 180);
    this.rig.camera.position.set(center.x, center.y - dist * 1.25, center.z + radius * 0.35);
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
    this.clock.getDelta();
    this.rig.controls.update();
    this.renderer.render(this.scene, this.rig.camera);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    this.rig.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
