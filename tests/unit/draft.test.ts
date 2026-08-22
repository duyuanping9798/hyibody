import { describe, expect, it } from 'vitest';
import {
  captureStep,
  clampDuration,
  decodeWonder,
  emptyDraft,
  encodeWonder,
  isPlayable,
  moveStep,
  sanitizeWonder,
  validateWonder,
  type ViewSnapshot,
} from '../../src/wonders/draft';
import type { Wonder } from '../../src/wonders/engine';

const ALL_VISIBLE = {
  skin: true,
  muscles: true,
  skeleton: true,
  organs: true,
  vessels: true,
  nerves: true,
};
const FULL = { skin: 1, muscles: 1, skeleton: 1, organs: 1, vessels: 1, nerves: 1 };

function snapshot(over: Partial<ViewSnapshot> = {}): ViewSnapshot {
  return {
    layer: 0.5,
    selected: null,
    expanded: null,
    clip: null,
    systemsVisible: { ...ALL_VISIBLE },
    systemOpacity: { ...FULL },
    ...over,
  };
}

function wonder(over: Partial<Wonder> = {}): Wonder {
  return {
    id: 'my_test',
    title: { zh: '标题', en: 'Title' },
    steps: [{ text: { zh: '一句话', en: 'A line' }, layer: 0.4, durationMs: 8000 }],
    ...over,
  };
}

describe('UGC：抓一步', () => {
  it('默认状态抓出来的一步很干净——不写六个 true', () => {
    const step = captureStep(snapshot());
    expect(step.systems).toBeUndefined();
    expect(step.selected).toBeUndefined();
    expect(step.clip).toBeUndefined();
    expect(step.layer).toBe(0.5);
  });

  it('只记与默认不同的系统覆盖', () => {
    const step = captureStep(
      snapshot({
        systemsVisible: { ...ALL_VISIBLE, muscles: false },
        systemOpacity: { ...FULL, skeleton: 0.2 },
      }),
    );
    expect(step.systems).toEqual({ muscles: false, skeleton: 0.2 });
  });

  it('选中了结构就默认给特写——抓画面这个动作本身就是「拍这个」', () => {
    const step = captureStep(snapshot({ selected: 'heart' }));
    expect(step.selected).toBe('heart');
    expect(step.focus).toBe(true);
  });

  it('给了 preset（整具人体宽景）就不再要特写，两者互斥', () => {
    const step = captureStep(snapshot({ selected: 'heart' }), { preset: 'front' });
    expect(step.preset).toBe('front');
    expect(step.focus).toBeUndefined();
  });

  it('剖切与展开原样带上，位置取三位小数', () => {
    const step = captureStep(
      snapshot({ expanded: 'heart', clip: { axis: 'y', pos: 0.123456, flip: true } }),
    );
    expect(step.expand).toBe('heart');
    expect(step.clip).toEqual({ axis: 'y', pos: 0.123, flip: true });
  });

  it('运镜是默认的 push 就不写进 JSON', () => {
    expect(captureStep(snapshot(), { motion: 'push' }).motion).toBeUndefined();
    expect(captureStep(snapshot(), { motion: 'orbit' }).motion).toBe('orbit');
  });

  it('时长夹在 schema 允许的范围里', () => {
    expect(captureStep(snapshot(), { durationMs: 100 }).durationMs).toBe(3000);
    expect(captureStep(snapshot(), { durationMs: 999999 }).durationMs).toBe(20000);
    expect(clampDuration(Number.NaN)).toBe(8000);
  });

  it('分层值被夹回 0–1', () => {
    expect(captureStep(snapshot({ layer: 3 })).layer).toBe(1);
    expect(captureStep(snapshot({ layer: -2 })).layer).toBe(0);
  });

  // 2026-08-22 控制条改六个独立推子：混合模式抓出来的一步说的是 mix 语言
  it('混合模式抓成 mix：最终值直录，隐藏折叠成缺席，不再写 layer/systems', () => {
    const step = captureStep(
      snapshot({
        mixMode: true,
        layer: 0.62, // 上次扫描留下的旧值，不该进 JSON
        systemsVisible: { ...ALL_VISIBLE, muscles: false },
        systemOpacity: { ...FULL, skin: 0.256, organs: 0 },
      }),
    );
    expect(step.mix).toEqual({ skin: 0.26, skeleton: 1, vessels: 1, nerves: 1 });
    expect(step.layer).toBe(0);
    expect(step.systems).toBeUndefined();
  });
});

describe('UGC：校验', () => {
  it('齐全的草稿没有问题', () => {
    expect(validateWonder(wonder())).toEqual([]);
  });

  it('id 必须是 slug', () => {
    expect(validateWonder(wonder({ id: 'My Wonder!' }))).toContainEqual({ code: 'idFormat' });
  });

  it('中英标题缺一不可', () => {
    expect(validateWonder(wonder({ title: { zh: '有', en: '  ' } }))).toContainEqual({
      code: 'titleMissing',
    });
  });

  it('一步都没有要报出来', () => {
    expect(validateWonder(wonder({ steps: [] }))).toContainEqual({ code: 'noSteps' });
  });

  it('文案空着的那一步会被点名，而不是笼统说「有问题」', () => {
    const w = wonder({
      steps: [
        { text: { zh: '有', en: 'ok' }, layer: 0, durationMs: 8000 },
        { text: { zh: '', en: '' }, layer: 0, durationMs: 8000 },
      ],
    });
    expect(validateWonder(w)).toContainEqual({ code: 'stepText', stepIndex: 1 });
  });

  it('发布的门槛比播放高：要作者署名、要够四步', () => {
    const w = wonder();
    expect(validateWonder(w, false)).toEqual([]);
    const strict = validateWonder(w, true);
    expect(strict).toContainEqual({ code: 'authorMissing' });
    expect(strict).toContainEqual({ code: 'tooFewSteps' });
  });

  it('能播的门槛只要中文文案——写作时英文往往还没跟上', () => {
    expect(
      isPlayable(wonder({ steps: [{ text: { zh: '有', en: '' }, layer: 0, durationMs: 8000 }] })),
    ).toBe(true);
    expect(isPlayable(wonder({ steps: [] }))).toBe(false);
  });
});

describe('UGC：编码与解码', () => {
  it('编码再解码回得来', () => {
    const original = wonder({ subtitle: { zh: '副', en: 'Sub' }, author: '小杜' });
    const back = decodeWonder(encodeWonder(original));
    expect(back?.id).toBe(original.id);
    expect(back?.title).toEqual(original.title);
    expect(back?.subtitle).toEqual(original.subtitle);
    expect(back?.author).toBe('小杜');
    expect(back?.steps).toHaveLength(1);
  });

  it('中文能安全过一遍 base64（btoa 只吃 latin1，必须先 UTF-8 编码）', () => {
    const w = wonder({ title: { zh: '心跳与血液的旅程', en: 'x' } });
    expect(decodeWonder(encodeWonder(w))?.title.zh).toBe('心跳与血液的旅程');
  });

  it('坏链接返回 null，不抛——聊天软件会截断链接', () => {
    expect(decodeWonder('这不是 base64')).toBeNull();
    expect(decodeWonder(encodeWonder(wonder()).slice(0, 12))).toBeNull();
    expect(decodeWonder('')).toBeNull();
    expect(decodeWonder(null)).toBeNull();
  });

  it('来自地址栏的 JSON 是不可信输入，逐字段收窄', () => {
    expect(sanitizeWonder({ id: 'ok', title: { zh: 'a', en: 'b' }, steps: [] })).toBeNull();
    expect(sanitizeWonder({ id: 'BAD ID', title: { zh: 'a', en: 'b' }, steps: [{}] })).toBeNull();
    expect(sanitizeWonder({ id: 'ok', steps: [{ text: { zh: 'a', en: 'b' } }] })).toBeNull();
  });

  it('认不出的字段被丢掉，而不是原样带进播放器', () => {
    const w = sanitizeWonder({
      id: 'ok',
      title: { zh: 'a', en: 'b' },
      steps: [
        {
          text: { zh: 'a', en: 'b' },
          layer: 0.5,
          motion: 'teleport',
          preset: 'nowhere',
          selected: '../../etc/passwd',
          durationMs: 8000,
        },
      ],
    });
    expect(w?.steps[0]!.motion).toBeUndefined();
    expect(w?.steps[0]!.preset).toBeUndefined();
    expect(w?.steps[0]!.selected).toBeUndefined();
  });

  it('步数有上限——一个塞了一万步的链接不该把浏览器卡死', () => {
    const steps = Array.from({ length: 200 }, () => ({
      text: { zh: 'a', en: 'b' },
      layer: 0,
      durationMs: 8000,
    }));
    expect(sanitizeWonder({ id: 'ok', title: { zh: 'a', en: 'b' }, steps })).toBeNull();
  });

  it('只有中文也收：英文缺省跟中文一样，总比整则作废强', () => {
    const w = sanitizeWonder({
      id: 'ok',
      title: { zh: '标题' },
      steps: [{ text: { zh: '正文' }, layer: 0, durationMs: 8000 }],
    });
    expect(w?.title.en).toBe('标题');
  });

  it('mix 逐键收窄：越界夹回、野键丢掉、空对象整个不要（那等于黑屏）', () => {
    const w = sanitizeWonder({
      id: 'ok',
      title: { zh: 'a', en: 'b' },
      steps: [
        {
          text: { zh: 'a', en: 'b' },
          layer: 0,
          durationMs: 8000,
          mix: { skeleton: 5, bogus: 1, organs: 0.4 },
        },
        { text: { zh: 'a', en: 'b' }, layer: 0.3, durationMs: 8000, mix: { bogus: 1 } },
      ],
    });
    expect(w?.steps[0]!.mix).toEqual({ skeleton: 1, organs: 0.4 });
    expect(w?.steps[1]!.mix).toBeUndefined();
    expect(w?.steps[1]!.layer).toBe(0.3);
  });
});

describe('UGC：步骤排序', () => {
  const steps = [1, 2, 3].map((n) => ({
    text: { zh: `${n}`, en: `${n}` },
    layer: 0,
    durationMs: 8000,
  }));

  it('往前挪', () => {
    expect(moveStep(steps, 2, 0).map((s) => s.text.zh)).toEqual(['3', '1', '2']);
  });

  it('往后挪', () => {
    expect(moveStep(steps, 0, 2).map((s) => s.text.zh)).toEqual(['2', '3', '1']);
  });

  it('越界或原地不动就原样返回，不复制也不炸', () => {
    expect(moveStep(steps, 0, 0)).toBe(steps);
    expect(moveStep(steps, -1, 0)).toBe(steps);
    expect(moveStep(steps, 0, 9)).toBe(steps);
  });

  it('不改原数组', () => {
    const before = steps.map((s) => s.text.zh);
    moveStep(steps, 0, 2);
    expect(steps.map((s) => s.text.zh)).toEqual(before);
  });
});

describe('UGC：新草稿', () => {
  it('id 是合法 slug，且两次不同', () => {
    const a = emptyDraft(1_700_000_000_000);
    expect(a.id).toMatch(/^[a-z0-9_]+$/);
    expect(emptyDraft(1_700_000_000_001).id).not.toBe(a.id);
  });
});
