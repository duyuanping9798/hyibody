import en from '../../content/i18n/en.json';
import zh from '../../content/i18n/zh.json';
import type { Lang } from '../data/types';

/** 界面语言。类型定义在 src/data/types.ts，这里只做转出，避免 ui 与 data 各写一份。 */
export type Locale = Lang;
/** 文案结构以 zh.json 为准；en.json 键集一致性由 tests/unit/i18n.test.ts 保证。 */
export type Strings = typeof zh;

export const STRINGS: Record<Locale, Strings> = { zh, en: en as unknown as Strings };
