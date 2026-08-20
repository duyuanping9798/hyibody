/**
 * 字幕断句。
 *
 * 中文没有空格，"逐词浮现"无从谈起，所以按标点断成短句、一句一句地浮上来——
 * 这正是科普视频里字幕的节奏。英文同一套规则也成立。
 *
 * 不用 `split` 加零宽后行断言：Safari 16.4 之前不支持，而那是 iPhone 上还在
 * 服役的版本。手写一个字符循环，行为在哪儿都一样。
 */
/** 中文标点一律断句：中文数字里不会出现它们。 */
const CJK_BREAKS = '，。；、！？';
/**
 * 西文标点只在后面是空格或结尾时才断。
 * 否则「100,000 times」会在千分位逗号处劈成两半、「3.5 秒」会劈成「3.」和「5 秒」
 * （两处都是单测抓出来的）。
 */
const ASCII_BREAKS = ',;.!?';

/** 短到这个字数以内的碎句（"是的，"）不单独占一拍，并进前一句。 */
const MIN_CLAUSE = 3;

export function splitClauses(text: string): string[] {
  const chars = [...text];
  const out: string[] = [];
  let buf = '';
  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i]!;
    buf += ch;
    const next = chars[i + 1];
    const isBreak =
      CJK_BREAKS.includes(ch) ||
      (ASCII_BREAKS.includes(ch) && (next === undefined || next === ' '));
    if (isBreak) {
      const trimmed = buf.trim();
      if (trimmed) out.push(trimmed);
      buf = '';
    }
  }
  const tail = buf.trim();
  if (tail) out.push(tail);
  if (!out.length) return [text];

  const merged: string[] = [];
  // 碎句往前并；如果它就是第一句（"对，"），前面没得并，就攒着并进下一句
  let carry = '';
  for (const part of out) {
    const piece = `${carry}${part}`;
    carry = '';
    if ([...piece].length > MIN_CLAUSE) {
      merged.push(piece);
    } else if (merged.length) {
      merged[merged.length - 1] = `${merged[merged.length - 1]!}${piece}`;
    } else {
      carry = piece;
    }
  }
  if (carry) merged.push(carry);
  return merged;
}
