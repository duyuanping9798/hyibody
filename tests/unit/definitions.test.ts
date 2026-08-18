import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  definitionsEn,
  definitionsFor,
  definitionsReviewedFor,
  definitionsZh,
  parseDefinitions,
} from '../../src/data/definitions';

const manifest = JSON.parse(
  readFileSync(resolve(__dirname, '../../public/assets/manifest.json'), 'utf8'),
) as { structures: Record<string, unknown> };

describe('definitions 解析', () => {
  it('跳过 _meta，读出 blurb 与 fact', () => {
    expect(
      parseDefinitions({
        _meta: { reviewed: false },
        heart: { blurb: '心脏文案。', fact: '心脏小知识。' },
        skull: { blurb: '颅骨文案。' },
      }),
    ).toEqual({
      heart: { blurb: '心脏文案。', fact: '心脏小知识。' },
      skull: { blurb: '颅骨文案。' },
    });
  });

  it('缺 blurb、空串、非对象一律丢掉（文件是人手改的）', () => {
    expect(
      parseDefinitions({ a: { fact: '只有小知识' }, b: { blurb: '   ' }, c: 'x', d: null }),
    ).toEqual({});
  });

  it('非对象输入不炸', () => {
    expect(parseDefinitions(null)).toEqual({});
    expect(parseDefinitions('nope')).toEqual({});
  });
});

describe('definitions 内容契约（真实文件 × 真实 manifest）', () => {
  const slugs = Object.keys(manifest.structures);
  // 中英文长度上限不一样：同一句话英文的字符数大约是中文的两倍
  const langs = [
    { lang: 'zh' as const, defs: definitionsZh, blurbMax: 90, blurbMin: 8, factMax: 120 },
    { lang: 'en' as const, defs: definitionsEn, blurbMax: 190, blurbMin: 30, factMax: 240 },
  ];

  for (const { lang, defs, blurbMax, blurbMin, factMax } of langs) {
    describe(lang, () => {
      it('每个结构都有一句话科普', () => {
        const missing = slugs.filter((slug) => !defs[slug]);
        expect(missing, `缺文案：${missing.join(', ')}`).toEqual([]);
      });

      it('没有多余的文案条目（防止 slug 改名后残留）', () => {
        const extra = Object.keys(defs).filter((slug) => !slugs.includes(slug));
        expect(extra, `多余条目：${extra.join(', ')}`).toEqual([]);
      });

      it('blurb 单行、长度适中；fact 存在时同样约束', () => {
        for (const [slug, def] of Object.entries(defs)) {
          expect(def.blurb.includes('\n'), `${slug} blurb 应为单行`).toBe(false);
          expect(def.blurb.length, `${slug} blurb 过长`).toBeLessThanOrEqual(blurbMax);
          expect(def.blurb.length, `${slug} blurb 过短`).toBeGreaterThanOrEqual(blurbMin);
          if (def.fact) {
            expect(def.fact.includes('\n'), `${slug} fact 应为单行`).toBe(false);
            expect(def.fact.length, `${slug} fact 过长`).toBeLessThanOrEqual(factMax);
          }
        }
      });

      it('每个结构都有"你知道吗"小知识', () => {
        const missing = slugs.filter((slug) => !defs[slug]?.fact);
        expect(missing, `缺小知识：${missing.join(', ')}`).toEqual([]);
      });

      it('definitionsFor 取到同一张表', () => {
        expect(definitionsFor(lang)).toBe(defs);
      });
    });
  }

  it('中英文覆盖同一批结构（改名时两边一起报错）', () => {
    expect(Object.keys(definitionsEn).sort()).toEqual(Object.keys(definitionsZh).sort());
  });

  it('英文文案里不留中文字符（防止只翻译了一半）', () => {
    const cjk = /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/;
    const dirty = Object.entries(definitionsEn)
      .filter(([, def]) => cjk.test(def.blurb) || cjk.test(def.fact ?? ''))
      .map(([slug]) => slug);
    expect(dirty, `英文文案含中文：${dirty.join(', ')}`).toEqual([]);
  });

  it('审校标记按语言各记各的', () => {
    expect(typeof definitionsReviewedFor('zh')).toBe('boolean');
    expect(typeof definitionsReviewedFor('en')).toBe('boolean');
  });
});
