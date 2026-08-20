import { STRINGS } from './i18n';
import { useEffect, useRef, useState } from 'react';
import { searchStructures } from '../data/search';
import { SearchIcon } from './Icon';
import { useUiStore } from './store';

/**
 * 搜索框：中英文子串匹配，点选或回车后选中并聚焦（KICKOFF 第 6 节）。
 * 键盘可用：`/` 展开并聚焦到这里，↑↓ 在结果里走，回车选中，Esc 收起。
 *
 * 常驻显示：桌面端在左上角，手机上是顶栏下面一整条。
 *
 * 曾经收起成顶栏上的一个放大镜（"界面减负"），理由是空搜索框常年占着左上角
 * 三百像素。2026-08-20 用户要求改回来——收起省下的那点空间，代价是最常用的
 * 入口没人找得到，尤其在手机上：一个放大镜图标看不出是搜索还是别的什么。
 * 发现率优先于省空间。
 */
export function SearchBox() {
  const lang = useUiStore((s) => s.lang);
  const t = STRINGS[lang];
  const manifest = useUiStore((s) => s.manifest);
  const select = useUiStore((s) => s.select);
  const focus = useUiStore((s) => s.focus);
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

  if (!manifest) return null;

  function choose(slug: string) {
    select(slug);
    focus(slug);
    setQuery('');
    // 搜索框不再收起，所以选完把焦点交还给画布，接着按 Esc / 方向键才是操作三维
    inputRef.current?.blur();
  }

  return (
    <div className="hyi-panel hyi-search">
      <span className="hyi-search-icon" aria-hidden>
        <SearchIcon />
      </span>
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
            // 先清空、再交还焦点，别一路冒泡到全局 Esc 把选中也清了
            e.stopPropagation();
            if (query !== '') setQuery('');
            else inputRef.current?.blur();
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
