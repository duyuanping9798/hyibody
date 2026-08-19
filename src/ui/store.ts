import { create } from 'zustand';
import type { Locale } from './i18n';
import { SYSTEM_IDS, type Manifest, type SystemId } from '../data/types';
import type { ViewerUrlState } from '../data/urlState';
import { WonderEngine, type Wonder, type WonderStep } from '../wonders/engine';
import type { ClipAxis } from '../viewer/clipping';
import type { ViewPresetId } from '../viewer/camera';
import type { HyiViewer } from '../viewer/HyiViewer';
import type { QualityTier } from '../viewer/quality';

export type LoadState = 'loading' | 'ready' | 'error' | 'unsupported';

/** 工具抽屉里的三格。 */
export type PanelId = 'systems' | 'views' | 'clip';

/** UI 状态（Zustand）。viewer 实例不进 store，动作经 bindViewer 的引用转发。 */
interface UiState {
  loadState: LoadState;
  manifest: Manifest | null;
  loadedSystems: string[];
  layer: number;
  systemsVisible: Record<SystemId, boolean>;
  systemOpacity: Record<SystemId, number>;
  selected: string | null;
  isolated: string | null;
  /** 正在展开内部的父结构（心脏 → 心室壁/瓣膜…） */
  expanded: string | null;
  hiddenCount: number;
  clip: { axis: ClipAxis; pos: number; flip?: boolean } | null;
  attributionOpen: boolean;
  /** 工具抽屉：当前展开的那一格，null = 全收起（桌面与小屏同一套，见 Dock.tsx） */
  activePanel: PanelId | null;
  /** 搜索框是否展开（默认收起成一个图标，见 App.tsx 的界面减负说明） */
  searchOpen: boolean;
  /** 界面语言（M2-5，默认中文） */
  lang: Locale;
  /** 资产加载进度（loaded/total 个系统 glb） */
  progress: { loaded: number; total: number };
  /** 画质档位（B 步渲染升级）：low 是软件渲染兜底，不给切 */
  quality: QualityTier;
  qualityToggleable: boolean;
  /** 奥秘播放状态（M2-1） */
  wonder: Wonder | null;
  wonderIndex: number;
  wonderPlaying: boolean;

  setLang(lang: Locale): void;
  setQuality(q: QualityTier): void;
  setLoadState(s: LoadState): void;
  setManifest(m: Manifest): void;
  markSystemLoaded(id: string): void;
  setLayer(v: number, immediate?: boolean): void;
  toggleSystem(id: SystemId): void;
  setSystemOpacity(id: SystemId, v: number): void;
  select(slug: string | null): void;
  isolate(slug: string | null): void;
  expand(slug: string | null): void;
  hide(slug: string): void;
  resetVisibility(): void;
  /** 一键回到全身：清掉隔离/展开/剖切/隐藏，并把相机拉回默认取景 */
  backToBody(): void;
  setClip(clip: { axis: ClipAxis; pos: number; flip?: boolean } | null): void;
  clipThroughSelected(): void;
  applyPreset(id: ViewPresetId): void;
  focus(slug: string, from?: ViewPresetId): void;
  setAttributionOpen(open: boolean): void;
  togglePanel(panel: PanelId): void;
  setSearchOpen(open: boolean): void;
  startWonder(wonder: Wonder): void;
  exitWonder(): void;
  wonderNext(): void;
  wonderPrev(): void;
  wonderToggle(): void;
  applyUrlState(s: ViewerUrlState): void;
}

let viewer: HyiViewer | null = null;
const wonderEngine = new WonderEngine();

/** 把一步奥秘应用到画面：分层、显隐覆盖、选中与对准。 */
function applyWonderStep(step: WonderStep): void {
  const st = useUiStore.getState();
  st.setLayer(step.layer);
  for (const id of SYSTEM_IDS) {
    const want = step.systems?.[id] ?? true;
    // false = 关掉；数字 = 压暗到该不透明度；true/缺省 = 完全可见
    const visible = want !== false;
    if (st.systemsVisible[id] !== visible) st.toggleSystem(id);
    const opacity = typeof want === 'number' ? Math.min(1, Math.max(0, want)) : 1;
    if (st.systemOpacity[id] !== opacity) st.setSystemOpacity(id, opacity);
  }
  // 展开/剖切要在选中之前定好：内部件得先登场，才轮得到选中它
  st.expand(step.expand ?? null);
  st.setClip(step.clip ?? null);
  if (step.preset) st.applyPreset(step.preset);
  if (step.selected) {
    st.select(step.selected);
    // from 只定方向、focus 定距离；preset 是整具人体宽景，给了就不再特写
    if (step.focus !== false && !step.preset) st.focus(step.selected, step.from);
  } else {
    st.select(null);
  }
}

wonderEngine.addEventListener('step', (e) => {
  const { step } = (e as CustomEvent<{ index: number; step: WonderStep | null }>).detail;
  if (step) applyWonderStep(step);
  useUiStore.setState({ wonderIndex: wonderEngine.currentIndex });
});
wonderEngine.addEventListener('play', () => useUiStore.setState({ wonderPlaying: true }));
wonderEngine.addEventListener('pause', () => useUiStore.setState({ wonderPlaying: false }));
wonderEngine.addEventListener('end', () => {
  const st = useUiStore.getState();
  st.select(null);
  st.resetVisibility();
  for (const id of SYSTEM_IDS) {
    if (!st.systemsVisible[id]) st.toggleSystem(id);
    // 步骤可能把某个系统压暗过，退出时要还原，否则画面一直是灰的
    if (st.systemOpacity[id] !== 1) st.setSystemOpacity(id, 1);
  }
  useUiStore.setState({ wonder: null, wonderIndex: 0, wonderPlaying: false });
});

/** App 挂载 viewer 后调用；canvas 侧的选中事件也在这里回写 store。 */
export function bindViewer(v: HyiViewer | null): void {
  viewer = v;
  if (!v) return;
  v.addEventListener('select', (e) => {
    const slug = (e as CustomEvent<{ slug: string | null }>).detail.slug;
    // 抽屉不再自动收起：信息卡与抽屉在两边（小屏上 CSS 会把抽屉抬到卡片之上），
    // 原来"点一下结构面板就关了"在桌面端很别扭——刚调完不透明度就得重开
    useUiStore.setState({ selected: slug });
  });
  useUiStore.setState({ quality: v.getQuality(), qualityToggleable: v.canToggleQuality() });
  v.addEventListener('progress', (e) => {
    const detail = (e as CustomEvent<{ loaded: number; total: number }>).detail;
    useUiStore.setState({ progress: detail });
  });
  v.addEventListener('systemloaded', (e) => {
    const system = (e as CustomEvent<{ system: string }>).detail.system;
    useUiStore.getState().markSystemLoaded(system);
  });
}

export function getViewer(): HyiViewer | null {
  return viewer;
}

const ALL_VISIBLE: Record<SystemId, boolean> = {
  skin: true,
  muscles: true,
  skeleton: true,
  organs: true,
  vessels: true,
  nerves: true,
};

const FULL_OPACITY: Record<SystemId, number> = {
  skin: 1,
  muscles: 1,
  skeleton: 1,
  organs: 1,
  vessels: 1,
  nerves: 1,
};

export const useUiStore = create<UiState>((set, get) => ({
  loadState: 'loading',
  manifest: null,
  loadedSystems: [],
  layer: 0,
  systemsVisible: { ...ALL_VISIBLE },
  systemOpacity: { ...FULL_OPACITY },
  selected: null,
  isolated: null,
  expanded: null,
  hiddenCount: 0,
  clip: null,
  attributionOpen: false,
  activePanel: null,
  searchOpen: false,
  wonder: null,
  wonderIndex: 0,
  wonderPlaying: false,
  lang: 'zh',
  progress: { loaded: 0, total: 0 },
  quality: 'medium',
  qualityToggleable: false,

  setQuality: (quality) => {
    viewer?.setQuality(quality);
    set({ quality });
  },
  setLang: (lang) => {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    set({ lang });
  },
  setLoadState: (loadState) => set({ loadState }),
  setManifest: (manifest) =>
    set({ manifest, loadedSystems: manifest.systems.map((s) => s.id) as string[] }),
  markSystemLoaded: (id) =>
    set((s) => ({
      loadedSystems: s.loadedSystems.includes(id) ? s.loadedSystems : [...s.loadedSystems, id],
    })),

  setLayer: (v, immediate = false) => {
    viewer?.setLayer(v, immediate);
    set({ layer: v });
  },
  toggleSystem: (id) => {
    const visible = !get().systemsVisible[id];
    viewer?.setSystemVisible(id, visible);
    set((s) => ({ systemsVisible: { ...s.systemsVisible, [id]: visible } }));
  },
  setSystemOpacity: (id, v) => {
    viewer?.setSystemOpacity(id, v);
    set((s) => ({ systemOpacity: { ...s.systemOpacity, [id]: v } }));
  },
  select: (slug) => {
    viewer?.select(slug); // viewer 的 select 事件会回写 store
  },
  isolate: (slug) => {
    viewer?.isolate(slug);
    set({ isolated: slug });
  },
  expand: (slug) => {
    viewer?.expand(slug);
    const state = viewer?.getState();
    set({
      expanded: slug,
      isolated: state?.isolated ?? null,
      selected: state?.selected ?? null,
    });
  },
  hide: (slug) => {
    viewer?.hide(slug);
    set({ hiddenCount: viewer?.hiddenCount() ?? 0 });
  },
  resetVisibility: () => {
    viewer?.resetVisibility();
    viewer?.expand(null);
    set({ hiddenCount: 0, isolated: null, expanded: null });
  },
  backToBody: () => {
    const st = get();
    st.resetVisibility();
    st.setClip(null);
    st.select(null);
    st.applyPreset('hero');
  },
  setClip: (clip) => {
    viewer?.setClip(clip);
    set({ clip });
  },
  clipThroughSelected: () => {
    const slug = get().selected;
    if (!slug || !viewer) return;
    if (viewer.clipThroughStructure(slug)) {
      set({ clip: viewer.getState().clip });
    }
  },
  applyPreset: (id) => {
    viewer?.applyPreset(id);
  },
  focus: (slug, from) => {
    viewer?.focus(slug, from);
  },
  setAttributionOpen: (attributionOpen) => set({ attributionOpen }),
  setSearchOpen: (searchOpen) => set({ searchOpen }),
  togglePanel: (panel) => set((s) => ({ activePanel: s.activePanel === panel ? null : panel })),

  startWonder: (wonder) => {
    set({ wonder, wonderIndex: 0, wonderPlaying: true, activePanel: null, searchOpen: false });
    wonderEngine.start(wonder);
  },
  exitWonder: () => wonderEngine.stop(),
  wonderNext: () => wonderEngine.next(),
  wonderPrev: () => wonderEngine.prev(),
  wonderToggle: () => {
    if (wonderEngine.isPlaying) wonderEngine.pause();
    else wonderEngine.play();
  },

  applyUrlState: (s) => {
    const st = get();
    // 分享链接恢复的是"结果状态"，不该看到一段过渡动画
    st.setLayer(s.layer, true);
    if (s.systems) {
      for (const [id, visible] of Object.entries(s.systems)) {
        if (visible === false && st.systemsVisible[id as SystemId]) st.toggleSystem(id as SystemId);
      }
    }
    if (s.clip) st.setClip({ axis: s.clip.axis, pos: s.clip.pos, flip: s.clip.flip === true });
    if (s.expanded) st.expand(s.expanded);
    if (s.selected) st.select(s.selected);
    if (s.lang) st.setLang(s.lang);
    if (s.cam && viewer) viewer.setCameraPose(s.cam.pos, s.cam.target);
  },
}));

/** 当前 UI 状态 → 可分享的 URL 状态。 */
export function toUrlState(): ViewerUrlState {
  const s = useUiStore.getState();
  const state: ViewerUrlState = { layer: Math.round(s.layer * 1000) / 1000 };
  const hiddenSystems = Object.entries(s.systemsVisible).filter(([, v]) => !v);
  if (hiddenSystems.length > 0)
    state.systems = Object.fromEntries(hiddenSystems.map(([id]) => [id, false]));
  if (s.clip) {
    state.clip = {
      axis: s.clip.axis,
      pos: Math.round(s.clip.pos * 100) / 100,
      ...(s.clip.flip ? { flip: true } : {}),
    };
  }
  if (s.selected) state.selected = s.selected;
  if (s.expanded) state.expanded = s.expanded;
  if (s.lang === 'en') state.lang = 'en';
  const pose = viewer?.getCameraPose();
  if (pose)
    state.cam = {
      pos: pose.pos.map((n) => Math.round(n)) as [number, number, number],
      target: pose.target.map((n) => Math.round(n)) as [number, number, number],
    };
  return state;
}
