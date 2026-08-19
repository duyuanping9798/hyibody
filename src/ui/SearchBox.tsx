import { STRINGS } from './i18n';
import { useEffect, useRef, useState } from 'react';
import { searchStructures } from '../data/search';
import { useUiStore } from './store';

/**
 * 搜索框：中英文子串匹配，点选或回车后选中并聚焦（KICKOFF 第 6 节）。
 * 键盘可用：`/` 展开并聚焦到这里，↑↓ 在结果里走，回车选中，Esc 收起。
 *
 * 默认收起成顶栏上的一个放大镜（界面减负）：一个空搜索框常年占着左上角
 * 三百像素，实际上大部分时间没人用。
 */
export function SearchBox() {
  const lang = useUiStore((s) => s.lang);
  const t = STRINGS[lang];
  const manifest = useUiStore((s) => s.manifest);
  const select = useUiStore((s) => s.select);
  const focus = useUiStore((s) => s.focus);
  const setSearchOpen = useUiStore((s) => s.setSearchOpen);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const hits = manifest && query.trim() ? searchStructures(manifest, query) : [];

  // 结果变了就把光标收回第一条，免得停在已经不存在的行上
  useEffect(() => setCursor(0), [query]);
  useEffect(() => {
    listRef.current?.children[cursor]?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);
  // 展开即聚焦，省得再点一下
  useEffect(() => inputRef.current?.focus(), []);

  if (!manifest) return null;

  function choose(slug: string) {
    select(slug);
    focus(slug);
    setQuery('');
    setSearchOpen(false);
  }

  return (
    <div className="hyi-panel hyi-search">
      <input
        ref={inputRef}
        type="search"
        value={query}
        placeholder={t.searchPlaceholder}
        aria-label={t.searchPlaceholder}
        role="combobox"
        aria-expanded={hits.length > 0}
        aria-controls="hyi-search-results"
        aria-activedescendant={hits[cursor] ? `hyi-hit-${hits[cursor].slug}` : undefined}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            // 先清空 / 收起搜索框，别一路冒泡到全局 Esc 把选中也清了
            e.stopPropagation();
            if (query !== '') setQuery('');
            else setSearchOpen(false);
            return;
          }
          if (hits.length === 0) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setCursor((c) => (c + 1) % hits.length);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setCursor((c) => (c - 1 + hits.length) % hits.length);
          } else if (e.key === 'Enter') {
            e.preventDefault();
            const hit = hits[cursor];
            if (hit) choose(hit.slug);
          }
        }}
      />
      {query.trim() !== '' && (
        <div
          className="hyi-search-results"
          data-testid="search-results"
          id="hyi-search-results"
          role="listbox"
          ref={listRef}
        >
          {hits.length === 0 && <div className="hyi-search-empty">{t.searchNoResult}</div>}
          {hits.map((hit, i) => (
            <button
              key={hit.slug}
              id={`hyi-hit-${hit.slug}`}
              role="option"
              aria-selected={i === cursor}
              className={i === cursor ? 'active' : undefined}
              onMouseEnter={() => setCursor(i)}
              onClick={() => choose(hit.slug)}
            >
              <span>{lang === 'zh' ? hit.zh : hit.en}</span>
              <span className="en">{lang === 'zh' ? hit.en : hit.zh}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
