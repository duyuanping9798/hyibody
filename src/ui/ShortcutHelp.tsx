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
  { keys: ['←', '→'], key: 'tourStep' },
  { keys: ['Space'], key: 'tourToggle' },
  { keys: ['Esc'], key: 'escape' },
];

/** 键盘快捷键说明。`?` 打开，Esc 或点背景关闭（无障碍：所有功能都有键盘入口）。 */
export function ShortcutHelp({ onClose }: { onClose: () => void }) {
  const t = STRINGS[useUiStore((s) => s.lang)];
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
        <button className="hyi-btn" onClick={onClose} autoFocus>
          {t.close}
        </button>
      </div>
    </div>
  );
}
