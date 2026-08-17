import definitionsRaw from '../../content/definitions/zh.md?raw';

/** 解析 content/definitions/zh.md（`## slug` 分节）→ slug → 一句话科普。 */
export function parseDefinitions(md: string): Record<string, string> {
  const map: Record<string, string> = {};
  for (const section of md.split(/^## /m).slice(1)) {
    const newline = section.indexOf('\n');
    if (newline < 0) continue;
    const slug = section.slice(0, newline).trim();
    const text = section.slice(newline + 1).trim();
    if (slug && text) map[slug] = text;
  }
  return map;
}

/** 中文一句话科普（AI 初稿，人类在 md 里校对）。 */
export const definitionsZh: Record<string, string> = parseDefinitions(definitionsRaw);
