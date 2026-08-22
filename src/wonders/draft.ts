import { fromBase64Url, toBase64Url } from '../data/base64url';
import { SYSTEM_IDS, type SystemId } from '../data/types';
import type { MotionId } from '../viewer/cinematic';
import type { ViewPresetId } from '../viewer/camera';
import { WONDER_SCHEMA, type Wonder, type WonderStep } from './engine';

/**
 * 自创奥秘（UGC）的草稿：抓画面成步、存本地、导入导出、编成链接。
 *
 * 这里只放**纯逻辑**——不碰 React、不碰 three。理由很实际：这几个函数是整套
 * UGC 里最容易出错的部分（编码、校验、边界），必须能在单测里逐条钉死。
 */

export const DRAFT_KEY = 'hyi.wonderDraft';

/** 一步允许的时长范围，与 content/schema/wonder.schema.json 对齐。 */
export const MIN_STEP_MS = 3000;
export const MAX_STEP_MS = 20000;
/** 想发布至少要这么多步（schema 的 minItems）。少于此仍可播放、可分享。 */
export const PUBLISH_MIN_STEPS = 4;

export interface DraftProblem {
  code:
    | 'idFormat'
    | 'titleMissing'
    | 'authorMissing'
    | 'noSteps'
    | 'tooFewSteps'
    | 'stepText'
    | 'stepDuration';
  /** 第几步出的问题（从 0 数），整体性问题不带 */
  stepIndex?: number;
}

/** 抓一步时能从界面拿到的全部状态。刻意用普通对象，方便单测直接造。 */
export interface ViewSnapshot {
  layer: number;
  /** true = 混合模式：systemOpacity 就是最终值，layer 曲线不参与（缺省 false） */
  mixMode?: boolean;
  selected: string | null;
  expanded: string | null;
  clip: { axis: 'x' | 'y' | 'z'; pos: number; flip?: boolean } | null;
  systemsVisible: Record<SystemId, boolean>;
  systemOpacity: Record<SystemId, number>;
}

export interface CaptureOptions {
  motion?: MotionId;
  durationMs?: number;
  from?: ViewPresetId;
  preset?: ViewPresetId;
  text?: { zh: string; en: string };
}

const DEFAULT_STEP_MS = 8000;

/**
 * 把"现在画面上是什么样"抓成一步。
 *
 * 只记与默认不同的系统覆盖：一步里六个系统全写成 `true` 会让 JSON 膨胀一倍，
 * 而缺省本来就是"完全可见"。分享链接长度直接受这一条影响。
 */
export function captureStep(snapshot: ViewSnapshot, opts: CaptureOptions = {}): WonderStep {
  const systems: Partial<Record<SystemId, boolean | number>> = {};
  for (const id of SYSTEM_IDS) {
    const visible = snapshot.systemsVisible[id];
    const opacity = snapshot.systemOpacity[id];
    if (!visible) systems[id] = false;
    else if (opacity < 1) systems[id] = Math.round(opacity * 100) / 100;
  }
  const step: WonderStep = {
    text: opts.text ?? { zh: '', en: '' },
    layer: Math.min(1, Math.max(0, snapshot.layer)),
    durationMs: clampDuration(opts.durationMs ?? DEFAULT_STEP_MS),
  };
  // 混合模式：六层各自独立，抓成 mix（最终值，缺席 = 0），layer/systems 不适用。
  // 隐藏的系统直接不写——mix 语义里"没写"就是 0，muted 状态被自然折叠进去。
  if (snapshot.mixMode) {
    step.layer = 0;
    const mix: Partial<Record<SystemId, number>> = {};
    for (const id of SYSTEM_IDS) {
      const value = snapshot.systemsVisible[id] ? snapshot.systemOpacity[id] : 0;
      if (value > 0.004) mix[id] = Math.round(value * 100) / 100;
    }
    step.mix = mix;
  }
  if (snapshot.selected) {
    step.selected = snapshot.selected;
    // 抓画面这个动作本身就意味着"我要你拍这个"，所以默认给特写
    step.focus = true;
  }
  if (opts.preset) {
    step.preset = opts.preset;
    delete step.focus;
  } else if (opts.from) {
    step.from = opts.from;
  }
  if (snapshot.expanded) step.expand = snapshot.expanded;
  if (snapshot.clip) {
    step.clip = {
      axis: snapshot.clip.axis,
      pos: Math.round(snapshot.clip.pos * 1000) / 1000,
      ...(snapshot.clip.flip ? { flip: true } : {}),
    };
  }
  if (!snapshot.mixMode && Object.keys(systems).length) step.systems = systems;
  if (opts.motion && opts.motion !== 'push') step.motion = opts.motion;
  return step;
}

export function clampDuration(ms: number): number {
  if (!Number.isFinite(ms)) return DEFAULT_STEP_MS;
  return Math.min(MAX_STEP_MS, Math.max(MIN_STEP_MS, Math.round(ms)));
}

/** 新草稿：id 用时间戳，用户可以改。 */
export function emptyDraft(now: number): Wonder {
  return {
    schema: WONDER_SCHEMA,
    id: `my_${now.toString(36)}`,
    title: { zh: '', en: '' },
    steps: [],
  };
}

/**
 * 校验。返回**问题清单**而不是 true/false——用户需要知道差在哪儿，
 * 而不是被一个红叉挡住。
 */
export function validateWonder(wonder: Wonder, forPublish = false): DraftProblem[] {
  const problems: DraftProblem[] = [];
  if (!/^[a-z0-9_]+$/.test(wonder.id)) problems.push({ code: 'idFormat' });
  if (!wonder.title.zh.trim() || !wonder.title.en.trim()) problems.push({ code: 'titleMissing' });
  if (!wonder.steps.length) problems.push({ code: 'noSteps' });
  else if (forPublish && wonder.steps.length < PUBLISH_MIN_STEPS)
    problems.push({ code: 'tooFewSteps' });
  if (forPublish && !wonder.author?.trim()) problems.push({ code: 'authorMissing' });
  wonder.steps.forEach((step, stepIndex) => {
    if (!step.text.zh.trim() || !step.text.en.trim())
      problems.push({ code: 'stepText', stepIndex });
    if (step.durationMs < MIN_STEP_MS || step.durationMs > MAX_STEP_MS)
      problems.push({ code: 'stepDuration', stepIndex });
  });
  return problems;
}

/** 能不能播。比"能不能发布"松：只要有一步、每步有中文文案就行。 */
export function isPlayable(wonder: Wonder): boolean {
  return wonder.steps.length > 0 && wonder.steps.every((s) => s.text.zh.trim().length > 0);
}

/** 编码进 `?w=`。 */
export function encodeWonder(wonder: Wonder): string {
  return toBase64Url(new TextEncoder().encode(JSON.stringify(wonder)));
}

/**
 * 解码 `?w=`。
 *
 * **任何非法输入都返回 null，绝不抛**——分享链接会被聊天软件截断、会被手抄错，
 * 一个坏链接不该让整个页面白屏。同时逐字段收窄类型：这段 JSON 来自地址栏，
 * 是不可信输入，不能 `as Wonder` 了事。
 */
export function decodeWonder(encoded: string | null | undefined): Wonder | null {
  if (!encoded) return null;
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(fromBase64Url(encoded)));
    return sanitizeWonder(parsed);
  } catch {
    return null;
  }
}

function text(value: unknown): { zh: string; en: string } | null {
  if (typeof value !== 'object' || value === null) return null;
  const t = value as { zh?: unknown; en?: unknown };
  if (typeof t.zh !== 'string') return null;
  return { zh: t.zh, en: typeof t.en === 'string' ? t.en : t.zh };
}

const MOTIONS = new Set<string>(['still', 'push', 'pull', 'orbit', 'orbitBack', 'rise', 'sink']);
const PRESETS = new Set<string>(['front', 'back', 'left', 'right', 'top', 'hero']);
const SLUG = /^[a-z0-9_]+$/;

/** 一则奥秘最多这么多步：防止一个恶意/手滑的链接塞进来一万步把浏览器卡死。 */
const MAX_STEPS = 60;

/** 把不可信的 JSON 收窄成 Wonder；任何一处不对就整则作废。 */
export function sanitizeWonder(parsed: unknown): Wonder | null {
  if (typeof parsed !== 'object' || parsed === null) return null;
  const raw = parsed as Record<string, unknown>;
  if (typeof raw.id !== 'string' || !SLUG.test(raw.id)) return null;
  const title = text(raw.title);
  if (!title) return null;
  if (!Array.isArray(raw.steps) || !raw.steps.length || raw.steps.length > MAX_STEPS) return null;

  const steps: WonderStep[] = [];
  for (const item of raw.steps) {
    if (typeof item !== 'object' || item === null) return null;
    const s = item as Record<string, unknown>;
    const stepText = text(s.text);
    if (!stepText) return null;
    const layer = typeof s.layer === 'number' ? Math.min(1, Math.max(0, s.layer)) : 0;
    const step: WonderStep = {
      text: stepText,
      layer,
      durationMs: clampDuration(typeof s.durationMs === 'number' ? s.durationMs : DEFAULT_STEP_MS),
    };
    if (typeof s.selected === 'string' && SLUG.test(s.selected)) step.selected = s.selected;
    if (typeof s.expand === 'string' && SLUG.test(s.expand)) step.expand = s.expand;
    if (s.focus === false) step.focus = false;
    else if (s.focus === true) step.focus = true;
    if (typeof s.preset === 'string' && PRESETS.has(s.preset))
      step.preset = s.preset as ViewPresetId;
    if (typeof s.from === 'string' && PRESETS.has(s.from)) step.from = s.from as ViewPresetId;
    if (typeof s.motion === 'string' && MOTIONS.has(s.motion)) step.motion = s.motion as MotionId;
    if (typeof s.transitionMs === 'number')
      step.transitionMs = Math.min(4000, Math.max(300, Math.round(s.transitionMs)));
    if (typeof s.clip === 'object' && s.clip !== null) {
      const c = s.clip as Record<string, unknown>;
      if (c.axis === 'x' || c.axis === 'y' || c.axis === 'z') {
        step.clip = {
          axis: c.axis,
          pos: Math.min(1, Math.max(-1, Number(c.pos) || 0)),
          ...(c.flip === true ? { flip: true } : {}),
        };
      }
    }
    if (typeof s.systems === 'object' && s.systems !== null) {
      const out: Partial<Record<SystemId, boolean | number>> = {};
      for (const id of SYSTEM_IDS) {
        const value = (s.systems as Record<string, unknown>)[id];
        if (value === false) out[id] = false;
        else if (typeof value === 'number') out[id] = Math.min(1, Math.max(0, value));
      }
      if (Object.keys(out).length) step.systems = out;
    }
    if (typeof s.mix === 'object' && s.mix !== null) {
      const out: Partial<Record<SystemId, number>> = {};
      for (const id of SYSTEM_IDS) {
        const value = (s.mix as Record<string, unknown>)[id];
        if (typeof value === 'number' && Number.isFinite(value))
          out[id] = Math.min(1, Math.max(0, value));
      }
      // mix 允许为空对象吗？空 = 六层全 0 = 黑屏，多半是坏数据——丢掉这个字段，
      // 步骤退回 layer 语义（sanitize 的原则：能救一部分就救一部分）
      if (Object.keys(out).length) step.mix = out;
    }
    steps.push(step);
  }

  const wonder: Wonder = { schema: WONDER_SCHEMA, id: raw.id, title, steps };
  const subtitle = text(raw.subtitle);
  if (subtitle) wonder.subtitle = subtitle;
  if (typeof raw.author === 'string' && raw.author.trim())
    wonder.author = raw.author.trim().slice(0, 40);
  if (typeof raw.system === 'string' && (SYSTEM_IDS as readonly string[]).includes(raw.system))
    wonder.system = raw.system as SystemId;
  return wonder;
}

/** 存草稿。localStorage 满了或被禁用时安静失败——这不值得打断创作。 */
export function saveDraft(wonder: Wonder): void {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(wonder));
  } catch {
    /* 隐私模式 / 配额满 */
  }
}

export function loadDraft(): Wonder | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    return sanitizeWonder(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function clearDraft(): void {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* 同上 */
  }
}

/** 把某一步挪个位置，返回新数组（不改原数组）。越界就原样返回。 */
export function moveStep(steps: WonderStep[], from: number, to: number): WonderStep[] {
  if (from === to || from < 0 || from >= steps.length || to < 0 || to >= steps.length) return steps;
  const next = [...steps];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}
