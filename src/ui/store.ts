import { create } from 'zustand';
import { STRINGS, type Locale } from './i18n';
import { SYSTEM_IDS, type Manifest, type Region, type SystemId } from '../data/types';
import type { ViewerUrlState } from '../data/urlState';
import { WonderEngine, type Wonder, type WonderStep } from '../wonders/engine';
import { splitClauses } from '../wonders/caption';
import {
  canRecord,
  MAX_RECORD_MS,
  WonderRecorder,
  type RecorderOverlay,
} from '../wonders/recorder';
import { canSpeak, WonderNarrator } from '../wonders/speech';
import {
  captureStep,
  clampDuration,
  emptyDraft,
  loadDraft,
  moveStep,
  saveDraft,
  type CaptureOptions,
  type ViewSnapshot,
} from '../wonders/draft';
import { computeSystemOpacity } from '../viewer/layers';
import type { ClipAxis } from '../viewer/clipping';
import type { ViewPresetId } from '../viewer/camera';
import type { HyiViewer } from '../viewer/HyiViewer';
import type { QualityTier } from '../viewer/quality';

export type LoadState = 'loading' | 'ready' | 'error' | 'unsupported';

/** 低于这个不透明度就认为「看不清」，聚焦时会把分层挪到该系统的主场。 */
const REVEAL_MIN_OPACITY = 0.6;

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
  /** 信息卡是否展开全文。小屏上默认收起成「名字 + 一句话 + 操作」的窄条 */
  infoExpanded: boolean;
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
  /** 刚讲完的那一则，用来放片尾卡；点掉或几秒后自动清空 */
  wonderOutro: Wonder | null;
  /** 本步是什么时候开始的（performance.now），录像的逐句浮现按它算 */
  wonderStepAt: number;
  /** 这一则是什么时候开播的，片头卡的计时按它算 */
  wonderStartedAt: number;
  /** 这台设备能不能录视频；不能就别把按钮摆出来骗人 */
  canRecordVideo: boolean;
  recording: boolean;
  /** 已录多久（毫秒），四分之一秒刷一次，只给界面看 */
  recordElapsedMs: number;
  /** 录完的成品。url 是 blob:，清掉时要 revoke */
  videoExport: { url: string; ext: string; bytes: number; durationMs: number; name: string } | null;
  /** 这台设备有没有语音合成 */
  canNarrate: boolean;
  /** 语音讲解开着没有（记在 localStorage，下次进来还是这个设置） */
  narrating: boolean;
  /**
   * 点在皮肤上时反查出来的"这是哪儿、底下是什么"。
   * 皮肤是一整张外壳、只有一个结构，没有它的话点头顶和点小腿是同一张卡片。
   */
  skinProbe: { region: Region; nearby: string[] } | null;
  /** 正在编辑的自创奥秘草稿；null = 没开创作面板 */
  draft: Wonder | null;
  /** 创作面板里正在改哪一步（null = 只看列表） */
  draftStep: number | null;

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
  /** 收起内部：退回上一级而不是一路回到全身（脑 → 大脑 → 额叶 是三层） */
  collapseParts(): void;
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
  setInfoExpanded(open: boolean): void;
  startWonder(wonder: Wonder): void;
  exitWonder(): void;
  dismissOutro(): void;
  startRecording(): void;
  stopRecording(): void;
  clearVideoExport(): void;
  toggleNarration(): void;
  openEditor(): void;
  closeEditor(): void;
  newDraft(): void;
  patchDraft(patch: Partial<Wonder>): void;
  captureCurrentStep(opts?: CaptureOptions): void;
  patchStep(index: number, patch: Partial<WonderStep>): void;
  removeStep(index: number): void;
  nudgeStep(index: number, delta: number): void;
  setDraftStep(index: number | null): void;
  loadWonderIntoDraft(wonder: Wonder): void;
  wonderNext(): void;
  wonderPrev(): void;
  wonderToggle(): void;
  applyUrlState(s: ViewerUrlState): void;
}

let viewer: HyiViewer | null = null;
const wonderEngine = new WonderEngine();
const recorder = new WonderRecorder();
const narrator = new WonderNarrator();

/** 语音开关记在本地。用户开了一次就是表达了偏好，下次不该再让他找一遍。 */
const NARRATION_KEY = 'hyi.narration';

function readNarrationPref(): boolean {
  try {
    return localStorage.getItem(NARRATION_KEY) === '1';
  } catch {
    // 隐私模式下 localStorage 可能直接抛异常，读不到就当没开
    return false;
  }
}
/** 录制计时器：只为界面上那行秒数，四分之一秒刷一次就够。 */
let recordTicker: ReturnType<typeof setInterval> | null = null;
/** 录的是哪一则。停下来给文件起名时用——那会儿 store 里的 wonder 已经清空了。 */
let recordingId = 'wonder';

/**
 * 每帧问一次「现在该往视频里画什么字」。
 *
 * 断句结果按（奥秘 + 第几步 + 语言）缓存：30 fps 下每帧重新切一遍字符串是白烧 CPU，
 * 而这三者不变时结果必然一样。
 */
let clauseCache: { key: string; clauses: string[] } | null = null;

function buildOverlay(credit: string, kicker: string, byLabel: string): RecorderOverlay {
  const s = useUiStore.getState();
  const wonder = s.wonder;
  const now = performance.now();
  if (!wonder) return { clauses: [], stepElapsedMs: 0, credit };
  const step = wonder.steps[s.wonderIndex];
  const key = `${wonder.id}/${s.wonderIndex}/${s.lang}`;
  if (!clauseCache || clauseCache.key !== key) {
    clauseCache = { key, clauses: step ? splitClauses(step.text[s.lang]) : [] };
  }
  const title = {
    kicker,
    title: wonder.title[s.lang],
    ...(wonder.subtitle ? { subtitle: wonder.subtitle[s.lang] } : {}),
    ...(wonder.author ? { by: `${byLabel} ${wonder.author}` } : {}),
  };
  return {
    clauses: clauseCache.clauses,
    stepElapsedMs: now - s.wonderStepAt,
    title,
    titleElapsedMs: now - s.wonderStartedAt,
    chapter: {
      index: s.wonderIndex,
      total: wonder.steps.length,
      elapsedMs: now - s.wonderStepAt,
      durationMs: step?.durationMs ?? 1,
    },
    credit,
  };
}

/** 把一步奥秘应用到画面：分层、显隐覆盖、选中与对准。 */
function applyWonderStep(step: WonderStep): void {
  const st = useUiStore.getState();
  // 运镜先定：本步之后触发的每一次相机飞行都用这个手感（慢、两头软、绕开人体），
  // 飞到位之后继续做微动作。缺省 push——静止的画面在视频里是死的。
  viewer?.setCinematic(step.motion ?? 'push', {
    ...(step.transitionMs !== undefined ? { flight: { durationS: step.transitionMs / 1000 } } : {}),
  });
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
  useUiStore.setState({
    wonderIndex: wonderEngine.currentIndex,
    wonderStepAt: performance.now(),
  });
  const st = useUiStore.getState();
  if (st.narrating && step) narrator.speak(step.text[st.lang], st.lang);
});
wonderEngine.addEventListener('play', () => {
  narrator.resume();
  useUiStore.setState({ wonderPlaying: true });
});
wonderEngine.addEventListener('pause', () => {
  // 暂停画面就得暂停声音，不然人停在第 5 步、耳朵还在听第 6 步
  narrator.pause();
  useUiStore.setState({ wonderPlaying: false });
});
wonderEngine.addEventListener('end', (e) => {
  const completed = (e as CustomEvent<{ completed?: boolean }>).detail?.completed === true;
  const st = useUiStore.getState();
  narrator.stop();
  viewer?.setCinematic(null);
  st.select(null);
  st.resetVisibility();
  for (const id of SYSTEM_IDS) {
    if (!st.systemsVisible[id]) st.toggleSystem(id);
    // 步骤可能把某个系统压暗过，退出时要还原，否则画面一直是灰的
    if (st.systemOpacity[id] !== 1) st.setSystemOpacity(id, 1);
  }
  if (recorder.recording) {
    // 留 800 ms 尾巴：最后一句字幕刚浮完就切黑，看着像断片
    if (completed) setTimeout(() => useUiStore.getState().stopRecording(), 800);
    else useUiStore.getState().stopRecording();
  }
  useUiStore.setState({
    wonder: null,
    wonderIndex: 0,
    wonderPlaying: false,
    // 片尾卡只在"讲完了"时出现；中途退出的人不需要再被拦一下
    wonderOutro: completed ? st.wonder : null,
  });
});

/** 各系统的"主场"分层：在这个值上它最清楚，前后几层是它的淡入淡出区间。 */
const HOME_LAYER: Record<SystemId, number> = {
  skin: 0,
  muscles: 0.2, // 曲线峰值；0.24 只有 0.84
  skeleton: 0.45, // 曲线峰值；0.5 已经掉到 0.75
  organs: 0.6,
  vessels: 0.8,
  nerves: 0.8,
};

// 已知局限：骨骼的主场（0.45）上器官也是满不透明的，选中盆骨这类被肠管挡在
// 后面的骨头时，靠的是选中描边把它勾出来。分层曲线里没有哪一档能让骨骼亮而
// 器官暗——这是曲线本身的取舍，要改得动 layers.ts 的整体设计。
// 注意云端软件渲染是 low 档、描边是关的，所以云端截图看不出高亮效果。

/**
 * 聚焦一个结构前，先把分层滑块挪到它看得清的位置。
 *
 * 不然会这样：搜索选中「左髋骨」→ 相机飞进身体里 → 可分层还停在"皮肤"，
 * 骨骼只有 0.22 的不透明度，满屏是半透明组织糊成一团，选中的骨头几乎认不出来
 * （用户实拍复现）。手动去拖滑块本来就是下一步要做的事，替他做了。
 *
 * 只在当前分层下该系统"看不清"时才动，用户自己调到的位置尽量不打扰。
 */
function revealLayerFor(slug: string): void {
  const st = useUiStore.getState();
  const system = st.manifest?.structures[slug]?.system as SystemId | undefined;
  if (!system) return;
  const home = HOME_LAYER[system];
  if (home === undefined) return;
  // 该系统在当前分层下已经够清楚就别动
  if (computeSystemOpacity(system, st.layer) >= REVEAL_MIN_OPACITY) return;
  st.setLayer(home);
}

/** App 挂载 viewer 后调用；canvas 侧的选中事件也在这里回写 store。 */
export function bindViewer(v: HyiViewer | null): void {
  viewer = v;
  if (!v) return;
  v.addEventListener('select', (e) => {
    const slug = (e as CustomEvent<{ slug: string | null }>).detail.slug;
    // 抽屉不再自动收起：信息卡与抽屉在两边（小屏上 CSS 会把抽屉抬到卡片之上），
    // 原来"点一下结构面板就关了"在桌面端很别扭——刚调完不透明度就得重开
    useUiStore.setState({
      selected: slug,
      infoExpanded: false,
      // 换选别的结构就把皮肤的部位反查清掉；点皮肤时紧跟着的 'probe' 事件会重新填上
      ...(slug === 'skin' ? {} : { skinProbe: null }),
    });
  });
  useUiStore.setState({ quality: v.getQuality(), qualityToggleable: v.canToggleQuality() });
  v.addEventListener('progress', (e) => {
    const detail = (e as CustomEvent<{ loaded: number; total: number }>).detail;
    useUiStore.setState({ progress: detail });
  });
  v.addEventListener('probe', (e) => {
    const detail = (e as CustomEvent<{ region: Region | null; nearby: string[] } | null>).detail;
    useUiStore.setState({
      skinProbe: detail?.region ? { region: detail.region, nearby: detail.nearby } : null,
    });
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
  infoExpanded: false,
  wonder: null,
  wonderIndex: 0,
  wonderPlaying: false,
  wonderOutro: null,
  wonderStepAt: 0,
  wonderStartedAt: 0,
  canRecordVideo: canRecord(),
  canNarrate: canSpeak(),
  narrating: readNarrationPref(),
  skinProbe: null,
  draft: null,
  draftStep: null,
  recording: false,
  recordElapsedMs: 0,
  videoExport: null,
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
    // 先把 store 里的选中写上，再交给 viewer。
    //
    // 为什么不能只等 viewer 回写：`HyiViewer.select()` 遇到还没加载的结构会
    // 挂起（pendingSelect）**并且不派发 select 事件**——2026-08-21 首屏缩到只剩
    // 皮肤之后，这意味着"?v=…selected=heart"打开时 store 的 selected 一直是 null，
    // **信息卡压根不渲染**，用户对着一具没有任何提示的身体等十几秒。
    // 信息卡的内容（中英文名、一句话科普、你知道吗、标签）全部来自 manifest，
    // 而 manifest 在 ready 之前就到手了——没有任何理由把它压在几何体后面。
    // 三维高亮与标签仍然等几何体，那本来就只能等。
    const manifest = get().manifest;
    if (slug === null || manifest?.structures[slug]) {
      set({
        selected: slug,
        infoExpanded: false,
        ...(slug === 'skin' ? {} : { skinProbe: null }),
      });
    }
    viewer?.select(slug); // 几何体到位后 viewer 的 select 事件会再回写一次（同值）
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
  collapseParts: () => {
    const { expanded, manifest } = get();
    // 三层层级下「收起内部」应该退一级：从额叶收回大脑，而不是直接回整具人体
    const parent = expanded ? (manifest?.structures[expanded]?.parent ?? null) : null;
    get().expand(parent);
    if (parent) get().select(parent);
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
    revealLayerFor(slug);
    viewer?.focus(slug, from);
  },
  setAttributionOpen: (attributionOpen) => set({ attributionOpen }),

  setInfoExpanded: (infoExpanded) => {
    set({ infoExpanded });
    // 卡片一收一放，安全区跟着变，选中的结构可能被挡住或空出一大块。
    // 这是用户主动的操作，重新对准是预期行为而不是打扰。
    // 等两帧：一帧让 React 改完 DOM，一帧让 useSafeInsets 量到新高度。
    const slug = useUiStore.getState().selected;
    if (!slug || typeof requestAnimationFrame !== 'function') return;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (useUiStore.getState().selected === slug) viewer?.focus(slug);
      }),
    );
  },
  togglePanel: (panel) => set((s) => ({ activePanel: s.activePanel === panel ? null : panel })),

  startWonder: (wonder) => {
    const now = performance.now();
    set({
      wonder,
      wonderIndex: 0,
      wonderPlaying: true,
      activePanel: null,
      wonderOutro: null,
      wonderStartedAt: now,
      wonderStepAt: now,
    });
    wonderEngine.start(wonder);
  },
  exitWonder: () => wonderEngine.stop(),
  dismissOutro: () => set({ wonderOutro: null }),

  /**
   * 开录。会**从头重播**这一则——录一段从中间开始的视频没有意义。
   *
   * 界面上的控制条、抽屉、信息卡不会进视频：合成画布上只有三维画面加我们自己
   * 重画的字幕，DOM 从来没被画进去（见 wonders/recorder.ts）。
   */
  startRecording: () => {
    const s = get();
    const wonder = s.wonder;
    const v = viewer;
    if (!wonder || !v || s.recording || !s.canRecordVideo) return;
    const strings = STRINGS[s.lang];
    try {
      recorder.start(
        v.getCanvas(),
        () => buildOverlay(strings.videoCredit, strings.wondersTitle, strings.wonderBy),
        {},
      );
    } catch {
      set({ canRecordVideo: false });
      return;
    }
    recordingId = wonder.id;
    v.setFrameTap((canvas) => recorder.captureFrame(canvas));
    set({ recording: true, recordElapsedMs: 0, videoExport: null });
    recordTicker = setInterval(() => {
      const elapsed = recorder.elapsedMs;
      set({ recordElapsedMs: elapsed });
      // 分片全攒在内存里，不封顶的话一则 20 分钟的自创奥秘能堆出几百 MB
      if (elapsed > MAX_RECORD_MS) get().stopRecording();
    }, 250);
    get().startWonder(wonder);
  },

  stopRecording: () => {
    if (!recorder.recording) return;
    if (recordTicker) {
      clearInterval(recordTicker);
      recordTicker = null;
    }
    viewer?.setFrameTap(null);
    const name = `hyibody-${recordingId}`;
    void recorder
      .stop()
      .then(({ blob, ext, durationMs }) => {
        set({
          recording: false,
          recordElapsedMs: 0,
          videoExport: { url: URL.createObjectURL(blob), ext, bytes: blob.size, durationMs, name },
        });
      })
      .catch(() => set({ recording: false, recordElapsedMs: 0 }));
  },

  toggleNarration: () => {
    const next = !get().narrating;
    set({ narrating: next });
    try {
      localStorage.setItem(NARRATION_KEY, next ? '1' : '0');
    } catch {
      // 存不下就只在这一次会话里生效，不值得打扰用户
    }
    if (!next) {
      narrator.stop();
      return;
    }
    // 开的这一下就是浏览器要的用户手势，顺手把当前这一步念出来
    const s = get();
    const step = s.wonder?.steps[s.wonderIndex];
    if (step) narrator.speak(step.text[s.lang], s.lang);
  },

  /** 打开创作面板。上次的草稿还在就接着改，没有就开一份新的。 */
  openEditor: () => {
    if (get().draft) return;
    set({ draft: loadDraft() ?? emptyDraft(Date.now()), draftStep: null, activePanel: null });
  },
  closeEditor: () => set({ draft: null, draftStep: null }),

  newDraft: () => set({ draft: emptyDraft(Date.now()), draftStep: null }),

  patchDraft: (patch) => {
    const draft = get().draft;
    if (!draft) return;
    const next = { ...draft, ...patch };
    saveDraft(next);
    set({ draft: next });
  },

  /**
   * 把"现在画面上是什么样"抓成一步，追加到末尾。
   *
   * 这是整套 UGC 的核心动作：用户不需要理解 layer / systems / clip 这些字段，
   * 只需要把画面调成他想要的样子，然后按一下。
   */
  captureCurrentStep: (opts) => {
    const s = get();
    if (!s.draft) return;
    const snapshot: ViewSnapshot = {
      layer: s.layer,
      selected: s.selected,
      expanded: s.expanded,
      clip: s.clip,
      systemsVisible: s.systemsVisible,
      systemOpacity: s.systemOpacity,
    };
    const step = captureStep(snapshot, opts ?? {});
    const next = { ...s.draft, steps: [...s.draft.steps, step] };
    saveDraft(next);
    set({ draft: next, draftStep: next.steps.length - 1 });
  },

  patchStep: (index, patch) => {
    const draft = get().draft;
    if (!draft || !draft.steps[index]) return;
    const steps = draft.steps.map((step, i) =>
      i === index
        ? {
            ...step,
            ...patch,
            ...(patch.durationMs !== undefined
              ? { durationMs: clampDuration(patch.durationMs) }
              : {}),
          }
        : step,
    );
    const next = { ...draft, steps };
    saveDraft(next);
    set({ draft: next });
  },

  removeStep: (index) => {
    const s = get();
    if (!s.draft) return;
    const steps = s.draft.steps.filter((_, i) => i !== index);
    const next = { ...s.draft, steps };
    saveDraft(next);
    set({ draft: next, draftStep: null });
  },

  nudgeStep: (index, delta) => {
    const draft = get().draft;
    if (!draft) return;
    const steps = moveStep(draft.steps, index, index + delta);
    if (steps === draft.steps) return;
    const next = { ...draft, steps };
    saveDraft(next);
    set({ draft: next, draftStep: index + delta });
  },

  setDraftStep: (index) => {
    const s = get();
    set({ draftStep: index });
    // 点开一步就把画面还原成那一步的样子——不然改的是什么全靠脑补
    const step = index === null ? null : s.draft?.steps[index];
    if (step) applyWonderStep(step);
  },

  loadWonderIntoDraft: (wonder) => {
    // 换个 id，免得改着改着覆盖掉内置内容的 id（分享链接会撞车）
    const next = { ...wonder, id: `my_${Date.now().toString(36)}` };
    saveDraft(next);
    set({ draft: next, draftStep: null });
  },

  clearVideoExport: () => {
    const current = get().videoExport;
    // blob: 的 URL 不 revoke，这段视频就一直占着内存直到刷新
    if (current) URL.revokeObjectURL(current.url);
    set({ videoExport: null });
  },
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
