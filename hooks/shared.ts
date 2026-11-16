/**
 * What every session shares: one snapshot of the settings and the current backdrop, in one file in
 * pixelbg's own folder (`current.json`), always written whole.
 *
 * Each session draws its own backdrop and sessions do not hear from one another, so each one reads
 * the snapshot every few seconds and takes up any that is not the one it shows (show.ts). Because
 * settings and backdrop travel in the one file, a session never sees the settings of one change with
 * the backdrop of another; a file read half-written fails to parse and is simply read again later.
 *
 * A snapshot carries an id (what sessions compare), a revision, and for each setting the revision
 * in which someone last chose it (`chosen`): a change that began before that revision leaves that
 * setting alone, so the later choice wins, even when it chose the value already there.
 */
import type { EngineInterface } from 'claude-code'

import { dataDir } from './library'
import { readArt, readSettings } from './settings'
import type { Art, Settings } from './settings'

export type Snapshot = {
  version: 1
  id: string
  revision: number
  chosen: Partial<Record<keyof Settings, number>>
  settings: Settings
  art?: Art
}

/** How often a session looks for another session's changes. */
export const FOLLOW_MS = 3000

const FILE = 'current.json'

export function newId(): string {
  return `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`
}

/**
 * The snapshot on disk: `missing` when there is none yet; `unreadable` when the file is there but
 * cannot be read or is not a snapshot of this version (being written, damaged, or from a later
 * pixelbg). An unreadable file is never treated as absent, so it is never written over unread.
 */
export async function readSnapshot($: EngineInterface): Promise<Snapshot | 'missing' | 'unreadable'> {
  const path = `${await dataDir($)}/${FILE}`

  if (!(await $.fs.exists(path))) {
    return 'missing'
  }
  try {
    const text = await $.fs.read(path)
    const v = JSON.parse(typeof text === 'string' ? text : '') as Record<string, unknown> | null

    // Each part this version writes must be of its kind: a snapshot it did not write is never
    // taken for one (and so never written over with defaults in place of its settings).
    const isObject = (x: unknown) => typeof x === 'object' && x !== null && !Array.isArray(x)

    if (v === null || typeof v !== 'object' || v.version !== 1 || typeof v.id !== 'string' || !Number.isInteger(v.revision) || !isObject(v.settings) || !isObject(v.chosen)) {
      return 'unreadable'
    }
    const settings = readSettings(v.settings)
    const chosen: Snapshot['chosen'] = {}
    const raw = typeof v.chosen === 'object' && v.chosen !== null ? (v.chosen as Record<string, unknown>) : {}

    for (const key of Object.keys(settings) as (keyof Settings)[]) {
      const at = raw[key]

      if (Object.prototype.hasOwnProperty.call(raw, key) && Number.isInteger(at)) {
        chosen[key] = at as number
      }
    }
    const art = readArt(v.art)

    return { version: 1, id: v.id, revision: v.revision as number, chosen, settings, ...(art === undefined ? {} : { art }) }
  } catch {
    return 'unreadable'
  }
}

/** Write a snapshot whole; it throws when the write fails, and then nothing is committed. */
export async function writeSnapshot($: EngineInterface, snapshot: Snapshot): Promise<void> {
  await $.fs.write(`${await dataDir($)}/${FILE}`, JSON.stringify(snapshot))
}
