import { STRINGS } from './i18n';
import { useUiStore } from './store';

/**
 * 「关于」弹层（2026-08-22 顶栏收拢）：项目简介 + 语言切换 + 数据来源署名
 * 收进同一个 ℹ 图标。署名文本以 manifest.attribution 为准（docs/ATTRIBUTION.md），
 * 这是 CC BY 4.0 的义务，不能只放在角落里可有可无。
 */
export function AboutDialog({ onOpenHelp }: { onOpenHelp(): void }) {
  const lang = useUiStore((s) => s.lang);
  const t = STRINGS[lang];
  const setLang = useUiStore((s) => s.setLang);
  const open = useUiStore((s) => s.aboutOpen);
  const manifest = useUiStore((s) => s.manifest);
  const setOpen = useUiStore((s) => s.setAboutOpen);

  if (!open || !manifest) return null;
  return (
    <div className="hyi-attribution-backdrop" onClick={() => setOpen(false)}>
      <div
        className="hyi-panel hyi-about"
        role="dialog"
        aria-modal="true"
        aria-label={t.aboutTitle}
        data-testid="about-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <h2>{t.brand}</h2>
        <p className="hyi-about-sub">{t.subtitle}</p>
        <p className="hyi-about-intro">{t.aboutIntro}</p>

        <div className="hyi-about-row">
          <span>{t.languageLabel}</span>
          <button
            className="hyi-btn"
            aria-label="切换语言 / Switch language"
            onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}
          >
            {lang === 'zh' ? 'EN' : '中文'}
          </button>
        </div>

        <h3>{t.attribution}</h3>
        {manifest.attribution.map((line) => (
          <p key={line}>{line}</p>
        ))}
        <p>
          <a
            href="https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html"
            target="_blank"
            rel="noreferrer"
            style={{ color: 'var(--hyi-accent)' }}
          >
            BodyParts3D License (CC BY 4.0)
          </a>
        </p>
        <p className="hyi-info-disclaimer">{t.infoDisclaimer}</p>

        <div className="hyi-about-actions">
          <button
            className="hyi-btn"
            onClick={() => {
              setOpen(false);
              onOpenHelp();
            }}
          >
            {t.helpTitle}
          </button>
          {/* autoFocus：aria-modal 把对话框以外的内容对读屏隐藏了，焦点必须
              跟着进来，否则读屏用户"站在不存在的地方"（同 ShortcutHelp 的做法） */}
          <button className="hyi-btn" onClick={() => setOpen(false)} autoFocus>
            {t.close}
          </button>
        </div>
      </div>
    </div>
  );
}
