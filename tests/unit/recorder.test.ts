import { describe, expect, it } from 'vitest';
import {
  canRecord,
  clauseAlpha,
  layoutClauses,
  MAX_RECORD_MS,
  outputSize,
  titleAlpha,
} from '../../src/wonders/recorder';

describe('录像：输出尺寸', () => {
  it('小于上限就原样输出', () => {
    expect(outputSize(800, 600)).toEqual([800, 600]);
  });

  it('长边封顶，比例不变', () => {
    const [w, h] = outputSize(2560, 1440);
    expect(w).toBe(1280);
    expect(h / w).toBeCloseTo(1440 / 2560, 2);
  });

  it('竖屏一样按长边封顶', () => {
    const [w, h] = outputSize(1170, 2532);
    expect(h).toBe(1280);
    expect(w).toBeLessThan(h);
  });

  it('宽高一律取偶数——编码器不吃奇数', () => {
    for (const [sw, sh] of [
      [1001, 777],
      [403, 869],
      [1367, 911],
    ]) {
      const [w, h] = outputSize(sw!, sh!);
      expect(w % 2, `${sw}x${sh}`).toBe(0);
      expect(h % 2, `${sw}x${sh}`).toBe(0);
    }
  });

  it('再小的画布也不会算出 0（0 尺寸的画布开不了流）', () => {
    const [w, h] = outputSize(1, 1);
    expect(w).toBeGreaterThan(0);
    expect(h).toBeGreaterThan(0);
  });
});

describe('录像：逐句浮现的时间线', () => {
  it('第一句立刻开始浮，最后浮完', () => {
    expect(clauseAlpha(0, 0)).toBe(0);
    expect(clauseAlpha(0, 275)).toBeCloseTo(0.5, 2);
    expect(clauseAlpha(0, 550)).toBe(1);
    expect(clauseAlpha(0, 5000)).toBe(1);
  });

  it('第二句要等第一句起了头才开始', () => {
    expect(clauseAlpha(1, 100)).toBe(0);
    expect(clauseAlpha(1, 190)).toBe(0);
    expect(clauseAlpha(1, 465)).toBeCloseTo(0.5, 2);
  });

  it('不会给出负数或大于 1 的透明度', () => {
    expect(clauseAlpha(3, 0)).toBe(0);
    expect(clauseAlpha(0, 99999)).toBe(1);
  });
});

describe('录像：片头卡的进出场', () => {
  it('淡入 → 停住 → 淡出', () => {
    expect(titleAlpha(0)).toBe(0);
    expect(titleAlpha(250)).toBeCloseTo(0.5, 2);
    expect(titleAlpha(1500)).toBe(1);
    expect(titleAlpha(2600)).toBe(1);
    expect(titleAlpha(2850)).toBeCloseTo(0.5, 2);
    expect(titleAlpha(3100)).toBe(0);
    expect(titleAlpha(9000)).toBe(0);
  });
});

describe('录像：字幕排版', () => {
  // 假的量宽函数：一个字符算 10 个单位，够验证换行逻辑
  const measure = (s: string) => [...s].length * 10;

  it('放得下就都在一行，且记着每一段属于第几句', () => {
    const lines = layoutClauses(measure, ['心跳，', '血液。'], 200);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.parts.map((p) => p.index)).toEqual([0, 1]);
    expect(lines[0]!.width).toBe(60);
  });

  it('放不下就换行，句子不被拆开', () => {
    const lines = layoutClauses(measure, ['心跳每分钟七十次，', '血液绕行全身。'], 100);
    expect(lines).toHaveLength(2);
    expect(lines[0]!.parts).toHaveLength(1);
    expect(lines[1]!.parts).toHaveLength(1);
  });

  it('一句本身就比一行长时按字拆，但拆出来的每段仍记着原来的句序', () => {
    // 一句 12 个字 = 120 宽，一行只有 50 宽，必然要拆成三段
    const lines = layoutClauses(measure, ['一二三四五六七八九十十一'], 50);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(line.width).toBeLessThanOrEqual(50);
      for (const part of line.parts) expect(part.index).toBe(0);
    }
    // 拆完之后一个字都不能少
    expect(lines.flatMap((l) => l.parts.map((p) => p.text)).join('')).toBe(
      '一二三四五六七八九十十一',
    );
  });

  it('空字幕排出空版面，而不是一行空行', () => {
    expect(layoutClauses(measure, [], 300)).toEqual([]);
  });
});

describe('录像：能力检测', () => {
  it('没有 document / MediaRecorder 的环境（比如这里）如实返回 false', () => {
    // 单测跑在 node 里，本来就没有这两样。重点是它**不抛异常**——
    // 这个函数会在 store 初始化时被调用，抛了整个应用都起不来。
    expect(() => canRecord()).not.toThrow();
    expect(canRecord()).toBe(false);
  });
});

describe('录像：时长封顶', () => {
  it('封顶要长过任何一则内置奥秘，又短到撑不爆内存', () => {
    // 最长的内置奥秘约两分钟；自创的可以有 60 步 × 20 秒 = 20 分钟，
    // 而编码分片全攒在内存里，停下来才拼成 Blob
    expect(MAX_RECORD_MS).toBeGreaterThan(3 * 60 * 1000);
    expect(MAX_RECORD_MS).toBeLessThanOrEqual(10 * 60 * 1000);
  });
});
