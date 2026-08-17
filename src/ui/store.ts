import { create } from 'zustand';
import type { Manifest, SystemId } from '../data/types';
import type { ViewerUrlState } from '../data/urlState';
import type { ClipAxis } from '../viewer/clipping';
import type { ViewPresetId } from '../viewer/camera';
import type { HyiViewer } from '../viewer/HyiViewer';

export type LoadState = 'loading' | 'ready' | 'error';

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
  hiddenCount: number;
  clip: { axis: ClipAxis; pos: number } | null;
  attributionOpen: boolean;

  setLoadState(s: LoadState): void;
  setManifest(m: Manifest): void;
  markSystemLoaded(id: string): void;
  setLayer(v: number): void;
  toggleSystem(id: SystemId): void;
  setSystemOpacity(id: SystemId, v: number): void;
  select(slug: string | null): void;
  isolate(slug: string | null): void;
  hide(slug: string): void;
  resetVisibility(): void;
  setClip(clip: { axis: ClipAxis; pos: number } | null): void;
  applyPreset(id: ViewPresetId): void;
  focus(slug: string): void;
  setAttributionOpen(open: boolean): void;
  applyUrlState(s: ViewerUrlState): void;
}

let viewer: HyiViewer | null = null;

/** App 挂载 viewer 后调用；canvas 侧的选中事件也在这里回写 store。 */
export function bindViewer(v: HyiViewer | null): void {
  viewer = v;
  if (!v) return;
  v.addEventListener('select', (e) => {
    const slug = (e as CustomEvent<{ slug: string | null }>).detail.slug;
    useUiStore.setState({ selected: slug });
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
  hiddenCount: 0,
  clip: null,
  attributionOpen: false,

  setLoadState: (loadState) => set({ loadState }),
  setManifest: (manifest) =>
    set({ manifest, loadedSystems: manifest.systems.map((s) => s.id) as string[] }),
  markSystemLoaded: (id) =>
    set((s) => ({
      loadedSystems: s.loadedSystems.includes(id) ? s.loadedSystems : [...s.loadedSystems, id],
    })),

  setLayer: (v) => {
    viewer?.setLayer(v);
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
  hide: (slug) => {
    viewer?.hide(slug);
    set({ hiddenCount: viewer?.hiddenCount() ?? 0 });
  },
  resetVisibility: () => {
    viewer?.resetVisibility();
    set({ hiddenCount: 0, isolated: null });
  },
  setClip: (clip) => {
    viewer?.setClip(clip);
    set({ clip });
  },
  applyPreset: (id) => {
    viewer?.applyPreset(id);
  },
  focus: (slug) => {
    viewer?.focus(slug);
  },
  setAttributionOpen: (attributionOpen) => set({ attributionOpen }),

  applyUrlState: (s) => {
    const st = get();
    st.setLayer(s.layer);
    if (s.systems) {
      for (const [id, visible] of Object.entries(s.systems)) {
        if (visible === false && st.systemsVisible[id as SystemId]) st.toggleSystem(id as SystemId);
      }
    }
    if (s.clip) st.setClip({ axis: s.clip.axis, pos: s.clip.pos });
    if (s.selected) st.select(s.selected);
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
  if (s.clip) state.clip = { axis: s.clip.axis, pos: Math.round(s.clip.pos * 100) / 100 };
  if (s.selected) state.selected = s.selected;
  const pose = viewer?.getCameraPose();
  if (pose)
    state.cam = {
      pos: pose.pos.map((n) => Math.round(n)) as [number, number, number],
      target: pose.target.map((n) => Math.round(n)) as [number, number, number],
    };
  return state;
}
