/**
 * The languages pixelbg speaks, each by its code and its own name, and every one's sentences.
 * To add one: a file like en.ts here, typed `Strings`, and a line in each list below.
 */
import { de } from './de'
import { en } from './en'
import type { Strings } from './en'
import { es } from './es'
import { fr } from './fr'
import { hi } from './hi'
import { id } from './id'
import { it } from './it'
import { ja } from './ja'
import { ko } from './ko'
import { ptBR } from './pt-BR'
import { ru } from './ru'
import { th } from './th'
import { tr } from './tr'
import { vi } from './vi'
import { zhCN } from './zh-CN'
import { zhTW } from './zh-TW'

/** Each language's code (as `/pixelbg language` takes it) and its name in itself. */
export const LANGUAGES = {
  en: 'English',
  'zh-TW': '繁體中文',
  'zh-CN': '简体中文',
  ja: '日本語',
  ko: '한국어',
  es: 'Español',
  fr: 'Français',
  de: 'Deutsch',
  'pt-BR': 'Português (Brasil)',
  it: 'Italiano',
  id: 'Bahasa Indonesia',
  hi: 'हिन्दी',
  ru: 'Русский',
  vi: 'Tiếng Việt',
  th: 'ไทย',
  tr: 'Türkçe',
} as const

export type Spoken = keyof typeof LANGUAGES

export const TABLES: Record<Spoken, Strings> = {
  en,
  'zh-TW': zhTW,
  'zh-CN': zhCN,
  ja,
  ko,
  es,
  fr,
  de,
  'pt-BR': ptBR,
  it,
  id,
  hi,
  ru,
  vi,
  th,
  tr,
}

export function isSpoken(code: string): code is Spoken {
  return Object.prototype.hasOwnProperty.call(LANGUAGES, code)
}
