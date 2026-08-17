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
});
