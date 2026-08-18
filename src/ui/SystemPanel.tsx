import { STRINGS } from './i18n';
import { SYSTEM_IDS, type SystemId } from '../data/types';
import { SYSTEM_COLORS } from '../viewer/materials';
import { useUiStore } from './store';

function colorHex(system: SystemId): string {
  return `#${SYSTEM_COLORS[system].toString(16).padStart(6, '0')}`;
}

/** 系统面板：显隐开关 + 每系统透明度（KICKOFF 第 6 节"手动锁定某系统显隐与透明度"）。 */
export function SystemPanel() {
  const t = STRINGS[useUiStore((s) => s.lang)];
  const systemsVisible = useUiStore((s) => s.systemsVisible);
  const systemOpacity = useUiStore((s) => s.systemOpacity);
  const loadedSystems = useUiStore((s) => s.loadedSystems);
  const toggleSystem = useUiStore((s) => s.toggleSystem);
  const setSystemOpacity = useUiStore((s) => s.setSystemOpacity);

  return (
    <section>
      <h3>{t.systemsTitle}</h3>
      {SYSTEM_IDS.map((id) => {
        const loaded = loadedSystems.includes(id);
        return (
          <div className="hyi-system-row" key={id}>
            <span className="hyi-system-dot" style={{ background: colorHex(id) }} />
            <span>{t.systems[id]}</span>
            {!loaded && <span style={{ fontSize: 10, opacity: 0.5 }}>{t.systemLoading}</span>}
            <input
              className="hyi-range"
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={systemOpacity[id]}
              aria-label={`${t.systems[id]} 透明度`}
              onChange={(e) => setSystemOpacity(id, Number(e.target.value))}
            />
            <button
              className="hyi-eye"
              aria-pressed={systemsVisible[id]}
              aria-label={`${t.systems[id]} 显示/隐藏`}
              onClick={() => toggleSystem(id)}
            >
              {systemsVisible[id] ? '👁' : '🚫'}
            </button>
          </div>
        );
      })}
    </section>
  );
}
