import { describe, expect, it } from 'vitest';
import {
  canToggleHighQuality,
  defaultQuality,
  QUALITY_CAPS,
  type QualityEnv,
} from '../../src/viewer/quality';

const desktop: QualityEnv = {
  softwareRenderer: false,
  coarsePointer: false,
  viewportWidth: 1440,
  cores: 8,
};

describe('quality: 画质档位选择', () => {
  it('软件渲染一律退到 low（云端 CI / 无 GPU 机器）', () => {
    expect(defaultQuality({ ...desktop, softwareRenderer: true })).toBe('low');
    // 即使是大屏多核，软件渲染也不给上后处理
    expect(
      defaultQuality({
        softwareRenderer: true,
        coarsePointer: false,
        viewportWidth: 2560,
        cores: 16,
      }),
    ).toBe('low');
  });

  it('触摸屏 / 窄屏 / 低核数默认 medium（高画质默认关）', () => {
    expect(defaultQuality({ ...desktop, coarsePointer: true })).toBe('medium');
    expect(defaultQuality({ ...desktop, viewportWidth: 390 })).toBe('medium');
    expect(defaultQuality({ ...desktop, cores: 4 })).toBe('medium');
  });

  it('桌面默认 high', () => {
    expect(defaultQuality(desktop)).toBe('high');
  });

  it('low 是硬件兜底，不给用户切', () => {
    expect(canToggleHighQuality('low')).toBe(false);
    expect(canToggleHighQuality('medium')).toBe(true);
    expect(canToggleHighQuality('high')).toBe(true);
  });

  it('档位能力表逐级包含', () => {
    expect(QUALITY_CAPS.low.postprocessing).toBe(false);
    expect(
      QUALITY_CAPS.medium.outline && QUALITY_CAPS.medium.bloom && QUALITY_CAPS.medium.smaa,
    ).toBe(true);
    expect(QUALITY_CAPS.medium.ssao || QUALITY_CAPS.medium.softShadows).toBe(false);
    expect(QUALITY_CAPS.high.ssao && QUALITY_CAPS.high.softShadows).toBe(true);
  });
});
