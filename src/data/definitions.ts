import raw from '../../content/definitions/zh.json';

/** 一条结构的科普文案：blurb = 信息卡正文一句话，fact = "你知道吗"小知识。 */
export interface Definition {
  blurb: string;
  fact?: string;
}

interface DefinitionsFile {
  _meta?: { reviewed?: boolean; note?: string; generatedAt?: string };
  [slug: string]: unknown;
}

/**
 * 解析 `content/definitions/zh.json`：跳过 `_meta`，丢掉缺 blurb 的残缺条目。
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

/** 中文科普文案（AI 初稿，人类在 json 里校对；校对完把 `_meta.reviewed` 改 true）。 */
export const definitionsZh: Record<string, Definition> = parseDefinitions(raw);

/** 文案是否已经过人工审校——未审校时信息卡上标一个提示。 */
export const definitionsReviewed: boolean = (raw as DefinitionsFile)._meta?.reviewed === true;
