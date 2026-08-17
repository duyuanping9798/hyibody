import { useState } from 'react';
import zh from '../../content/i18n/zh.json';
import { searchStructures } from '../data/search';
import { useUiStore } from './store';

/** 搜索框：中英文子串匹配，点选后选中并聚焦（KICKOFF 第 6 节）。 */
export function SearchBox() {
  const manifest = useUiStore((s) => s.manifest);
  const select = useUiStore((s) => s.select);
  const focus = useUiStore((s) => s.focus);
  const [query, setQuery] = useState('');

  if (!manifest) return null;
  const hits = query.trim() ? searchStructures(manifest, query) : [];

  return (
    <div className="hyi-panel hyi-search">
      <input
        type="search"
        value={query}
        placeholder={zh.searchPlaceholder}
        aria-label={zh.searchPlaceholder}
        onChange={(e) => setQuery(e.target.value)}
      />
      {query.trim() !== '' && (
        <div className="hyi-search-results" data-testid="search-results">
          {hits.length === 0 && <div className="hyi-search-empty">{zh.searchNoResult}</div>}
          {hits.map((hit) => (
            <button
              key={hit.slug}
              onClick={() => {
                select(hit.slug);
                focus(hit.slug);
                setQuery('');
              }}
            >
              <span>{hit.zh}</span>
              <span className="en">{hit.en}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
