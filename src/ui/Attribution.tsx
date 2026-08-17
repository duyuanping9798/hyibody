import { STRINGS } from './i18n';
import { useUiStore } from './store';

/** 署名页：manifest.attribution + 许可证要点（KICKOFF 第 6 节；文本以 docs/ATTRIBUTION.md 为准）。 */
export function Attribution() {
  const t = STRINGS[useUiStore((s) => s.lang)];
  const open = useUiStore((s) => s.attributionOpen);
  const manifest = useUiStore((s) => s.manifest);
  const setOpen = useUiStore((s) => s.setAttributionOpen);

  if (!open || !manifest) return null;
  return (
    <div className="hyi-attribution-backdrop" onClick={() => setOpen(false)}>
      <div className="hyi-panel hyi-attribution" onClick={(e) => e.stopPropagation()}>
        <h2>{t.attribution}</h2>
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
        <button className="hyi-btn" onClick={() => setOpen(false)}>
          {t.close}
        </button>
      </div>
    </div>
  );
}
