import { STRINGS } from './i18n';
import { useUiStore } from './store';

type ShortcutKey = keyof (typeof STRINGS)['zh']['shortcuts'];

/** 一行：左边按键，右边说明。 */
const ROWS: { keys: string[]; key: ShortcutKey }[] = [
  { keys: ['/'], key: 'search' },
  { keys: ['?'], key: 'help' },
  { keys: ['[', ']'], key: 'layer' },
  { keys: ['1', '–', '6'], key: 'systems' },
  { keys: ['F'], key: 'focusSelected' },
  { keys: ['0'], key: 'backToBody' },
  { keys: ['←', '→'], key: 'wonderStep' },
  { keys: ['Space'], key: 'wonderToggle' },
  { keys: ['Esc'], key: 'escape' },
];

/**
 * 帮助面板：键盘快捷键 + 画质开关。`?` 打开，Esc 或点背景关闭。
 *
 * 画质原来常驻在右侧面板里，可它一年也调不了两次，还占三行——挪进来，
 * 主界面就少一块（界面减负，见 Dock.tsx）。
 */
export function ShortcutHelp({ onClose }: { onClose: () => void }) {
  const t = STRINGS[useUiStore((s) => s.lang)];
  const quality = useUiStore((s) => s.quality);
  const qualityToggleable = useUiStore((s) => s.qualityToggleable);
  const setQuality = useUiStore((s) => s.setQuality);
  return (
    <div className="hyi-attribution-backdrop" onClick={onClose}>
      <div
        className="hyi-panel hyi-shortcuts"
        role="dialog"
        aria-modal="true"
        aria-label={t.shortcutsTitle}
        data-testid="shortcut-help"
        onClick={(e) => e.stopPropagation()}
      >
        <h2>{t.shortcutsTitle}</h2>
        <dl>
          {ROWS.map((row) => (
            <div key={row.key}>
              <dt>
                {row.keys.map((k) => (k === '–' ? <span key={k}>–</span> : <kbd key={k}>{k}</kbd>))}
              </dt>
              <dd>{t.shortcuts[row.key]}</dd>
            </div>
          ))}
        </dl>
        <h3>{t.qualityTitle}</h3>
        {qualityToggleable ? (
          <>
            <label className="hyi-switch">
              <input
                type="checkbox"
                checked={quality === 'high'}
                onChange={(e) => setQuality(e.target.checked ? 'high' : 'medium')}
              />
              <span>{t.qualityHigh}</span>
            </label>
            <p className="hyi-hint">{t.qualityHint}</p>
          </>
        ) : (
          <p className="hyi-hint">{t.qualityUnavailable}</p>
        )}
        <button className="hyi-btn" onClick={onClose} autoFocus>
          {t.close}
        </button>
      </div>
    </div>
  );
}
