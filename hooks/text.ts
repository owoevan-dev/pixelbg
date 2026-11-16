/**
 * Every sentence pixelbg shows, in the language of the user's choice: sixteen languages, one file
 * each in strings/ (English is the reference the others follow).
 *
 * The language follows the user's system unless they pick one (`/pixelbg language`). Detection
 * reads the locale variables, then on Windows the user's regional format from the registry and
 * on macOS the AppleLocale preference; it reads nothing else. A system language pixelbg does not
 * speak, or one it cannot tell, gets English.
 */
import type { EngineInterface } from 'claude-code'

import { MediaError } from './media'
import { isSpoken, LANGUAGES, TABLES } from './strings/all'
import type { Spoken } from './strings/all'
import type { Key } from './strings/en'

export type { Key } from './strings/en'
export type { Spoken } from './strings/all'
export { LANGUAGES, TABLES, isSpoken } from './strings/all'

/** `auto` (the system's), or one of the languages pixelbg speaks. */
export type Language = 'auto' | Spoken

/** The language codes, for messages that list them. */
export const LANGUAGE_CODES = Object.keys(LANGUAGES).join(', ')

let spoken: Spoken = 'en'

export function setLanguage(language: Spoken): void {
  spoken = language
}

export function currentLanguage(): Spoken {
  return spoken
}

/** The sentence for `key` in the current language, `{name}` placeholders filled from `vars`. */
export function t(key: Key, vars: Record<string, string | number> = {}): string {
  return TABLES[spoken][key].replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole))
}

/** A sentence pixelbg wrote itself (from strings/): it names files only, so it may be shown anywhere. */
export class Told extends Error {}

/** An error as a sentence, in full: for the panel, which only the user sees. */
export function errorText(error: unknown): string {
  if (error instanceof MediaError) {
    return t(`err.${error.kind}`, { detail: error.detail })
  }

  return error instanceof Error ? error.message : String(error)
}

/** Kinds whose detail pixelbg wrote itself: a file name, sizes, or a location written with its variable. */
const OWN_DETAIL = new Set<MediaError['kind']>(['local', 'shape', 'short', 'temp', 'cleanup'])

/**
 * An error as a sentence for the conversation, which the model reads and the transcript keeps:
 * built from what pixelbg knows to be safe, never from another program's or the system's own text.
 * Its own sentences as they are; FFmpeg's detail only when it names no folder (else the panel has
 * it); anything else by its error code only (`EEXIST`), the full message being in the panel.
 */
export function answerText(error: unknown): string {
  if (error instanceof Told) {
    return error.message
  }
  if (error instanceof MediaError) {
    const safe = OWN_DETAIL.has(error.kind) || !/[\\/]/.test(error.detail)

    return t(`err.${error.kind}`, { detail: safe ? error.detail : t('detail.panel') })
  }
  const code = /\b(E[A-Z]{2,})\b/.exec(error instanceof Error ? error.message : String(error))?.[1] ?? '?'

  return t('err.system', { code })
}

/** Where Chinese is written in Traditional script; a script subtag, when there is one, decides first. */
const TRADITIONAL = new Set(['tw', 'hk', 'mo'])

/**
 * A locale tag (`zh_TW.UTF-8`, `zh-Hant-HK`, `ja-JP`, `pt_PT`) as one of the languages pixelbg
 * speaks: Chinese by script or region, Portuguese as Brazilian, any other language by its own
 * code, and English for a language pixelbg does not speak. Undefined when the tag says nothing
 * (empty, or the `C` and `POSIX` placeholders).
 */
export function languageOf(tag: string): Spoken | undefined {
  const text = tag.trim()

  if (text === '' || /^(C|POSIX)([._@].*)?$/i.test(text)) {
    return undefined
  }
  const [language = '', ...rest] = text.toLowerCase().split(/[-_.@]/)

  if (language === 'zh') {
    if (rest.includes('hans') || rest.includes('hant')) {
      return rest.includes('hant') ? 'zh-TW' : 'zh-CN'
    }

    return rest.some(part => TRADITIONAL.has(part)) ? 'zh-TW' : 'zh-CN'
  }
  if (language === 'pt') {
    return 'pt-BR'
  }
  // `in` is the old code for Indonesian, still seen in some systems.
  const code = language === 'in' ? 'id' : language

  return isSpoken(code) ? code : 'en'
}

/** The system's language, looked up at most once each time the mod loads (and shared while it is). */
let systemLanguage: Promise<Spoken> | undefined

/**
 * Speak the language chosen in the settings: the system's for `auto`, applied only if `auto` is
 * still the choice when the lookup ends (`stillAuto`), so a later choice is never overridden.
 */
export async function chooseLanguage($: EngineInterface, choice: Language, stillAuto: () => boolean): Promise<void> {
  if (choice !== 'auto') {
    setLanguage(choice)

    return
  }
  systemLanguage ??= detectLanguage($)
  const found = await systemLanguage

  if (stillAuto()) {
    setLanguage(found)
  }
}

/** The slash command, described in the current language. */
export function commandSpec() {
  return {
    name: 'pixelbg',
    description: t('command.description'),
    argumentHint: '[help|set|recent|quality|size|colors|fit|dim|glass|tint|on|off|ffmpeg|language] …',
    immediate: true as const,
  }
}

/** The system's language, or English when it cannot be told. */
export async function detectLanguage($: EngineInterface): Promise<Spoken> {
  const tags = [await $.env.get('LC_ALL'), await $.env.get('LC_MESSAGES'), await $.env.get('LANG')]

  for (const tag of tags) {
    const found = languageOf(tag ?? '')

    if (found !== undefined) {
      return found
    }
  }
  const windows = (await $.env.get('OS')) === 'Windows_NT'
  // macOS keeps home folders in /Users; elsewhere there is nothing more to ask.
  const mac = !windows && ((await $.env.get('HOME')) ?? '').startsWith('/Users/')

  if (!windows && !mac) {
    return 'en'
  }
  const argv = windows ? ['reg', 'query', 'HKCU\\Control Panel\\International', '/v', 'LocaleName'] : ['defaults', 'read', '-g', 'AppleLocale']

  try {
    const run = await $.process.run(argv, { timeoutMs: 3000 })
    const tag = windows ? (/LocaleName\s+REG_SZ\s+(\S+)/.exec(run.stdout)?.[1] ?? '') : run.stdout

    return (run.exitCode === 0 ? languageOf(tag) : undefined) ?? 'en'
  } catch {
    return 'en'
  }
}
