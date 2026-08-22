import { useEffect } from 'react';
import { SYSTEM_IDS } from '../data/types';
import { useUiStore } from './store';

/** 1–6 的顺序与分层滑块一致（由外到内）。 */
const SYSTEM_ORDER = SYSTEM_IDS;

/** 一次按键解析出的动作。渲染层不认识键盘，只认识动作。 */
export type ShortcutAction =
  | { kind: 'none' }
  | { kind: 'escape' }
  | { kind: 'focusSearch' }
  | { kind: 'toggleHelp' }
  | { kind: 'toggleSystem'; index: number }
  | { kind: 'focusSelected' }
  | { kind: 'backToBody' }
  | { kind: 'wonder'; step: 'prev' | 'next' | 'toggle' };

/** 解析按键时需要知道的上下文。 */
export interface ShortcutContext {
  /** 奥秘正在播放——方向键与空格才归它管，否则留给轨道控制器。 */
  wonderActive: boolean;
  /** 焦点在输入框里——除 Esc 外一律放行，不然打字会触发快捷键。 */
  typing: boolean;
}

interface KeyLike {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}

/**
 * 纯函数：按键 + 上下文 → 动作。带修饰键的一律不接管（浏览器快捷键优先）。
 * 单测见 tests/unit/keyboard.test.ts。
 */
export function resolveShortcut(event: KeyLike, ctx: ShortcutContext): ShortcutAction {
  if (event.ctrlKey || event.metaKey || event.altKey) return { kind: 'none' };
  if (event.key === 'Escape') return { kind: 'escape' };
  if (ctx.typing) return { kind: 'none' };

  switch (event.key) {
    case '/':
      return { kind: 'focusSearch' };
    case '?':
      return { kind: 'toggleHelp' };
    case 'f':
    case 'F':
      return { kind: 'focusSelected' };
    case '0':
      return { kind: 'backToBody' };
    case ' ':
      return ctx.wonderActive ? { kind: 'wonder', step: 'toggle' } : { kind: 'none' };
    case 'ArrowLeft':
      return ctx.wonderActive ? { kind: 'wonder', step: 'prev' } : { kind: 'none' };
    case 'ArrowRight':
      return ctx.wonderActive ? { kind: 'wonder', step: 'next' } : { kind: 'none' };
    default:
      break;
  }

  // 1–6 对应分层滑块上的六个系统
  if (event.key >= '1' && event.key <= '6') {
    return { kind: 'toggleSystem', index: Number(event.key) - 1 };
  }
  return { kind: 'none' };
}

/**
 * 焦点是否落在可输入元素里。这里按属性判断而不是 `instanceof HTMLElement`，
 * 单测跑在 node 环境（vite.config.ts）里没有 DOM 构造函数。
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as { tagName?: unknown; isContentEditable?: unknown } | null;
  if (!el || typeof el.tagName !== 'string') return false;
  if (el.isContentEditable === true) return true;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT';
}

export interface KeyboardHandlers {
  /** 是否已经打开了快捷键说明。 */
  helpOpen: boolean;
  setHelpOpen(open: boolean): void;
  /** 分享弹窗由 App 自己管，Esc 时先关它。 */
  shareOpen: boolean;
  setShareOpen(open: boolean): void;
}

/**
 * 把键盘接到 store 上。Esc 有优先级：说明页 → 分享 → 署名 → 奥秘 → 取消选中 → 返回全身，
 * 这样"一直按 Esc"总能退回到初始状态（KICKOFF 第 6 节的可退出原则）。
 */
export function useKeyboardShortcuts(handlers: KeyboardHandlers): void {
  const { helpOpen, setHelpOpen, shareOpen, setShareOpen } = handlers;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const st = useUiStore.getState();
      const action = resolveShortcut(event, {
        wonderActive: st.wonder !== null,
        typing: isTypingTarget(event.target),
      });
      if (action.kind === 'none') return;

      switch (action.kind) {
        case 'escape':
          if (helpOpen) setHelpOpen(false);
          else if (shareOpen) setShareOpen(false);
          else if (st.aboutOpen) st.setAboutOpen(false);
          else if (st.wonder) st.exitWonder();
          else if (st.selected) st.select(null);
          else if (st.isolated || st.expanded || st.clip || st.hiddenCount > 0) st.backToBody();
          else return;
          break;
        case 'focusSearch': {
          // 搜索框常驻，直接聚焦并全选，接着打字就是新的查询
          const input = document.querySelector<HTMLInputElement>('.hyi-search input');
          input?.focus();
          input?.select();
          break;
        }
        case 'toggleHelp':
          setHelpOpen(!helpOpen);
          break;
        case 'toggleSystem': {
          const id = SYSTEM_ORDER[action.index];
          if (!id) return;
          st.toggleSystem(id);
          break;
        }
        case 'focusSelected':
          if (!st.selected) return;
          st.focus(st.selected);
          break;
        case 'backToBody':
          st.backToBody();
          break;
        case 'wonder':
          if (action.step === 'prev') st.wonderPrev();
          else if (action.step === 'next') st.wonderNext();
          else st.wonderToggle();
          break;
      }
      event.preventDefault();
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [helpOpen, setHelpOpen, shareOpen, setShareOpen]);
}
