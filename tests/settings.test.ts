import { expect, test } from 'claude-code/testing'

import { encodeDashLayers } from '../hooks/dash'
import { encodePreview, encodeStill } from '../hooks/encode'
import { quantize } from '../hooks/quantize'
import { withoutFolders } from '../hooks/paths'
import { DEFAULTS, isOwnSvg, MAX_WIDTH, readArt, readSettings } from '../hooks/settings'
import { languageOf, TABLES } from '../hooks/text'

test('settings from the store are checked: junk falls back, numbers are clamped', () => {
  expect(readSettings(undefined)).toEqual(DEFAULTS)
  expect(readSettings('nonsense')).toEqual(DEFAULTS)

  const read = readSettings({ width: 99999, colors: -3, dim: 5, opacity: 'x', fit: 'stretch', quality: 'color', language: 'xx', enabled: 'yes', ffmpeg: '', path: '' })

  expect(read.width).toBe(MAX_WIDTH)
  expect(read.colors).toBe(2)
  expect(read.dim).toBe(0.9)
  expect(read.opacity).toBe(DEFAULTS.opacity)
  expect(read.fit).toBe('cover')
  expect(read.quality).toBe(DEFAULTS.quality)
  expect(read.language).toBe('auto')
  expect(read.enabled).toBe(DEFAULTS.enabled)
  expect(read.ffmpeg).toBe('ffmpeg')
  expect(read.path).toBeUndefined()
})

test('a stored backdrop is used only when it is whole and within the desktop limits', () => {
  const good = { svgs: ["<svg viewBox='0 0 2 2'></svg>"], preview: '', w: 2, h: 2, colors: 1, source: 'T:/a.png', sourceW: 2, sourceH: 2, quality: 'hd' }

  expect(readArt(good)?.w).toBe(2)
  expect(readArt({ ...good, svgs: [] })).toBeUndefined()
  expect(readArt({ ...good, svgs: ['<svg>', '<svg>', '<svg>'] })).toBeUndefined()
  expect(readArt({ ...good, svgs: [`<svg>${'x'.repeat(140000)}</svg>`] })).toBeUndefined()
  expect(readArt({ ...good, svgs: ['<script>'] })).toBeUndefined()
  expect(readArt({ ...good, source: undefined })).toBeUndefined()
  // A theme that is not one is dropped, the backdrop kept.
  expect(readArt({ ...good, theme: { v: 2 } })?.theme).toBeUndefined()
})

test('every language holds every sentence, with the same placeholders, and none left in English', () => {
  const en = TABLES.en
  const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort()

  expect(Object.keys(TABLES).length).toBe(16)
  for (const [language, table] of Object.entries(TABLES)) {
    expect({ language, keys: Object.keys(table).sort() }).toEqual({ language, keys: Object.keys(en).sort() })
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect({ language, key, holes: holes(table[key]) }).toEqual({ language, key, holes: holes(en[key]) })
    }
    if (language !== 'en') {
      // A sentence identical to the English one is a missed translation (names and codes aside).
      const same = (Object.keys(en) as (keyof typeof en)[]).filter(key => table[key] === en[key] && /[a-z]{4,} [a-z]{4,}/.test(en[key]))

      expect({ language, same }).toEqual({ language, same: [] })
    }
  }
})

test('locale tags map to the languages pixelbg speaks, and to English otherwise', () => {
  expect(languageOf('zh_TW.UTF-8')).toBe('zh-TW')
  expect(languageOf('zh-Hant-TW')).toBe('zh-TW')
  expect(languageOf('zh-HK')).toBe('zh-TW')
  expect(languageOf('zh-Hans-CN')).toBe('zh-CN')
  // The script decides before the region.
  expect(languageOf('zh-Hans-TW')).toBe('zh-CN')
  expect(languageOf('zh-Hant-CN')).toBe('zh-TW')
  expect(languageOf('zh_CN.UTF-8')).toBe('zh-CN')
  expect(languageOf('zh-SG')).toBe('zh-CN')
  expect(languageOf('zh')).toBe('zh-CN')
  expect(languageOf('ja-JP')).toBe('ja')
  expect(languageOf('ko_KR')).toBe('ko')
  expect(languageOf('es-419')).toBe('es')
  expect(languageOf('es_ES.UTF-8')).toBe('es')
  expect(languageOf('fr-CA')).toBe('fr')
  expect(languageOf('de_DE@euro')).toBe('de')
  expect(languageOf('pt-PT')).toBe('pt-BR')
  expect(languageOf('pt_BR')).toBe('pt-BR')
  expect(languageOf('it-IT')).toBe('it')
  expect(languageOf('id-ID')).toBe('id')
  expect(languageOf('in_ID')).toBe('id')
  expect(languageOf('hi-IN')).toBe('hi')
  expect(languageOf('ru_RU')).toBe('ru')
  expect(languageOf('vi-VN')).toBe('vi')
  expect(languageOf('th_TH')).toBe('th')
  expect(languageOf('tr-TR')).toBe('tr')
  expect(languageOf('en_US.UTF-8')).toBe('en')
  // Languages pixelbg does not speak get English.
  expect(languageOf('nl-NL')).toBe('en')
  expect(languageOf('sw-KE')).toBe('en')
  expect(languageOf('constructor')).toBe('en')
  expect(languageOf('zhx')).toBe('en')
  expect(languageOf('C.UTF-8')).toBeUndefined()
  expect(languageOf('POSIX')).toBeUndefined()
  expect(languageOf('')).toBeUndefined()
})

test('only documents as pixelbg writes them are drawn back from the store or the library', () => {
  const rgba = new Uint8Array(24 * 12 * 4).map((_, i) => (i % 4 === 3 ? 255 : (i * 37) % 256))
  const art = quantize(rgba, 24, 12, 8)
  const head = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 2 2'>"

  for (const own of [encodeStill(art, { fit: 'cover' }), encodeDashLayers(art, { fit: 'contain' }, 1e6, 2)?.[0] ?? '', encodePreview(art, 112, 6000)]) {
    expect(isOwnSvg(own)).toBe(true)
  }
  for (const foreign of [
    `${head}<script>alert(1)</script></svg>`,
    "<svg xmlns='http://www.w3.org/2000/svg' onload='alert(1)'></svg>",
    `${head}<image href='https://example.com/a.png'/></svg>`,
    `${head}<rect fill='url(#a)'/></svg>`,
    `${head}<rect fill="#000000"/></svg>`,
    `${head}hello</svg>`,
    `${head}<foreignObject></foreignObject></svg>`,
    `<?xml version='1.0'?>${head}</svg>`,
  ]) {
    expect({ foreign, own: isOwnSvg(foreign) }).toEqual({ foreign, own: false })
  }
})

test('the filter that cuts paths from answers leaves every sentence of every language as it is', () => {
  const changed: string[] = []

  for (const [code, table] of Object.entries(TABLES)) {
    for (const [key, sentence] of Object.entries(table)) {
      if (withoutFolders(sentence) !== sentence) {
        changed.push(`${code} ${key}`)
      }
    }
  }
  expect(changed).toEqual([])
  // And it does cut what it is for.
  expect(withoutFolders('File not found: T:/work/ExampleProject/missing.png (see help)')).toBe('File not found: missing.png (see help)')
  expect(withoutFolders('loading /srv/ExampleLib/libthing.so failed')).toBe('loading libthing.so failed')
  expect(withoutFolders('kept: %TEMP%/pixelbg/still-1.rgba')).toBe('kept: %TEMP%/pixelbg/still-1.rgba')
})

test('read-back documents must close every element, in order, inside the one svg', () => {
  const head = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 2 2'>"

  expect(isOwnSvg(`${head}<g><rect width='1' height='1'/></g></svg>`)).toBe(true)
  for (const broken of [
    `${head}<g><rect width='1' height='1'/></svg>`,
    `${head}</g></svg>`,
    `${head}<g></rect></g></svg>`,
    `${head}</svg><rect width='1' height='1'/></svg>`,
    `<svg viewBox='0 0 2 2'/><rect width='1' height='1'/></svg>`,
    // The outer svg never closed: the last tag closes an inner one.
    `${head}<svg viewBox='0 0 1 1'></svg>`,
  ]) {
    expect({ broken, own: isOwnSvg(broken) }).toEqual({ broken, own: false })
  }
})

test('a stored theme the design system finds misshapen is dropped, the backdrop kept', () => {
  const good = { svgs: ["<svg viewBox='0 0 2 2'></svg>"], preview: '', w: 2, h: 2, colors: 1, source: 'T:/a.png', sourceW: 2, sourceH: 2, quality: 'hd' }

  // No label, and a colour that is not six-digit hex.
  expect(readArt({ ...good, theme: { v: 1, inputs: { dark: { accent: 'red' } } } })?.theme).toBeUndefined()
  expect(readArt({ ...good, theme: { v: 1, inputs: { dark: { accent: 'red' } } } })?.w).toBe(2)
})
