/**
 * 把一则奥秘录成视频。
 *
 * 关键决定：**在离屏 canvas 上重画字幕，而不是想办法把 DOM 录进去**。
 * 浏览器没有"录制这块 DOM"这种能力（html2canvas 之类是逐帧重排，30 fps 下不可能），
 * 而 `canvas.captureStream()` 只认一块画布。所以流程是：
 *
 *   three.js 画布 ──drawImage──▶ 合成画布 ──captureStream──▶ MediaRecorder ──▶ WebM/MP4
 *                                   ▲
 *                              字幕/片头/进度/署名（这里用 canvas 2D 重画一遍）
 *
 * 附带好处：界面上的控制条、抽屉、信息卡**天然不会进视频**——它们从来没被画进
 * 合成画布。不用在录制时藏来藏去。
 *
 * 另一个坑：不开 `preserveDrawingBuffer` 时，WebGL 画布的内容在合成之后就没了，
 * 隔一个任务再 drawImage 会拿到黑帧。所以合成必须发生在**渲染循环内、画完的那一刻**
 * ——由 HyiViewer 的 frame tap 在 render() 之后同步调用（见 setFrameTap）。
 */

/** 输出长边上限。再大对手机分享没有意义，编码还会掉帧。 */
const MAX_EDGE = 1280;

/**
 * 录制时长硬上限。
 *
 * 编码出来的分片全部攒在内存里，停下来才拼成一个 Blob。内置奥秘最长两分钟，
 * 但自创奥秘可以有 60 步 × 20 秒 = 20 分钟——按码率算就是几百 MB 堆在手机内存里。
 * 五分钟封顶：够长到没人正常撞得到，又短到撞到了也不至于把页面撑爆。
 */
export const MAX_RECORD_MS = 5 * 60 * 1000;

/**
 * 码率。这类画面（大片平滑渐变、没有胶片颗粒）很好压，
 * 3.5 Mbps 的 720p 已经看不出压缩痕迹，而两分钟的成品也就 50 MB 上下——
 * 分享得出去比"更清楚一点"重要。
 */
const DEFAULT_BITRATE = 3_500_000;

/** 候选封装格式，按偏好排。Safari 只认 mp4，Chrome/Firefox 走 webm。 */
const MIME_CANDIDATES = [
  'video/mp4;codecs=avc1.42E01E',
  'video/mp4',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
];

export interface RecorderTitle {
  title: string;
  subtitle?: string;
  by?: string;
  kicker: string;
}

export interface RecorderChapter {
  index: number;
  total: number;
  /** 本步已经走了多久（毫秒），用来画那一格进度 */
  elapsedMs: number;
  durationMs: number;
}

/** 每一帧问一次"现在该画什么字"。由 UI 提供，录制器不认识 store。 */
export interface RecorderOverlay {
  /** 已断好句的字幕；空数组表示这一帧不画字幕 */
  clauses: string[];
  /** 本步开始到现在的毫秒数，用来做逐句浮现 */
  stepElapsedMs: number;
  title?: RecorderTitle;
  /** 片头卡自己的计时（从奥秘开播算起），跟步骤计时是两回事 */
  titleElapsedMs?: number;
  chapter?: RecorderChapter;
  /** 角标署名。CC BY 要求署名，导出的视频也在其列——这行不是装饰。 */
  credit: string;
}

export interface RecorderResult {
  blob: Blob;
  /** 'mp4' | 'webm'，用来给下载文件起名 */
  ext: string;
  durationMs: number;
}

/** 逐句浮现：每句间隔与单句淡入时长（跟 CSS 里的字幕动画对齐）。 */
const CLAUSE_STAGGER_MS = 190;
const CLAUSE_FADE_MS = 550;
/** 片头卡停留时长，跟 WonderStage 的 TITLE_MS 对齐。 */
const TITLE_MS = 2600;

export function pickMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const mime of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return null;
}

/** 这台设备/这个浏览器能不能录。不能就别把按钮摆出来骗人。 */
export function canRecord(): boolean {
  if (typeof document === 'undefined') return false;
  const canvas = document.createElement('canvas');
  return typeof canvas.captureStream === 'function' && pickMimeType() !== null;
}

/** 合成画布的尺寸：保持来源比例，长边封顶，且宽高都取偶数（编码器的老规矩）。 */
export function outputSize(srcW: number, srcH: number, maxEdge = MAX_EDGE): [number, number] {
  const scale = Math.min(1, maxEdge / Math.max(srcW, srcH));
  const even = (n: number) => Math.max(2, Math.round((n * scale) / 2) * 2);
  return [even(srcW), even(srcH)];
}

/**
 * 一句字幕在某一时刻的不透明度。
 * 第 i 句在 i × 190 ms 时开始浮现，550 ms 浮完。
 */
export function clauseAlpha(index: number, elapsedMs: number): number {
  const t = (elapsedMs - index * CLAUSE_STAGGER_MS) / CLAUSE_FADE_MS;
  return Math.min(1, Math.max(0, t));
}

/** 片头卡的整体不透明度：进场 500 ms 淡入，退场 500 ms 淡出。 */
export function titleAlpha(elapsedMs: number): number {
  if (elapsedMs < 0) return 0;
  if (elapsedMs < 500) return elapsedMs / 500;
  if (elapsedMs > TITLE_MS) return Math.max(0, 1 - (elapsedMs - TITLE_MS) / 500);
  return 1;
}

export interface Line {
  /** 这一行里的每一句：文字 + 在句序里的编号（编号决定它什么时候浮现） */
  parts: { text: string; index: number }[];
  width: number;
}

/**
 * 按宽度把断好句的字幕排成若干行。整句放不下时按字拆——中文一行放不下一句是常事。
 * 返回的每一段都记着它的**句序号**，因为逐句浮现要按句子而不是按行来算时间。
 */
export function layoutClauses(
  measure: (text: string) => number,
  clauses: string[],
  maxWidth: number,
): Line[] {
  const lines: Line[] = [];
  let cur: Line = { parts: [], width: 0 };
  const pushLine = () => {
    if (cur.parts.length) lines.push(cur);
    cur = { parts: [], width: 0 };
  };
  clauses.forEach((clause, index) => {
    let rest = clause;
    while (rest) {
      const w = measure(rest);
      if (cur.width + w <= maxWidth || !cur.parts.length) {
        // 整句能放下（或者本行还空着，硬塞也得塞）
        if (cur.width + w <= maxWidth) {
          cur.parts.push({ text: rest, index });
          cur.width += w;
          rest = '';
          break;
        }
        // 本行空着但一句还是太长：逐字切到放不下为止
        const chars = [...rest];
        let take = 0;
        let width = 0;
        while (take < chars.length) {
          const next = width + measure(chars[take]!);
          if (next > maxWidth && take > 0) break;
          width = next;
          take += 1;
        }
        cur.parts.push({ text: chars.slice(0, take).join(''), index });
        cur.width += width;
        rest = chars.slice(take).join('');
        pushLine();
      } else {
        pushLine();
      }
    }
  });
  pushLine();
  return lines;
}

export interface RecorderOptions {
  /** 每秒多少帧。云端软件渲染下 30 是空谈，真机上 30 刚好。 */
  fps?: number;
  /** 视频码率（bit/s）。720p 的解剖画面 6 Mbps 够清楚了。 */
  bitsPerSecond?: number;
  maxEdge?: number;
}

const FONT_STACK = '"Noto Sans SC", -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';

export class WonderRecorder {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private getOverlay: (() => RecorderOverlay) | null = null;
  private startedAt = 0;
  private mime = '';

  get recording(): boolean {
    return this.recorder?.state === 'recording';
  }

  /** 录制开始以来的毫秒数（UI 拿去显示计时）。 */
  get elapsedMs(): number {
    return this.recording ? performance.now() - this.startedAt : 0;
  }

  start(source: HTMLCanvasElement, getOverlay: () => RecorderOverlay, opts: RecorderOptions = {}) {
    if (this.recording) return;
    const mime = pickMimeType();
    if (!mime) throw new Error('MediaRecorder unavailable');
    this.mime = mime;

    const [w, h] = outputSize(source.width, source.height, opts.maxEdge ?? MAX_EDGE);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('2d context unavailable');

    this.canvas = canvas;
    this.ctx = ctx;
    this.getOverlay = getOverlay;
    this.chunks = [];

    const fps = opts.fps ?? 30;
    const stream = canvas.captureStream(fps);
    const recorder = new MediaRecorder(stream, {
      mimeType: mime,
      videoBitsPerSecond: opts.bitsPerSecond ?? DEFAULT_BITRATE,
    });
    recorder.ondataavailable = (e) => {
      if (e.data.size) this.chunks.push(e.data);
    };
    this.recorder = recorder;
    this.startedAt = performance.now();
    recorder.start(1000);
  }

  /**
   * 抓一帧。必须在 three.js 渲染完的**同一个任务**里调——
   * 没开 preserveDrawingBuffer 时，隔一帧再来就只剩黑屏。
   */
  captureFrame(source: HTMLCanvasElement): void {
    const ctx = this.ctx;
    const canvas = this.canvas;
    if (!ctx || !canvas || !this.recording) return;
    const { width: w, height: h } = canvas;
    ctx.drawImage(source, 0, 0, w, h);
    const overlay = this.getOverlay?.();
    if (overlay) this.drawOverlay(ctx, w, h, overlay);
  }

  async stop(): Promise<RecorderResult> {
    const recorder = this.recorder;
    if (!recorder) throw new Error('not recording');
    const durationMs = performance.now() - this.startedAt;
    const blob = await new Promise<Blob>((resolve) => {
      recorder.onstop = () => resolve(new Blob(this.chunks, { type: this.mime }));
      recorder.stop();
    });
    this.recorder = null;
    this.canvas = null;
    this.ctx = null;
    this.getOverlay = null;
    return { blob, ext: this.mime.startsWith('video/mp4') ? 'mp4' : 'webm', durationMs };
  }

  /** 中途放弃：不产出文件，只把资源放掉。 */
  cancel(): void {
    if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
    this.recorder = null;
    this.canvas = null;
    this.ctx = null;
    this.getOverlay = null;
    this.chunks = [];
  }

  private drawOverlay(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    overlay: RecorderOverlay,
  ): void {
    ctx.save();
    ctx.textBaseline = 'alphabetic';

    // 上下黑边：和界面上的一样浅，作用是把注意力收到中间那条横带上
    const bar = Math.round(h * 0.032);
    for (const top of [true, false]) {
      const grad = ctx.createLinearGradient(0, top ? 0 : h, 0, top ? bar : h - bar);
      grad.addColorStop(0, 'rgba(2,4,9,0.92)');
      grad.addColorStop(1, 'rgba(2,4,9,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, top ? 0 : h - bar, w, bar);
    }

    const pad = Math.round(w * 0.06);
    const maxWidth = w - pad * 2;

    // 先排版再定位：进度条要压在**第一行字幕之上**。
    // 原来两者各自按画面比例算 y，两行字幕时就撞在一起（录出来的样片里，
    // 橙色刻度正好穿过第一行字）——版面必须由内容驱动，不能各算各的。
    const size = Math.max(15, Math.round(h * 0.031));
    const lineH = Math.round(size * 1.75);
    // 字幕底边压在画面下方 13% 处，跟界面上的 .hyi-cinema-caption 对齐
    const baseY = Math.round(h * 0.87);
    let firstLineY = baseY;
    let lines: Line[] = [];
    if (overlay.clauses.length) {
      ctx.font = `500 ${size}px ${FONT_STACK}`;
      lines = layoutClauses((s) => ctx.measureText(s).width, overlay.clauses, maxWidth);
      firstLineY = baseY - (lines.length - 1) * lineH;
    }

    if (overlay.chapter) {
      this.drawChapters(ctx, w, firstLineY - Math.round(size * 1.9), overlay.chapter);
    }

    if (lines.length) {
      ctx.font = `500 ${size}px ${FONT_STACK}`;
      let y = firstLineY;
      for (const line of lines) {
        let x = (w - line.width) / 2;
        for (const part of line.parts) {
          const alpha = clauseAlpha(part.index, overlay.stepElapsedMs);
          if (alpha > 0) {
            // 深色描边而不是半透明底板：底板会切出一个方框，把画面剁成两截
            ctx.globalAlpha = alpha;
            ctx.lineWidth = Math.max(3, size * 0.24);
            ctx.strokeStyle = 'rgba(0,0,0,0.92)';
            ctx.lineJoin = 'round';
            ctx.strokeText(part.text, x, y);
            ctx.fillStyle = '#eef4ff';
            ctx.fillText(part.text, x, y);
          }
          x += ctx.measureText(part.text).width;
        }
        y += lineH;
      }
      ctx.globalAlpha = 1;
    }

    if (overlay.title) {
      const alpha = titleAlpha(overlay.titleElapsedMs ?? 0);
      if (alpha > 0) this.drawTitle(ctx, w, h, overlay.title, alpha, maxWidth);
    }

    // 署名角标。CC BY 的要求，不是水印癖好——视频离开这个网页之后，
    // 它就是唯一还挂在数据上的出处。
    const creditSize = Math.max(10, Math.round(h * 0.017));
    ctx.font = `400 ${creditSize}px ${FONT_STACK}`;
    ctx.globalAlpha = 0.72;
    ctx.fillStyle = '#eef4ff';
    ctx.textAlign = 'right';
    ctx.fillText(overlay.credit, w - pad / 2, h - Math.round(h * 0.022));
    ctx.textAlign = 'left';
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  private drawChapters(
    ctx: CanvasRenderingContext2D,
    w: number,
    y: number,
    chapter: RecorderChapter,
  ): void {
    const total = Math.max(1, chapter.total);
    const gap = Math.round(w * 0.004);
    const cellW = Math.min(Math.round(w * 0.032), Math.round((w * 0.5 - gap * total) / total));
    const barW = cellW * total + gap * (total - 1);
    const cellH = Math.max(2, Math.round(w * 0.0025));
    let x = (w - barW) / 2;
    for (let i = 0; i < total; i += 1) {
      ctx.fillStyle = 'rgba(238,244,255,0.16)';
      ctx.fillRect(x, y, cellW, cellH);
      if (i < chapter.index) {
        ctx.fillStyle = 'rgba(240,160,70,0.55)';
        ctx.fillRect(x, y, cellW, cellH);
      } else if (i === chapter.index) {
        const k = Math.min(1, chapter.elapsedMs / Math.max(1, chapter.durationMs));
        ctx.fillStyle = '#f0a046';
        ctx.fillRect(x, y, cellW * k, cellH);
      }
      x += cellW + gap;
    }
  }

  private drawTitle(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    title: RecorderTitle,
    alpha: number,
    maxWidth: number,
  ): void {
    ctx.globalAlpha = alpha;
    ctx.textAlign = 'center';
    const cx = w / 2;
    let y = Math.round(h * 0.38);

    const kickerSize = Math.max(10, Math.round(h * 0.018));
    ctx.font = `500 ${kickerSize}px ${FONT_STACK}`;
    ctx.fillStyle = '#f0a046';
    ctx.fillText(title.kicker, cx, y);

    const titleSize = Math.max(22, Math.round(h * 0.062));
    ctx.font = `700 ${titleSize}px ${FONT_STACK}`;
    y += Math.round(titleSize * 1.35);
    ctx.lineWidth = Math.max(4, titleSize * 0.16);
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.lineJoin = 'round';
    ctx.strokeText(title.title, cx, y, maxWidth);
    ctx.fillStyle = '#eef4ff';
    ctx.fillText(title.title, cx, y, maxWidth);

    if (title.subtitle) {
      const subSize = Math.max(13, Math.round(h * 0.026));
      ctx.font = `400 ${subSize}px ${FONT_STACK}`;
      y += Math.round(subSize * 2);
      ctx.fillStyle = 'rgba(238,244,255,0.85)';
      ctx.fillText(title.subtitle, cx, y, maxWidth);
    }
    if (title.by) {
      const bySize = Math.max(11, Math.round(h * 0.02));
      ctx.font = `400 ${bySize}px ${FONT_STACK}`;
      y += Math.round(bySize * 2);
      ctx.fillStyle = 'rgba(238,244,255,0.6)';
      ctx.fillText(title.by, cx, y, maxWidth);
    }
    ctx.textAlign = 'left';
    ctx.globalAlpha = 1;
  }
}
