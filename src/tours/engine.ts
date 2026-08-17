/**
 * 故事线播放引擎骨架（M2-1 实现，KICKOFF 第 5 节）。
 * 每步 = 相机位姿 + 可见集合 + 高亮 + 文案 + 时长。
 */
export interface TourStep {
  camera: { pos: [number, number, number]; target: [number, number, number] };
  visible: string[];
  highlight?: string;
  text: { zh: string; en: string };
  durationMs: number;
}

export interface Tour {
  id: string;
  title: { zh: string; en: string };
  steps: TourStep[];
}

export type TourEngineEvent = 'step' | 'play' | 'pause' | 'end';

export class TourEngine extends EventTarget {
  private tour: Tour | null = null;
  private index = 0;
  private playing = false;

  loadTour(tour: Tour): void {
    this.tour = tour;
    this.index = 0;
    this.playing = false;
  }

  get currentStep(): TourStep | null {
    return this.tour?.steps[this.index] ?? null;
  }

  play(): void {
    if (!this.tour) return;
    this.playing = true;
    this.dispatchEvent(new CustomEvent('play'));
    this.emitStep();
  }

  pause(): void {
    this.playing = false;
    this.dispatchEvent(new CustomEvent('pause'));
  }

  next(): void {
    if (!this.tour) return;
    if (this.index + 1 >= this.tour.steps.length) {
      this.playing = false;
      this.dispatchEvent(new CustomEvent('end'));
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

  get isPlaying(): boolean {
    return this.playing;
  }

  private emitStep(): void {
    this.dispatchEvent(
      new CustomEvent('step', { detail: { index: this.index, step: this.currentStep } }),
    );
  }
}
