/**
 * 语音讲解：用浏览器自带的语音合成把每一步的文案念出来。
 *
 * 为什么不接云端 TTS：KICKOFF 的非目标里写着"不做后端与账号系统"，而所有听得过去
 * 的云端语音都要密钥、要计费、要一个替用户保管密钥的服务端。`speechSynthesis`
 * 是浏览器内置的，零依赖、零成本、离线可用（系统自带音色），也不把用户的浏览记录
 * 送到第三方去。代价是音色由系统决定，Windows 上的中文音色明显不如手机。
 *
 * **导出的视频里没有这条音轨**：语音合成不走 WebAudio 图，`captureStream` 抓不到
 * 它的输出。这是浏览器的限制，不是没做——界面上直说了这一点。
 */

export type SpeechLang = 'zh' | 'en';

const BCP47: Record<SpeechLang, string> = { zh: 'zh-CN', en: 'en-US' };

export function canSpeak(): boolean {
  return typeof window !== 'undefined' && typeof window.speechSynthesis !== 'undefined';
}

/**
 * 挑一个音色。优先完全匹配（zh-CN），其次同语种（zh-TW 也比英文强），
 * 都没有就交给浏览器自己看着办。
 */
export function pickVoice(
  voices: readonly SpeechSynthesisVoice[],
  lang: SpeechLang,
): SpeechSynthesisVoice | null {
  const want = BCP47[lang].toLowerCase();
  const prefix = `${lang.toLowerCase()}-`;
  const exact = voices.find((v) => v.lang.toLowerCase() === want);
  if (exact) return exact;
  const sameLanguage = voices.find((v) => v.lang.toLowerCase().startsWith(prefix));
  return sameLanguage ?? null;
}

/** 语速。默认的 1.0 念科普偏快，0.92 更像解说。 */
const RATE = 0.92;

export class WonderNarrator {
  private voices: SpeechSynthesisVoice[] = [];
  private ready = false;

  constructor() {
    if (!canSpeak()) return;
    const load = () => {
      this.voices = window.speechSynthesis.getVoices();
      this.ready = this.voices.length > 0;
    };
    load();
    // Chrome 第一次 getVoices() 往往是空的，音色列表异步到位
    if (!this.ready) window.speechSynthesis.addEventListener('voiceschanged', load, { once: true });
  }

  /**
   * 念一句。会先掐掉上一句——奥秘一步一句，上一句还没念完就该让位了，
   * 排队会让语音越落越远，最后念的和画面上看的对不上。
   */
  speak(text: string, lang: SpeechLang): void {
    if (!canSpeak() || !text) return;
    const synth = window.speechSynthesis;
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = BCP47[lang];
    utterance.rate = RATE;
    const voice = pickVoice(this.voices.length ? this.voices : synth.getVoices(), lang);
    if (voice) utterance.voice = voice;
    synth.speak(utterance);
  }

  pause(): void {
    if (canSpeak()) window.speechSynthesis.pause();
  }

  resume(): void {
    if (canSpeak()) window.speechSynthesis.resume();
  }

  stop(): void {
    if (canSpeak()) window.speechSynthesis.cancel();
  }
}
