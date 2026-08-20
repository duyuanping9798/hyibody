import { describe, expect, it } from 'vitest';
import { canSpeak, pickVoice } from '../../src/wonders/speech';

/** 造一个假音色，只需要 lang 和 name 两个字段。 */
function voice(lang: string, name = lang): SpeechSynthesisVoice {
  return { lang, name } as SpeechSynthesisVoice;
}

describe('语音讲解：挑音色', () => {
  it('优先完全匹配', () => {
    const voices = [voice('en-US'), voice('zh-TW'), voice('zh-CN')];
    expect(pickVoice(voices, 'zh')?.lang).toBe('zh-CN');
  });

  it('没有完全匹配就退到同语种——zh-TW 念中文也比英文音色强', () => {
    const voices = [voice('en-US'), voice('zh-HK')];
    expect(pickVoice(voices, 'zh')?.lang).toBe('zh-HK');
  });

  it('大小写不影响匹配（有的系统报 ZH-CN）', () => {
    expect(pickVoice([voice('ZH-CN')], 'zh')?.lang).toBe('ZH-CN');
  });

  it('一个都不沾边就交给浏览器自己看着办', () => {
    expect(pickVoice([voice('ja-JP'), voice('ko-KR')], 'zh')).toBeNull();
  });

  it('英文别被 en-GB 之外的东西骗走', () => {
    const voices = [voice('zh-CN'), voice('en-GB')];
    expect(pickVoice(voices, 'en')?.lang).toBe('en-GB');
  });

  it('空音色表不炸', () => {
    expect(pickVoice([], 'zh')).toBeNull();
  });
});

describe('语音讲解：能力检测', () => {
  it('没有 speechSynthesis 的环境（比如这里）如实返回 false 且不抛', () => {
    // 这个函数在 store 初始化时被调用，抛了整个应用都起不来
    expect(() => canSpeak()).not.toThrow();
    expect(canSpeak()).toBe(false);
  });
});
