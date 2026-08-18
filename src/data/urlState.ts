import type { SystemId } from './types';

/** 可通过 URL `?v=` 分享/恢复的查看器状态（KICKOFF 第 6 节）。 */
export interface ViewerUrlState {
  /** 分层滑块 0–1 */
  layer: number;
  /** 各系统显隐开关；缺省为全部可见 */
  systems?: Partial<Record<SystemId, boolean>>;
  /** 剖切：轴 + 位置（-1..1），undefined 表示未开启 */
  clip?: { axis: 'x' | 'y' | 'z'; pos: number; flip?: boolean };
  /** 相机位置与目标点 */
  cam?: { pos: [number, number, number]; target: [number, number, number] };
  /** 选中结构 slug */
  selected?: string;
  lang?: 'zh' | 'en';
  kiosk?: boolean;
}

export const DEFAULT_URL_STATE: ViewerUrlState = { layer: 0 };

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  const bin = atob(b64 + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** 编码为 URL 安全字符串（base64url(JSON)）。 */
export function encodeUrlState(state: ViewerUrlState): string {
  const json = JSON.stringify(state);
  return toBase64Url(new TextEncoder().encode(json));
}

/** 解码；任何非法输入都回退到默认状态而不是抛错，保证分享链接坏了页面也能开。 */
export function decodeUrlState(encoded: string | null | undefined): ViewerUrlState {
  if (!encoded) return { ...DEFAULT_URL_STATE };
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(fromBase64Url(encoded)));
    if (typeof parsed !== 'object' || parsed === null) return { ...DEFAULT_URL_STATE };
    const s = parsed as Partial<ViewerUrlState>;
    const layer = typeof s.layer === 'number' ? Math.min(1, Math.max(0, s.layer)) : 0;
    const state: ViewerUrlState = { layer };
    if (s.systems && typeof s.systems === 'object') state.systems = s.systems;
    if (s.clip && (s.clip.axis === 'x' || s.clip.axis === 'y' || s.clip.axis === 'z'))
      state.clip = {
        axis: s.clip.axis,
        pos: Math.min(1, Math.max(-1, Number(s.clip.pos) || 0)),
        ...(s.clip.flip === true ? { flip: true } : {}),
      };
    if (s.cam && Array.isArray(s.cam.pos) && Array.isArray(s.cam.target))
      state.cam = s.cam as NonNullable<ViewerUrlState['cam']>;
    if (typeof s.selected === 'string') state.selected = s.selected;
    if (s.lang === 'zh' || s.lang === 'en') state.lang = s.lang;
    if (typeof s.kiosk === 'boolean') state.kiosk = s.kiosk;
    return state;
  } catch {
    return { ...DEFAULT_URL_STATE };
  }
}
