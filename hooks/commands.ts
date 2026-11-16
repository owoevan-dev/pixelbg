/**
 * `/pixelbg <verb> …`: the same controls as the panel, as commands. Each answers with a line of
 * what happened and the state afterwards.
 */
import type { EngineInterface } from 'claude-code'

import { checkFfmpeg, ffprobeFor, isLocalPath, MediaError, recentPictures } from './media'
import { chars, commas, openPanel, retryThumbs } from './panel'
import { absolute, fileName, isAbsolutePath, resolvePath, unquote } from './paths'
import { DEFAULTS, MAX_WIDTH, MIN_WIDTH } from './settings'
import { change } from './show'
import { S } from './state'
import { currentLanguage, isSpoken, LANGUAGE_CODES, LANGUAGES, t } from './text'
import type { Key } from './text'

/** The verbs that may convert the picture again: one at a time. */
export const CONVERTING_VERBS: ReadonlySet<string> = new Set(['set', 'size', 'colors', 'quality', 'on'])

/** Each command as typed, and the sentence that says what it does. */
const HELP_ROWS: readonly [string, Key][] = [
  ['/pixelbg set <path | name | number>', 'help.set'],
  ['/pixelbg recent', 'help.recent'],
  ['/pixelbg quality <normal | hd>', 'help.quality'],
  [`/pixelbg size <${MIN_WIDTH}-${MAX_WIDTH}>`, 'help.size'],
  ['/pixelbg colors <2-64>', 'help.colors'],
  ['/pixelbg fit <cover | contain>', 'help.fit'],
  ['/pixelbg dim <0-90>', 'help.dim'],
  ['/pixelbg glass <0-64> <0-100>', 'help.glass'],
  ['/pixelbg tint <on | off>', 'help.tint'],
  ['/pixelbg on | off', 'help.onoff'],
  ['/pixelbg ffmpeg <path>', 'help.ffmpeg'],
  ['/pixelbg language <auto | code>', 'help.language'],
]

/** The commands, one a line, their descriptions in a column in every language. */
export function help(): string {
  const vars = {
    width: DEFAULTS.width,
    colors: DEFAULTS.colors,
    dim: Math.round(DEFAULTS.dim * 100),
    blur: DEFAULTS.blur,
    opacity: Math.round(DEFAULTS.opacity * 100),
    list: LANGUAGE_CODES,
  }
  const column = Math.max(...HELP_ROWS.map(([usage]) => usage.length)) + 2

  return [t('help.intro'), ...HELP_ROWS.map(([usage, key]) => `  ${usage.padEnd(column)}${t(key, vars)}`)].join('\n')
}

export function describe(): string {
  const { art, settings: s } = S
  const lines = [
    // The file's name only: command answers stay in the conversation, so folders are left out.
    art === undefined ? t('desc.none') : t('desc.picture', { path: fileName(art.source) }),
    art === undefined
      ? ''
      : t('desc.pixels', { w: art.w, h: art.h, sw: art.sourceW, sh: art.sourceH, colors: art.colors, layers: art.svgs.length, chars: commas(chars(art.svgs)) }),
    s.quality === 'hd' ? t('desc.hd', { colors: s.colors }) : t('desc.normal', { width: s.width, colors: s.colors }),
    t('desc.look', { fit: t(s.fit === 'cover' ? 'desc.cover' : 'desc.contain'), dim: Math.round(s.dim * 100), blur: s.blur, opacity: Math.round(s.opacity * 100) }),
    t(!s.tint ? 'desc.tintOff' : art !== undefined && art.theme === undefined ? 'desc.tintPending' : 'desc.tintOn'),
    t('desc.state', {
      state: t(s.enabled ? 'desc.stateOn' : 'desc.stateOff'),
      // Its file name: where it is installed is nobody else's business.
      ffmpeg: fileName(s.ffmpeg),
      language: s.language === 'auto' ? `auto (${currentLanguage()})` : s.language,
    }),
  ]

  return lines.filter(line => line !== '').join('\n')
}

function number(text: string | undefined, lo: number, hi: number): number | undefined {
  const n = Number(text)

  return text !== undefined && text !== '' && Number.isFinite(n) && n >= lo && n <= hi ? n : undefined
}

function updated(note: string): string {
  return `${t('cmd.updated')}${note === '' ? '' : ` · ${note}`}\n${describe()}`
}

export async function run($: EngineInterface, args: string): Promise<string> {
  const [first = '', ...rest] = args.trim().split(/\s+/)
  const verb = first.toLowerCase()
  const tail = args.trim().slice(first.length).trim()

  switch (verb) {
    case '':
    case 'panel':
      return openPanel($)
    case 'help':
    case 'status':
      return `${describe()}\n\n${help()}`
    case 'recent': {
      S.recent = await recentPictures($)
      $.ui.invalidate('ui.render')

      return S.recent.length === 0 ? t('cmd.recentNone') : `${t('cmd.recentHead')}\n${S.recent.map((r, i) => `  ${i + 1}. ${r.name}  (${fileName(r.path.slice(0, -r.name.length - 1))})`).join('\n')}`
    }
    case 'set': {
      const path = await resolvePath($, tail)
      const started = await $.clock.now()
      // Chosen on purpose: made anew, as the file may have changed on disk.
      const note = await change($, { path, enabled: true }, true)
      const seconds = ((await $.clock.now()) - started) / 1000

      return `${t('cmd.set', { seconds: seconds.toFixed(1) })}${note === '' ? '' : ` · ${note}`}\n${describe()}`
    }
    case 'size':
    case 'colors':
    case 'dim': {
      const [lo, hi, example] = verb === 'size' ? [MIN_WIDTH, MAX_WIDTH, DEFAULTS.width] : verb === 'colors' ? [2, 64, DEFAULTS.colors] : [0, 90, 15]
      const n = number(rest[0], lo, hi)

      if (n === undefined) {
        return t('cmd.range', { lo, hi, verb, example })
      }

      return updated(await change($, verb === 'size' ? { width: Math.round(n), quality: 'normal' } : verb === 'colors' ? { colors: Math.round(n) } : { dim: n / 100 }))
    }
    case 'quality': {
      const quality = rest[0]?.toLowerCase()

      return quality === 'hd' || quality === 'normal' ? updated(await change($, { quality })) : t('cmd.quality')
    }
    case 'fit': {
      const fit = rest[0]?.toLowerCase()

      return fit === 'cover' || fit === 'contain' ? updated(await change($, { fit })) : t('cmd.fit')
    }
    case 'glass': {
      const blur = number(rest[0], 0, 64)
      const opacity = number(rest[1], 0, 100)

      return blur === undefined || opacity === undefined ? t('cmd.glass') : updated(await change($, { blur, opacity: opacity / 100 }))
    }
    case 'tint': {
      const value = rest[0]?.toLowerCase()

      return value === 'on' || value === 'off' ? updated(await change($, { tint: value === 'on' })) : t('cmd.tint')
    }
    case 'language': {
      // Codes are matched without regard to case: zh-tw is zh-TW.
      const value = rest[0]?.toLowerCase() ?? ''
      const code = Object.keys(LANGUAGES).find(c => c.toLowerCase() === value) ?? value
      const language = code === 'auto' ? 'auto' : isSpoken(code) ? code : undefined

      return language === undefined ? t('cmd.language', { list: LANGUAGE_CODES }) : updated(await change($, { language }))
    }
    case 'off':
      await change($, { enabled: false })

      return t('cmd.off')
    case 'on': {
      const note = await change($, { enabled: true })

      return S.art === undefined ? t('cmd.onEmpty') : updated(note)
    }
    case 'ffmpeg': {
      const given = unquote(tail)

      if (given === '') {
        return t('cmd.ffmpegNow', { path: fileName(S.settings.ffmpeg) })
      }
      // A path with folders is kept absolute (`./bin/ffmpeg` means this project's, in every
      // session); a bare name is found on the PATH. Never a program on a network share.
      const path = /[\\/]/.test(given) && !isAbsolutePath(given) ? await absolute($, given) : given

      if (!isLocalPath(path)) {
        throw new MediaError('local', fileName(path))
      }
      // ffprobe beside it is needed too.
      const check = await checkFfmpeg($, { ffmpeg: path })
      const probe = check.ok ? await checkFfmpeg($, { ffmpeg: ffprobeFor(path) }) : check

      if (!check.ok || !probe.ok) {
        return t('cmd.ffmpegBad', { why: !check.ok ? check.why : probe.ok ? '' : `${fileName(ffprobeFor(path))}: ${probe.why}` })
      }
      await change($, { ffmpeg: path })
      // Thumbnails that failed for want of FFmpeg get another try.
      retryThumbs($)

      return t('cmd.ffmpegSet', { path: fileName(path), version: check.version })
    }
    default:
      return help()
  }
}
