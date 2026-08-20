import { useRef, useState } from 'react';
import { STRINGS } from './i18n';
import { useUiStore } from './store';
import { MOTION_IDS, type MotionId } from '../viewer/cinematic';
import {
  encodeWonder,
  isPlayable,
  sanitizeWonder,
  validateWonder,
  type DraftProblem,
} from '../wonders/draft';
import type { Wonder } from '../wonders/engine';

/** 分享链接超过这个长度就别劝人用链接了——微信/短信会截断。 */
const MAX_SHARE_URL = 7000;

function problemText(problem: DraftProblem, t: (typeof STRINGS)['zh']): string {
  const template = t.editor.problems[problem.code];
  return problem.stepIndex === undefined
    ? template
    : template.replace('{n}', String(problem.stepIndex + 1));
}

/** 顶栏上的「创作」入口。播放中不出现——那会儿屏幕归内容。 */
export function EditorButton() {
  const t = STRINGS[useUiStore((s) => s.lang)];
  const openEditor = useUiStore((s) => s.openEditor);
  const draft = useUiStore((s) => s.draft);
  const wonder = useUiStore((s) => s.wonder);
  if (draft || wonder) return null;
  return (
    <button className="hyi-btn" data-testid="editor-open" onClick={openEditor}>
      {t.editor.open}
    </button>
  );
}

function StepEditor({ index }: { index: number }) {
  const lang = useUiStore((s) => s.lang);
  const t = STRINGS[lang];
  const draft = useUiStore((s) => s.draft);
  const patchStep = useUiStore((s) => s.patchStep);
  const captureCurrentStep = useUiStore((s) => s.captureCurrentStep);
  const removeStep = useUiStore((s) => s.removeStep);
  const nudgeStep = useUiStore((s) => s.nudgeStep);
  const setDraftStep = useUiStore((s) => s.setDraftStep);
  const step = draft?.steps[index];
  if (!draft || !step) return null;

  return (
    <div className="step-editor" data-testid="step-editor">
      <label>
        <span>{t.editor.stepTextZh}</span>
        <textarea
          rows={3}
          value={step.text.zh}
          onChange={(e) => patchStep(index, { text: { ...step.text, zh: e.target.value } })}
        />
      </label>
      <label>
        <span>{t.editor.stepTextEn}</span>
        <textarea
          rows={2}
          value={step.text.en}
          onChange={(e) => patchStep(index, { text: { ...step.text, en: e.target.value } })}
        />
      </label>
      <label className="row">
        <span>
          {t.editor.stepDuration.replace('{n}', String(Math.round(step.durationMs / 1000)))}
        </span>
        <input
          type="range"
          min={3}
          max={20}
          step={1}
          value={Math.round(step.durationMs / 1000)}
          onChange={(e) => patchStep(index, { durationMs: Number(e.target.value) * 1000 })}
        />
      </label>
      <label className="row">
        <span>{t.editor.stepMotion}</span>
        <select
          value={step.motion ?? 'push'}
          onChange={(e) => patchStep(index, { motion: e.target.value as MotionId })}
        >
          {MOTION_IDS.map((id) => (
            <option key={id} value={id}>
              {t.editor.motions[id]}
            </option>
          ))}
        </select>
      </label>
      <div className="acts">
        <button
          className="hyi-btn"
          onClick={() => {
            // 「用当前画面替换这一步」= 抓一步新的、丢掉旧的，位置不变
            const text = step.text;
            const motion = step.motion;
            captureCurrentStep({
              text,
              durationMs: step.durationMs,
              ...(motion ? { motion } : {}),
            });
            const state = useUiStore.getState();
            const last = state.draft!.steps.length - 1;
            state.nudgeStep(last, index - last);
            state.removeStep(index + 1);
            state.setDraftStep(index);
          }}
        >
          {t.editor.recapture}
        </button>
        <button className="hyi-btn" disabled={index === 0} onClick={() => nudgeStep(index, -1)}>
          {t.editor.up}
        </button>
        <button
          className="hyi-btn"
          disabled={index >= draft.steps.length - 1}
          onClick={() => nudgeStep(index, 1)}
        >
          {t.editor.down}
        </button>
        <button className="hyi-btn" onClick={() => removeStep(index)}>
          {t.editor.remove}
        </button>
        <button className="hyi-btn" onClick={() => setDraftStep(null)}>
          {t.editor.done}
        </button>
      </div>
    </div>
  );
}

/**
 * 创作面板。
 *
 * 核心是一个动作：**把当前画面加成一步**。用户不需要理解 layer / systems / clip
 * 这些字段名，只要把画面调成他想讲的样子，按一下按钮。字段是抓出来的，不是填出来的。
 */
export function WonderEditor() {
  const lang = useUiStore((s) => s.lang);
  const t = STRINGS[lang];
  const draft = useUiStore((s) => s.draft);
  const draftStep = useUiStore((s) => s.draftStep);
  const closeEditor = useUiStore((s) => s.closeEditor);
  const newDraft = useUiStore((s) => s.newDraft);
  const patchDraft = useUiStore((s) => s.patchDraft);
  const captureCurrentStep = useUiStore((s) => s.captureCurrentStep);
  const setDraftStep = useUiStore((s) => s.setDraftStep);
  const startWonder = useUiStore((s) => s.startWonder);
  const loadWonderIntoDraft = useUiStore((s) => s.loadWonderIntoDraft);
  const [basicsOpen, setBasicsOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  if (!draft) return null;
  const problems = validateWonder(draft);
  const playable = isPlayable(draft);

  const share = () => {
    const url = new URL(window.location.href);
    url.search = '';
    url.searchParams.set('w', encodeWonder(draft));
    const text = url.toString();
    if (text.length > MAX_SHARE_URL) {
      setNotice(t.editor.shareTooLong);
      return;
    }
    void navigator.clipboard?.writeText(text).then(() => setNotice(t.editor.shareCopied));
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(draft, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${draft.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importJson = (file: File) => {
    void file.text().then((raw) => {
      let parsed: Wonder | null = null;
      try {
        parsed = sanitizeWonder(JSON.parse(raw));
      } catch {
        parsed = null;
      }
      if (!parsed) {
        setNotice(t.editor.importFailed);
        return;
      }
      loadWonderIntoDraft(parsed);
      setNotice(null);
    });
  };

  return (
    <aside className="hyi-panel hyi-editor" data-testid="wonder-editor">
      <header>
        <strong>{t.editor.title}</strong>
        <div>
          <button className="hyi-btn hyi-btn-tiny" onClick={newDraft}>
            {t.editor.newDraft}
          </button>
          <button className="hyi-btn hyi-btn-tiny" onClick={closeEditor}>
            {t.editor.close}
          </button>
        </div>
      </header>

      <button className="disclose" onClick={() => setBasicsOpen(!basicsOpen)}>
        {t.editor.basics}
        <span>{basicsOpen ? '▾' : '▸'}</span>
      </button>
      {basicsOpen && (
        <div className="basics">
          <label>
            <span>{t.editor.fieldTitleZh}</span>
            <input
              value={draft.title.zh}
              onChange={(e) => patchDraft({ title: { ...draft.title, zh: e.target.value } })}
            />
          </label>
          <label>
            <span>{t.editor.fieldTitleEn}</span>
            <input
              value={draft.title.en}
              onChange={(e) => patchDraft({ title: { ...draft.title, en: e.target.value } })}
            />
          </label>
          <label>
            <span>{t.editor.fieldSubtitleZh}</span>
            <input
              value={draft.subtitle?.zh ?? ''}
              onChange={(e) =>
                patchDraft({
                  subtitle: { zh: e.target.value, en: draft.subtitle?.en ?? '' },
                })
              }
            />
          </label>
          <label>
            <span>{t.editor.fieldSubtitleEn}</span>
            <input
              value={draft.subtitle?.en ?? ''}
              onChange={(e) =>
                patchDraft({
                  subtitle: { zh: draft.subtitle?.zh ?? '', en: e.target.value },
                })
              }
            />
          </label>
          <label>
            <span>{t.editor.fieldAuthor}</span>
            <input
              value={draft.author ?? ''}
              maxLength={40}
              onChange={(e) => patchDraft({ author: e.target.value })}
            />
          </label>
        </div>
      )}

      <h4>{`${t.editor.steps} · ${draft.steps.length}`}</h4>
      {!draft.steps.length && <p className="empty">{t.editor.noSteps}</p>}
      <ol className="steps">
        {draft.steps.map((step, i) => (
          <li key={i} className={i === draftStep ? 'open' : ''}>
            <button className="row" onClick={() => setDraftStep(i === draftStep ? null : i)}>
              <b>{i + 1}</b>
              <span className="line">{step.text[lang] || step.text.zh || '…'}</span>
              <span className="dur">{Math.round(step.durationMs / 1000)}s</span>
            </button>
            {i === draftStep && <StepEditor index={i} />}
          </li>
        ))}
      </ol>

      <button className="hyi-btn hyi-btn-warm capture" onClick={() => captureCurrentStep()}>
        {t.editor.capture}
      </button>

      {problems.length > 0 && (
        <ul className="problems">
          {problems.map((problem, i) => (
            <li key={i}>{problemText(problem, t)}</li>
          ))}
        </ul>
      )}
      {notice && <p className="notice">{notice}</p>}

      <div className="acts">
        <button
          className="hyi-btn"
          disabled={!playable}
          title={playable ? undefined : t.editor.emptyPreview}
          onClick={() => startWonder(draft)}
        >
          {t.editor.preview}
        </button>
        <button className="hyi-btn" disabled={!playable} onClick={share}>
          {t.editor.shareLink}
        </button>
        <button className="hyi-btn" onClick={exportJson}>
          {t.editor.exportJson}
        </button>
        <button className="hyi-btn" onClick={() => fileRef.current?.click()}>
          {t.editor.importJson}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) importJson(file);
            e.target.value = '';
          }}
        />
      </div>
      <p className="licence">{t.editor.licence}</p>
    </aside>
  );
}
