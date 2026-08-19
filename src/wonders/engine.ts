import type { SystemId } from '../data/types';

/**
 * 奥秘播放引擎（M2-1，KICKOFF 第 5 节）。
 * 步骤是声明式的（分层值 + 选中结构 + 显隐覆盖），不硬编码相机坐标——
 * 相机由"selected + focus/preset"推导，数据更新后奥秘依然成立。
 * 引擎只管状态机与计时，应用到画面由 UI 层监听 'step' 事件完成。
 */
export interface WonderStep {
  text: { zh: string; en: string };
  /** 分层滑块 0–1 */
  layer: number;
  /** 选中并高亮的结构 slug */
  selected?: string;
  /** 相机拉近框住选中结构（默认 true，有 selected 时生效） */
  focus?: boolean;
  /** 预设视角（与 focus 互斥，优先生效） */
  preset?: 'front' | 'back' | 'left' | 'right' | 'top' | 'hero';
  /** 显隐覆盖：未列出的系统一律可见 */
  systems?: Partial<Record<SystemId, boolean>>;
  /** 展开某个结构的内部件（心脏 → 心室壁/瓣膜…）；不给则收起 */
  expand?: string;
  /** 剖切面；不给则关闭剖切 */
  clip?: { axis: 'x' | 'y' | 'z'; pos: number; flip?: boolean };
  /** 自动播放时本步停留时长 */
  durationMs: number;
}

export interface Wonder {
  id: string;
  title: { zh: string; en: string };
  /** 主系统：菜单按系统分组用，上百条时平铺列表不可用 */
  system?: SystemId;
  /**
   * 这条奥秘讲到哪些结构。用来建反向索引——点开一个结构时列出讲到它的几条奥秘。
   * 不写则由步骤里的 selected / expand 自动推导（见 wondersForStructure）。
   */
  structures?: string[];
  steps: WonderStep[];
}

/** 一条奥秘涉及的全部结构：显式声明优先，否则从步骤里推导。 */
export function structuresOf(wonder: Wonder): string[] {
  if (wonder.structures?.length) return [...new Set(wonder.structures)];
  const out = new Set<string>();
  for (const step of wonder.steps) {
    if (step.selected) out.add(step.selected);
    if (step.expand) out.add(step.expand);
  }
  return [...out];
}

/** 自动播放时这条奥秘一共多长（秒），菜单上显示时长用。 */
export function estimatedSeconds(wonder: Wonder): number {
  return Math.round(wonder.steps.reduce((sum, s) => sum + s.durationMs, 0) / 1000);
}

export class WonderEngine extends EventTarget {
  private wonder: Wonder | null = null;
  private index = 0;
  private playing = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  /** 载入并从第一步开始自动播放。 */
  start(wonder: Wonder): void {
    this.stopTimer();
    this.wonder = wonder;
    this.index = 0;
    this.playing = true;
    this.dispatchEvent(new CustomEvent('play'));
    this.emitStep();
  }

  stop(): void {
    this.stopTimer();
    this.wonder = null;
    this.index = 0;
    this.playing = false;
    this.dispatchEvent(new CustomEvent('end'));
  }

  get currentWonder(): Wonder | null {
    return this.wonder;
  }

  get currentIndex(): number {
    return this.index;
  }

  get currentStep(): WonderStep | null {
    return this.wonder?.steps[this.index] ?? null;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  play(): void {
    if (!this.wonder || this.playing) return;
    this.playing = true;
    this.dispatchEvent(new CustomEvent('play'));
    this.scheduleAdvance();
  }

  pause(): void {
    this.stopTimer();
    if (!this.playing) return;
    this.playing = false;
    this.dispatchEvent(new CustomEvent('pause'));
  }

  next(): void {
    if (!this.wonder) return;
    if (this.index + 1 >= this.wonder.steps.length) {
      this.stop();
      return;
    }
    this.index += 1;
    this.emitStep();
  }

  prev(): void {
    if (!this.wonder || this.index === 0) return;
    this.index -= 1;
    this.emitStep();
  }

  private emitStep(): void {
    this.stopTimer();
    this.dispatchEvent(
      new CustomEvent('step', { detail: { index: this.index, step: this.currentStep } }),
    );
    if (this.playing) this.scheduleAdvance();
  }

  private scheduleAdvance(): void {
    const step = this.currentStep;
    if (!step) return;
    this.stopTimer();
    this.timer = setTimeout(() => this.next(), step.durationMs);
  }

  private stopTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
