import rawEn from '../../content/definitions/en.json';
import rawZh from '../../content/definitions/zh.json';
import type { Lang } from './types';

/** 一条结构的科普文案：blurb = 信息卡正文一句话，fact = "你知道吗"小知识。 */
export interface Definition {
  blurb: string;
  fact?: string;
}

interface DefinitionsFile {
  _meta?: { reviewed?: boolean; aiReviewed?: boolean; note?: string; generatedAt?: string };
  [slug: string]: unknown;
}

/**
 * 文案走到了哪一步。
 *
 * 拆成三档而不是一个布尔，是因为原来那个 `reviewed` 只有真假两种说法，
 * 而实际状态有三种：刚出稿、AI 交叉审校完、真人医学审校完。用一个布尔去表达，
 * 要么把「AI 审过」说成没审（低估），要么把它说成「已医学审校」——后者是在
 * 陈述一件没有发生的事。第三位审核者点名了这一点，这里照办。
 */
export type ReviewStage = 'draft' | 'ai' | 'human';

function stageOf(file: unknown): ReviewStage {
  const meta = (file as DefinitionsFile)?._meta;
  if (meta?.reviewed === true) return 'human';
  if (meta?.aiReviewed === true) return 'ai';
  return 'draft';
}

/**
 * 解析 `content/definitions/{zh,en}.json`：跳过 `_meta`，丢掉缺 blurb 的残缺条目。
 * 文件是人可编辑的（AI 出稿、人类校对，KICKOFF 第 10 节），所以这里不假设结构完整。
 */
export function parseDefinitions(file: unknown): Record<string, Definition> {
  const out: Record<string, Definition> = {};
  if (!file || typeof file !== 'object') return out;
  for (const [slug, value] of Object.entries(file as DefinitionsFile)) {
    if (slug.startsWith('_') || !value || typeof value !== 'object') continue;
    const entry = value as { blurb?: unknown; fact?: unknown };
    if (typeof entry.blurb !== 'string' || !entry.blurb.trim()) continue;
    out[slug] =
      typeof entry.fact === 'string' && entry.fact.trim()
        ? { blurb: entry.blurb.trim(), fact: entry.fact.trim() }
        : { blurb: entry.blurb.trim() };
  }
  return out;
}

/** 中文科普文案（AI 出稿、AI 交叉审校；真人医学审校完成后把 `_meta.reviewed` 改 true）。 */
export const definitionsZh: Record<string, Definition> = parseDefinitions(rawZh);

/** 英文科普文案，与中文一一对应（契约单测把关）。 */
export const definitionsEn: Record<string, Definition> = parseDefinitions(rawEn);

const BY_LANG: Record<Lang, Record<string, Definition>> = { zh: definitionsZh, en: definitionsEn };
const STAGE: Record<Lang, ReviewStage> = { zh: stageOf(rawZh), en: stageOf(rawEn) };

/** 按界面语言取文案表。 */
export function definitionsFor(lang: Lang): Record<string, Definition> {
  return BY_LANG[lang];
}

/** 该语言的文案走到了哪一步——信息卡按这个标注来源可信度。 */
export function reviewStageFor(lang: Lang): ReviewStage {
  return STAGE[lang];
}
