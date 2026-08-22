import { STRINGS } from './i18n';
import { useEffect, useRef, useState } from 'react';
import { decodeUrlState, encodeUrlState } from '../data/urlState';
import { HyiViewer } from '../viewer/HyiViewer';
import type { QualityTier } from '../viewer/quality';
import { hasWebGL2 } from '../viewer/support';
import { AboutDialog } from './AboutDialog';
import { InfoCard } from './InfoCard';
import { Kiosk } from './Kiosk';
import { LayerBar } from './LayerBar';
import { LoadingOverlay } from './LoadingOverlay';
import { StructureLabel } from './StructureLabel';
import { SearchBox } from './SearchBox';
import { ShortcutHelp } from './ShortcutHelp';
import { ShareDialog } from './ShareDialog';
import { useKeyboardShortcuts } from './keyboard';
import { useSafeInsets } from './useSafeInsets';
import { WONDERS } from '../wonders';
import { bindViewer, toUrlState, useUiStore } from './store';
import { Dock } from './Dock';
import { InfoIcon } from './Icon';
import { PersonalMenu } from './PersonalMenu';
import { WonderMenu, WonderPlayer } from './WonderPlayer';
import type { AtlasScene } from '../data/views';
import { WonderGallery } from './WonderGallery';
import { AtlasGallery } from './AtlasGallery';
import { WonderStage } from './WonderStage';
import { VideoExport } from './VideoExport';
import { WonderEditor } from './WonderEditor';
import { decodeWonder } from '../wonders/draft';
import './ui.css';

/** Kiosk 参数：?kiosk=1（或分享状态里带 kiosk）开启；?idle=秒 调闲置阈值。 */
function readKioskParams(): { kiosk: boolean; idleSeconds: number } {
  const params = new URLSearchParams(window.location.search);
  const kiosk = params.get('kiosk') === '1' || decodeUrlState(params.get('v')).kiosk === true;
  const idle = Number(params.get('idle'));
  return { kiosk, idleSeconds: Number.isFinite(idle) && idle >= 2 ? idle : 60 };
}

/** `?hq=high|medium|low` 强制画质档位（真机比对与截图测试用）；不传则自动判断。 */
function readQualityParam(): QualityTier | undefined {
  const value = new URLSearchParams(window.location.search).get('hq');
  return value === 'high' || value === 'medium' || value === 'low' ? value : undefined;
}

/** 状态变化后把 ?v= 写回地址栏（防抖，replaceState 不产生历史记录）。 */
function useUrlSync(): void {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsub = useUiStore.subscribe((s, prev) => {
      if (s.loadState !== 'ready') return;
      if (
        s.layer === prev.layer &&
        s.mixMode === prev.mixMode &&
        s.systemOpacity === prev.systemOpacity &&
        s.systemsVisible === prev.systemsVisible &&
        s.clip === prev.clip &&
        s.selected === prev.selected
      )
        return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const url = new URL(window.location.href);
        url.searchParams.set('v', encodeUrlState(toUrlState()));
        window.history.replaceState(null, '', url);
      }, 400);
    });
    return () => {
      if (timer) clearTimeout(timer);
      unsub();
    };
  }, []);
}

export function App() {
  const t = STRINGS[useUiStore((s) => s.lang)];
  const containerRef = useRef<HTMLDivElement>(null);
  const loadState = useUiStore((s) => s.loadState);
  const manifest = useUiStore((s) => s.manifest);
  const setAboutOpen = useUiStore((s) => s.setAboutOpen);
  const wonder = useUiStore((s) => s.wonder);
  const [shareOpen, setShareOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const selected = useUiStore((s) => s.selected);
  const lang = useUiStore((s) => s.lang);
  const [{ kiosk, idleSeconds }] = useState(readKioskParams);
  useUrlSync();
  useSafeInsets();
  useKeyboardShortcuts({ helpOpen, setHelpOpen, shareOpen, setShareOpen });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    // three 0.185 没有 WebGL1 兜底，先问一句，好给出能照做的提示
    if (!hasWebGL2()) {
      useUiStore.getState().setLoadState('unsupported');
      return;
    }
    const viewer = new HyiViewer(container, {
      base: import.meta.env.BASE_URL,
      quality: readQualityParam(),
    });
    bindViewer(viewer);
    // ?v= 要在 load 之前先解一次：后台补载的顺序得知道用户点名了哪个结构。
    // 下面 then 里那次解码保留——那是"把状态套到已经就绪的场景上"，是另一件事。
    const initialState = decodeUrlState(new URLSearchParams(window.location.search).get('v'));
    viewer
      .load(initialState.selected ? { prioritizeStructure: initialState.selected } : {})
      .then(() => {
        const m = viewer.getManifest();
        if (m) useUiStore.getState().setManifest(m);
        useUiStore.getState().setLoadState('ready');
        // 恢复分享链接状态（?v=）
        const params = new URLSearchParams(window.location.search);
        const encoded = params.get('v');
        if (encoded) useUiStore.getState().applyUrlState(decodeUrlState(encoded));
        // ?wonder=<id> 直接开播内置的某一则（分享链接用）
        const wantWonder = params.get('wonder');
        if (wantWonder) {
          const found = WONDERS.find((w) => w.id === wantWonder);
          if (found) useUiStore.getState().startWonder(found);
        }
        // ?w=<编码> 开播别人自创的一则。内容整则在链接里，不需要后端。
        // decodeWonder 对坏链接返回 null 而不是抛——链接会被聊天软件截断
        const shared = decodeWonder(params.get('w'));
        if (shared) useUiStore.getState().startWonder(shared);
        // ?thumbs=1 给缩略图脚本开一个后门：一次加载、逐个摆画面、逐个截图。
        // 没有它就只能每张图重开一次页面——软件渲染下一次加载就是一分钟，
        // 六十多张要跑一小时。和 ?stats=1 / ?surf= 一样是调试开关，
        // 不给这个参数时 window 上什么都不会多出来。
        if (params.get('thumbs') === '1') {
          (window as unknown as Record<string, unknown>).__hyiPose = (scene: AtlasScene) =>
            useUiStore.getState().poseScene(scene);
        }
      })
      .catch(() => useUiStore.getState().setLoadState('error'));
    return () => {
      bindViewer(null);
      viewer.dispose();
    };
  }, []);

  const isPlaceholder = manifest?.systems[0]?.id === 'placeholder';

  return (
    <div style={{ position: 'relative', height: '100%', overflow: 'hidden' }}>
      <div ref={containerRef} data-testid="viewer" style={{ position: 'absolute', inset: 0 }} />
      <header className="hyi-header">
        <h1>{t.brand}</h1>
        <span className="hyi-header-sub">{t.subtitle}</span>
      </header>
      <LoadingOverlay />
      {(loadState === 'error' || loadState === 'unsupported') && (
        <p data-testid="viewer-status" className="hyi-center-status">
          {loadState === 'unsupported' ? t.unsupportedWebgl : t.loadError}
        </p>
      )}
      {loadState === 'ready' && !isPlaceholder && (
        <>
          {/* 顶栏（2026-08-22 收拢）：内容入口（奥秘/细剖）+ 两个图标——
              ℹ 关于（简介/语言/署名/快捷键）、👤 个人中心（分享/创作） */}
          <div className="hyi-topbar">
            <WonderMenu />
            <button
              className="hyi-btn hyi-btn-icon"
              aria-label={t.aboutTitle}
              title={t.aboutTitle}
              onClick={() => setAboutOpen(true)}
            >
              <InfoIcon />
            </button>
            <PersonalMenu onShare={() => setShareOpen(true)} />
          </div>
          {/* 播放时屏幕归内容：搜索框、工具抽屉、结构标签、信息卡一起让位。
              这不违反「界面元素不许无解释地消失」——奥秘是一个用户自己进、
              随时能按「退出」出来的模式，不是为了省空间偷偷藏东西。 */}
          {!wonder && <SearchBox />}
          {!wonder && <Dock />}
          {!wonder && <StructureLabel />}
          {!wonder && <InfoCard />}
          {/* 放映层在控制条之下渲染、在层级上盖住画面：黑边、片头、字幕、片尾 */}
          <WonderStage />
          {/* 整页画廊盖在最上层：开着的时候它就是整块屏幕 */}
          <WonderGallery />
          <AtlasGallery />
          {wonder ? <WonderPlayer /> : <LayerBar />}
          <AboutDialog onOpenHelp={() => setHelpOpen(true)} />
          <WonderEditor />
          <VideoExport />
          {shareOpen && <ShareDialog onClose={() => setShareOpen(false)} />}
          {helpOpen && <ShortcutHelp onClose={() => setHelpOpen(false)} />}
          {/* 点画布选中结构时读屏软件也要能听见，所以单独播一条 */}
          <p className="hyi-sr-only" role="status" aria-live="polite">
            {selected && manifest?.structures[selected]
              ? lang === 'zh'
                ? manifest.structures[selected].zh
                : manifest.structures[selected].en
              : ''}
          </p>
          {kiosk && <Kiosk idleSeconds={idleSeconds} />}
        </>
      )}
      {loadState === 'ready' && isPlaceholder && (
        <footer
          style={{
            position: 'absolute',
            bottom: 10,
            left: 0,
            right: 0,
            textAlign: 'center',
            fontSize: 12,
            opacity: 0.55,
            pointerEvents: 'none',
          }}
        >
          {t.placeholderNotice}
        </footer>
      )}
    </div>
  );
}
