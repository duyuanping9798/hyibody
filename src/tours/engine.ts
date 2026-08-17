import type { SystemId } from '../data/types';

/**
 * 故事线播放引擎（M2-1，KICKOFF 第 5 节）。
 * 步骤是声明式的（分层值 + 选中结构 + 显隐覆盖），不硬编码相机坐标——
 * 相机由"selected + focus/preset"推导，数据更新后故事线依然成立。
 * 引擎只管状态机与计时，应用到画面由 UI 层监听 'step' 事件完成。
 */
export interface TourStep {
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
  /** 自动播放时本步停留时长 */
  durationMs: number;
}

export interface Tour {
  id: string;
  title: { zh: string; en: string };
  steps: TourStep[];
}

export class TourEngine extends EventTarget {
  private tour: Tour | null = null;
  private index = 0;
  private playing = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  /** 载入并从第一步开始自动播放。 */
  start(tour: Tour): void {
    this.stopTimer();
    this.tour = tour;
    this.index = 0;
    this.playing = true;
    this.dispatchEvent(new CustomEvent('play'));
    this.emitStep();
  }

  stop(): void {
    this.stopTimer();
    this.tour = null;
    this.index = 0;
    this.playing = false;
    this.dispatchEvent(new CustomEvent('end'));
  }

  get currentTour(): Tour | null {
    return this.tour;
  }

  get currentIndex(): number {
    return this.index;
  }

  get currentStep(): TourStep | null {
    return this.tour?.steps[this.index] ?? null;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  play(): void {
    if (!this.tour || this.playing) return;
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
    if (!this.tour) return;
    if (this.index + 1 >= this.tour.steps.length) {
      this.stop();
      return;
    }
    this.index += 1;
    this.emitStep();
  }

  prev(): void {
    if (!this.tour || this.index === 0) return;
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
