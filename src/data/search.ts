import type { Manifest, SystemId } from './types';

export interface SearchHit {
  slug: string;
  zh: string;
  en: string;
  system: SystemId | 'placeholder';
}

/** 中英文子串搜索（KICKOFF 第 6 节）：大小写不敏感，中文命中优先。 */
export function searchStructures(manifest: Manifest, query: string, limit = 12): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const zhHits: SearchHit[] = [];
  const enHits: SearchHit[] = [];
  for (const [slug, info] of Object.entries(manifest.structures)) {
    const hit: SearchHit = { slug, zh: info.zh, en: info.en, system: info.system };
    if (info.zh.toLowerCase().includes(q)) zhHits.push(hit);
    else if (info.en.toLowerCase().includes(q) || slug.includes(q)) enHits.push(hit);
    if (zhHits.length >= limit) break;
  }
  return [...zhHits, ...enHits].slice(0, limit);
}
