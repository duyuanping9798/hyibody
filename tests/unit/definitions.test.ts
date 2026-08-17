import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseDefinitions } from '../../src/data/definitions';

const realMd = readFileSync(resolve(__dirname, '../../content/definitions/zh.md'), 'utf8');
const manifest = JSON.parse(
  readFileSync(resolve(__dirname, '../../public/assets/manifest.json'), 'utf8'),
) as { structures: Record<string, unknown> };

describe('definitions 解析', () => {
  it('按 ## slug 分节解析', () => {
    const map = parseDefinitions(
      '# 标题\n\n说明\n\n## heart\n\n心脏文案。\n\n## skull\n\n颅骨文案。\n',
    );
    expect(map).toEqual({ heart: '心脏文案。', skull: '颅骨文案。' });
  });

  it('空节与缺正文跳过', () => {
    expect(parseDefinitions('## a\n\n## b\n\n有内容\n')).toEqual({ b: '有内容' });
  });
});

describe('definitions 内容契约（真实文件 × 真实 manifest）', () => {
  const map = parseDefinitions(realMd);
  const slugs = Object.keys(manifest.structures);

  it('每个结构都有一句话科普', () => {
    const missing = slugs.filter((slug) => !map[slug]);
    expect(missing, `缺文案：${missing.join(', ')}`).toEqual([]);
  });

  it('没有多余的文案条目（防止 slug 改名后残留）', () => {
    const extra = Object.keys(map).filter((slug) => !slugs.includes(slug));
    expect(extra, `多余条目：${extra.join(', ')}`).toEqual([]);
  });

  it('文案为单行且长度适中（信息卡显示）', () => {
    for (const [slug, text] of Object.entries(map)) {
      expect(text.includes('\n'), `${slug} 应为单行`).toBe(false);
      expect(text.length, `${slug} 过长`).toBeLessThanOrEqual(80);
      expect(text.length, `${slug} 过短`).toBeGreaterThanOrEqual(8);
    }
  });
});
