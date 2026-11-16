/**
 * The picture library: the user's own list of pictures to pick a backdrop from.
 *
 * It lives in pixelbg's own folder (%LOCALAPPDATA%\pixelbg on Windows, ~/.pixelbg elsewhere),
 * outside the mod, so it survives updates and never ships with it. Entries point at the pictures
 * where they are: removing one never touches the picture.
 *
 * Each entry is a small file of its own (`library/<id>.json`), each thumbnail too
 * (`thumbs/<id>.svg`), and so is each removal (`removed/<id>.json`), so that no change rewrites
 * another's: two windows adding pictures keep both, making a thumbnail never brings back an entry
 * another window removed, renaming never undoes a removal made meanwhile, and an entry that cannot
 * be read is left as it is while the others still show. The mod cannot delete files, so a removal
 * is a marker file, and Undo marks it kept again. (Entries written before the markers carried a
 * `removed` field; it still counts when there is no marker.)
 */
import type { EngineInterface } from 'claude-code'

import { encodePreview } from './encode'
import { firstFolder, onWindows } from './host'
import type { Variable } from './host'
import { decodeStill } from './media'
import type { Tools } from './media'
import { quantize } from './quantize'
import { isOwnSvg } from './settings'
import { t, Told } from './text'

export type Item = { id: string; name: string; path: string; addedAt: number }
type Entry = Item & { removed: boolean }

export const MAX_NAME = 40
/** Cards the panel draws at once: with the preview, well under the desktop's budget for a panel. */
export const MAX_CARDS = 20
/** A thumbnail's most characters; makeThumb keeps to it. */
export const THUMB_CHARS = 6000
const THUMB_BOX = 112
const ID = /^[a-z0-9-]{1,40}$/

/**
 * pixelbg's own folder: on Windows in the user's local app data, else in their home folder. Only
 * a folder this system takes as absolute counts (host.ts); without one it saves nothing, rather
 * than write into whatever folder it runs in.
 */
export async function dataDir($: EngineInterface): Promise<string> {
  const windows = await onWindows($)
  const local = windows ? firstFolder([['LOCALAPPDATA', await $.env.get('LOCALAPPDATA')]], true) : undefined

  if (local !== undefined) {
    return `${local.folder}\\pixelbg`
  }
  const profile: Variable = ['USERPROFILE', await $.env.get('USERPROFILE')]
  const home = firstFolder(windows ? [profile, ['HOME', await $.env.get('HOME')]] : [['HOME', await $.env.get('HOME')], profile], windows)

  if (home !== undefined) {
    return `${home.folder}/.pixelbg`
  }
  throw new Told(t('err.noHome'))
}

export function nameOf(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? path

  return base.replace(/\.[^.]+$/, '').slice(0, MAX_NAME) || base.slice(0, MAX_NAME)
}

/** One entry file's content, if it is an entry this version wrote; anything else is left alone. */
function readEntry(id: string, text: unknown): Entry | undefined {
  try {
    const v = JSON.parse(typeof text === 'string' ? text : '') as Record<string, unknown> | null

    // Every field this version writes must be of its kind: an entry it did not write is left alone.
    if (
      v === null ||
      typeof v !== 'object' ||
      v.version !== 1 ||
      v.id !== id ||
      typeof v.path !== 'string' ||
      v.path === '' ||
      ('removed' in v && typeof v.removed !== 'boolean') ||
      ('name' in v && typeof v.name !== 'string') ||
      ('addedAt' in v && typeof v.addedAt !== 'number')
    ) {
      return undefined
    }

    return {
      id,
      name: typeof v.name === 'string' && v.name.trim() !== '' ? v.name.slice(0, MAX_NAME) : nameOf(v.path),
      path: v.path,
      addedAt: typeof v.addedAt === 'number' ? v.addedAt : 0,
      removed: v.removed === true,
    }
  } catch {
    return undefined
  }
}

async function folders($: EngineInterface): Promise<{ entries: string; thumbs: string; removals: string }> {
  const dir = await dataDir($)

  return { entries: `${dir}/library`, thumbs: `${dir}/thumbs`, removals: `${dir}/removed` }
}

/** The JSON files of a folder, by id; none when the folder is not there yet. */
async function idFiles($: EngineInterface, folder: string): Promise<string[]> {
  if (!(await $.fs.exists(folder))) {
    return []
  }

  return (await $.fs.list(folder)).filter(file => file.kind === 'file' && file.name.endsWith('.json') && ID.test(file.name.slice(0, -5))).map(file => file.name.slice(0, -5))
}

/** A removal marker: removed, kept again by Undo, or `unknown` (there, but damaged or from a later version). */
type Mark = boolean | 'unknown'

async function readMark($: EngineInterface, folder: string, id: string): Promise<Mark> {
  try {
    const v = JSON.parse(String(await $.fs.read(`${folder}/${id}.json`))) as Record<string, unknown> | null

    return v !== null && typeof v === 'object' && v.version === 1 && v.id === id && typeof v.removed === 'boolean' ? v.removed : 'unknown'
  } catch {
    return 'unknown'
  }
}

/** Every removal marker there is. */
async function readRemovals($: EngineInterface, folder: string): Promise<Map<string, Mark>> {
  const marks = new Map<string, Mark>()

  for (const id of await idFiles($, folder)) {
    marks.set(id, await readMark($, folder, id))
  }

  return marks
}

/**
 * The library: every entry not removed, newest first, and how many entries could not be read
 * (they are left as they are). An entry whose removal marker is there but cannot be read is
 * hidden and counted with them: it may well have been removed.
 */
export async function readLibrary($: EngineInterface): Promise<{ items: Item[]; unreadable: number }> {
  const { entries, removals } = await folders($)
  const ids = await idFiles($, entries)
  const marks = ids.length === 0 ? new Map<string, Mark>() : await readRemovals($, removals)
  const items: Item[] = []
  let unreadable = 0

  for (const id of ids) {
    const entry = readEntry(id, await $.fs.read(`${entries}/${id}.json`).catch(() => undefined))
    const mark = marks.get(id)

    if (entry === undefined || mark === 'unknown') {
      unreadable += 1
    } else if (!(mark ?? entry.removed)) {
      items.push({ id: entry.id, name: entry.name, path: entry.path, addedAt: entry.addedAt })
    }
  }

  return { items: items.sort((a, b) => b.addedAt - a.addedAt), unreadable }
}

async function writeEntry($: EngineInterface, entry: Entry): Promise<void> {
  const { entries } = await folders($)

  await $.fs.write(`${entries}/${entry.id}.json`, `${JSON.stringify({ version: 1, ...entry }, null, 2)}\n`)
}

/** Change one entry as it is on disk now; an entry that cannot be read is not written. */
async function updateEntry($: EngineInterface, id: string, edit: (entry: Entry) => Entry): Promise<void> {
  const { entries } = await folders($)
  const entry = ID.test(id) ? readEntry(id, await $.fs.read(`${entries}/${id}.json`).catch(() => undefined)) : undefined

  if (entry === undefined) {
    throw new Told(t('library.unreadable'))
  }
  await writeEntry($, edit(entry))
}

/**
 * An entry's id, from the picture's path (Windows paths ignore case and the slash used): two
 * windows adding the same picture at once write the one entry, not two.
 */
export function idFor(path: string): string {
  const key = /^[A-Za-z]:[\\/]|^[\\/]{2}/.test(path) ? path.replace(/\\/g, '/').toLowerCase() : path
  // Two 32-bit FNV-1a hashes, with different seeds: 64 bits, as letters and digits.
  let a = 0x811c9dc5
  let b = 0x01000193 ^ 0x5bd1e995

  for (let i = 0; i < key.length; i++) {
    const c = key.charCodeAt(i)

    a = Math.imul(a ^ c, 0x01000193) >>> 0
    b = Math.imul(b ^ c, 0x01000193 ^ 0x2f) >>> 0
  }

  return `p${a.toString(36)}${b.toString(36)}`
}

/** Add a picture; one already in the library (the same file) is returned as it is, and one removed earlier comes back. */
export async function addEntry($: EngineInterface, path: string, same: (a: string, b: string) => boolean): Promise<Item> {
  const found = (await readLibrary($)).items.find(i => same(i.path, path))

  if (found !== undefined) {
    return found
  }
  const item: Item = { id: idFor(path), name: nameOf(path), path, addedAt: Date.now() }
  const { removals } = await folders($)

  await writeEntry($, { ...item, removed: false })
  if (await $.fs.exists(`${removals}/${item.id}.json`)) {
    await setRemoved($, item.id, false)
  }

  return item
}

export function renameEntry($: EngineInterface, id: string, name: string): Promise<void> {
  return updateEntry($, id, entry => ({ ...entry, name: name.slice(0, MAX_NAME) }))
}

/**
 * Remove an entry, or keep it again (Undo): a marker of its own, so no rename can undo it. A
 * marker that is there but cannot be read (damaged, or from a later version) is never written over.
 */
export async function setRemoved($: EngineInterface, id: string, removed: boolean): Promise<void> {
  const { removals } = await folders($)

  if (!ID.test(id) || ((await $.fs.exists(`${removals}/${id}.json`)) && (await readMark($, removals, id)) === 'unknown')) {
    throw new Told(t('library.unreadable'))
  }
  await $.fs.write(`${removals}/${id}.json`, `${JSON.stringify({ version: 1, id, removed })}\n`)
}

/** The thumbnails there are for these entries: an SVG, or '' for a picture that could not be read. */
export async function readThumbs($: EngineInterface, items: readonly Item[]): Promise<Map<string, string>> {
  const { thumbs } = await folders($)
  const found = new Map<string, string>()

  for (const item of items) {
    const text = await $.fs.read(`${thumbs}/${item.id}.svg`).catch(() => undefined)

    if (typeof text === 'string' && (text === '' || (text.length <= THUMB_CHARS && isOwnSvg(text)))) {
      found.set(item.id, text)
    }
  }

  return found
}

export async function writeThumb($: EngineInterface, id: string, svg: string): Promise<void> {
  const { thumbs } = await folders($)

  await $.fs.write(`${thumbs}/${id}.svg`, svg)
}

/**
 * A thumbnail: the picture at 48 pixels across and 8 colours, shown whole within 112 pixels, and
 * never more than THUMB_CHARS characters, so twenty cards and the large preview stay far below
 * the 262,144 characters the desktop takes for a whole panel.
 */
export async function makeThumb($: EngineInterface, tools: Tools, path: string): Promise<string> {
  const decoded = await decodeStill($, tools, path, 48)

  return encodePreview(quantize(decoded.rgba, decoded.w, decoded.h, 8), THUMB_BOX, THUMB_CHARS)
}
