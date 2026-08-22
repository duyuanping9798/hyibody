import { describe, expect, it } from 'vitest';
import { decodeUrlState, DEFAULT_URL_STATE, encodeUrlState } from '../../src/data/urlState';
import type { ViewerUrlState } from '../../src/data/urlState';

describe('urlState', () => {
  it('round-trips a full state', () => {
    const state: ViewerUrlState = {
      layer: 0.56,
      systems: { skin: false, organs: true },
      clip: { axis: 'x', pos: 0.3 },
      cam: { pos: [0, -2600, 900], target: [0, 0, 0] },
      selected: 'heart',
      lang: 'zh',
      kiosk: true,
    };
    expect(decodeUrlState(encodeUrlState(state))).toEqual(state);
  });

  it('produces URL-safe output', () => {
    const encoded = encodeUrlState({ layer: 0.9, selected: '心脏/heart?&=' });
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('falls back to defaults on garbage input', () => {
    expect(decodeUrlState('!!!not-base64!!!')).toEqual(DEFAULT_URL_STATE);
    expect(decodeUrlState('')).toEqual(DEFAULT_URL_STATE);
    expect(decodeUrlState(null)).toEqual(DEFAULT_URL_STATE);
  });

  it('clamps out-of-range numbers', () => {
    const decoded = decodeUrlState(
      encodeUrlState({ layer: 7, clip: { axis: 'z', pos: -5 } } as ViewerUrlState),
    );
    expect(decoded.layer).toBe(1);
    expect(decoded.clip).toEqual({ axis: 'z', pos: -1 });
  });

  // 2026-08-22 控制条改六个独立推子之后，混合模式的链接带 mix（缺席的系统 = 0）
  it('mix 往返保真，越界与野键被清洗', () => {
    const state: ViewerUrlState = { layer: 0, mix: { skeleton: 1, organs: 0.35 } };
    expect(decodeUrlState(encodeUrlState(state))).toEqual(state);

    // 全黑画面编码成 { skin: 0 }（显式 0 键），解码端不能把它丢掉
    const black: ViewerUrlState = { layer: 0, mix: { skin: 0 } };
    expect(decodeUrlState(encodeUrlState(black))).toEqual(black);

    const dirty = decodeUrlState(
      encodeUrlState({
        layer: 0,
        mix: { skeleton: 7, bogus: 0.5, organs: 'x' } as unknown,
      } as ViewerUrlState),
    );
    expect(dirty.mix).toEqual({ skeleton: 1 });
    // 全是野键时干脆不给 mix 字段，免得下游拿到一个空对象当"六层全关"
    const empty = decodeUrlState(
      encodeUrlState({ layer: 0.4, mix: { bogus: 1 } as unknown } as ViewerUrlState),
    );
    expect(empty.mix).toBeUndefined();
    expect(empty.layer).toBeCloseTo(0.4);
  });
});
