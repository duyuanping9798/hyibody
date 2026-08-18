import { describe, expect, it } from 'vitest';
import { LAYER_STEP, isTypingTarget, resolveShortcut } from '../../src/ui/keyboard';

const idle = { tourActive: false, typing: false };
const tour = { tourActive: true, typing: false };
const typing = { tourActive: false, typing: true };

describe('resolveShortcut', () => {
  it('带修饰键的一律放行给浏览器', () => {
    expect(resolveShortcut({ key: '/', ctrlKey: true }, idle)).toEqual({ kind: 'none' });
    expect(resolveShortcut({ key: 'f', metaKey: true }, idle)).toEqual({ kind: 'none' });
    expect(resolveShortcut({ key: '1', altKey: true }, idle)).toEqual({ kind: 'none' });
  });

  it('打字时只认 Esc', () => {
    expect(resolveShortcut({ key: 'Escape' }, typing)).toEqual({ kind: 'escape' });
    expect(resolveShortcut({ key: '/' }, typing)).toEqual({ kind: 'none' });
    expect(resolveShortcut({ key: '1' }, typing)).toEqual({ kind: 'none' });
    expect(resolveShortcut({ key: ' ' }, { tourActive: true, typing: true })).toEqual({
      kind: 'none',
    });
  });

  it('搜索与说明页', () => {
    expect(resolveShortcut({ key: '/' }, idle)).toEqual({ kind: 'focusSearch' });
    expect(resolveShortcut({ key: '?' }, idle)).toEqual({ kind: 'toggleHelp' });
  });

  it('[ ] 调透视深度', () => {
    expect(resolveShortcut({ key: '[' }, idle)).toEqual({ kind: 'layer', delta: -LAYER_STEP });
    expect(resolveShortcut({ key: ']' }, idle)).toEqual({ kind: 'layer', delta: LAYER_STEP });
  });

  it('1–6 对应六个系统，7 及以上不接管', () => {
    expect(resolveShortcut({ key: '1' }, idle)).toEqual({ kind: 'toggleSystem', index: 0 });
    expect(resolveShortcut({ key: '6' }, idle)).toEqual({ kind: 'toggleSystem', index: 5 });
    expect(resolveShortcut({ key: '7' }, idle)).toEqual({ kind: 'none' });
  });

  it('0 返回全身，F 聚焦选中', () => {
    expect(resolveShortcut({ key: '0' }, idle)).toEqual({ kind: 'backToBody' });
    expect(resolveShortcut({ key: 'f' }, idle)).toEqual({ kind: 'focusSelected' });
    expect(resolveShortcut({ key: 'F' }, idle)).toEqual({ kind: 'focusSelected' });
  });

  it('方向键与空格只在故事线里生效，平时留给轨道控制器', () => {
    expect(resolveShortcut({ key: 'ArrowLeft' }, idle)).toEqual({ kind: 'none' });
    expect(resolveShortcut({ key: 'ArrowRight' }, idle)).toEqual({ kind: 'none' });
    expect(resolveShortcut({ key: ' ' }, idle)).toEqual({ kind: 'none' });
    expect(resolveShortcut({ key: 'ArrowLeft' }, tour)).toEqual({ kind: 'tour', step: 'prev' });
    expect(resolveShortcut({ key: 'ArrowRight' }, tour)).toEqual({ kind: 'tour', step: 'next' });
    expect(resolveShortcut({ key: ' ' }, tour)).toEqual({ kind: 'tour', step: 'toggle' });
  });

  it('没绑的键不动', () => {
    expect(resolveShortcut({ key: 'q' }, idle)).toEqual({ kind: 'none' });
    expect(resolveShortcut({ key: 'Tab' }, idle)).toEqual({ kind: 'none' });
  });
});

describe('isTypingTarget', () => {
  it('输入框、文本域、下拉、可编辑区都算在打字', () => {
    for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) {
      expect(isTypingTarget({ tagName } as unknown as EventTarget)).toBe(true);
    }
    expect(
      isTypingTarget({ tagName: 'DIV', isContentEditable: true } as unknown as EventTarget),
    ).toBe(true);
  });

  it('普通元素和 null 不算', () => {
    expect(isTypingTarget({ tagName: 'DIV' } as unknown as EventTarget)).toBe(false);
    expect(isTypingTarget({} as unknown as EventTarget)).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});
