import en from '../../content/i18n/en.json';
import zh from '../../content/i18n/zh.json';

export type Locale = 'zh' | 'en';
/** 文案结构以 zh.json 为准；en.json 键集一致性由 tests/unit/i18n.test.ts 保证。 */
export type Strings = typeof zh;

export const STRINGS: Record<Locale, Strings> = { zh, en: en as unknown as Strings };
