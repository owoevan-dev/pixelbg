/**
 * Showing the backdrop, and changing what it is.
 *
 * The backdrop is a theme: a scene this mod draws (register.ts, the Backdrop hook), the panels'
 * frosted glass over it, and, when the switch is on, the app's colours taken from the picture.
 *
 * Every change goes through `change`, which works on the snapshot every session shares (shared.ts):
 * it reads the snapshot, makes new pixels if the change needs them, reads it again, applies the
 * settings nobody else chose meanwhile, and writes the result whole. Only once that write has
 * succeeded does this session take the result as its own; a failure anywhere changes nothing.
 */
import type { EngineInterface, Timer } from 'claude-code'

import { buildKey, makeArt, refit } from './build'
import type { Settings } from './settings'
import { FOLLOW_MS, newId, readSnapshot, writeSnapshot } from './shared'
import type { Snapshot } from './shared'
import { S } from './state'
import { chooseLanguage, commandSpec, t, Told } from './text'

export const SCENE = 'pixelbg'

/** The settings whose change needs new pixels. */
const PIXEL_KEYS: readonly (keyof Settings)[] = ['path', 'quality', 'colors', 'width']

/** The settings as shown now: the committed ones, with any slider still being dragged on top. */
export function shown(): Settings {
  return { ...S.settings, ...S.live }
}

/**
 * Theme updates run one at a time, and each does what the settings say when its turn comes: so a
 * slow `theme.set` cannot leave the backdrop up after it was turned off.
 */
let themeTurn: Promise<unknown> = Promise.resolve()

function inTurn<T>(work: () => Promise<T>): Promise<T> {
  const turn = themeTurn.then(work, work)

  themeTurn = turn.catch(() => undefined)

  return turn
}

/**
 * Bring the theme in line with the settings: the backdrop up when it is on and there is one; taken
 * down when it is off and this mod put it up. `showing` changes only once the host has done it, so
 * a failed clear is tried again by the next one. A note when the desktop says it won't draw it.
 */
export function show($: EngineInterface): Promise<string> {
  return inTurn(async () => {
    const settings = shown()
    const art = S.art

    // Until this turn ends well, the screen may not match the settings: takeUp tries again.
    S.inSync = false
    if (!settings.enabled || art === undefined) {
      if (S.showing) {
        await $.theme.clear()
        S.showing = false
      }
      S.inSync = true

      return ''
    }
    const colors = settings.tint ? art.theme : undefined

    // Marked first: an `off` queued behind this set then clears what it put up.
    S.showing = true
    const set = await $.theme.set({ backdrop: { scene: SCENE, glass: { blur: settings.blur, opacity: settings.opacity } }, ...(colors === undefined ? {} : { colors }) })

    // The same scene name as before: ask for a redraw, so a new picture shows at once.
    $.ui.invalidate('ui.render')
    S.inSync = true

    return set.isDrawn ? '' : t('note.notDrawn', { reason: set.reason })
  })
}

/** Do these settings need pixels that the backdrop here was not made for? Never while it is off. */
export function needsBuild(settings: Settings): boolean {
  return settings.enabled && settings.path !== undefined && S.art?.key !== buildKey(settings)
}

/** Make a snapshot this session's own: its settings, its backdrop (fitted), its id. */
async function adopt($: EngineInterface, snapshot: Snapshot): Promise<void> {
  const language = S.settings.language

  S.settings = snapshot.settings
  S.art = snapshot.art === undefined ? undefined : refit(snapshot.art, snapshot.settings.fit)
  S.id = snapshot.id
  S.revision = snapshot.revision
  S.chosen = snapshot.chosen
  if (S.settings.language !== language) {
    await chooseLanguage($, S.settings.language, () => S.settings.language === 'auto')
    await $.command.register(commandSpec())
  }
}

/**
 * The snapshot to work from: the one on disk, read whole (a file being written is read again a
 * few times), or this session's own when there is none yet. A file that stays unreadable stops the
 * change: it is never written over unread.
 */
async function current($: EngineInterface): Promise<Snapshot> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const snapshot = await readSnapshot($)

    if (snapshot === 'missing') {
      return { version: 1, id: S.id, revision: S.revision, chosen: S.chosen, settings: S.settings, ...(S.art === undefined ? {} : { art: S.art }) }
    }
    if (snapshot !== 'unreadable') {
      return snapshot
    }
    await $.clock.sleep(100)
  }
  throw new Told(t('err.state'))
}

function pick(patch: Partial<Settings>, keys: readonly (keyof Settings)[]): Partial<Settings> {
  return Object.fromEntries(keys.filter(key => key in patch).map(key => [key, patch[key]]))
}

/** Conversions one change may make while other changes keep landing before it can commit. */
const MAX_ROUNDS = 3

/**
 * Apply `patch`. New pixels are made when the change needs them (a new picture, colours, quality,
 * the width in normal mode), or always with `force` (choosing a picture again, which may have
 * changed on disk).
 *
 * A conversion takes seconds, and other changes may land meanwhile, here or in another session.
 * When it ends, a setting someone chose since this change began is theirs: the later choice wins.
 * If another session picked a picture meanwhile, its picture is kept and this change's picture
 * settings yield, with a note; the rest of the change (dimming, glass…) still applies.
 *
 * What is committed always holds pixels for the settings it commits, whenever they are on: if a
 * later choice (another window's colours, say) leaves the pixels just made unfit, they are made
 * again for the settings as they now stand. Should that keep happening, the change stops after a
 * few rounds and commits nothing.
 */
export async function change($: EngineInterface, patch: Partial<Settings>, force = false): Promise<string> {
  const start = await current($)
  let wanted: Settings = { ...start.settings, ...patch }
  let seen = start.art
  let made: Awaited<ReturnType<typeof makeArt>> | undefined
  let fresh = force

  for (let round = 1; ; round++) {
    if (wanted.enabled && wanted.path !== undefined && (fresh || ![made?.art, seen].some(a => a !== undefined && a.key === buildKey(wanted)))) {
      made = await makeArt($, wanted)
      fresh = false
    }
    const now = await current($)
    // Someone chose a picture since this change began (another one, or the same file again, which
    // may have changed on disk): only `chosen` says so. A backdrop on disk does not: it may be the
    // old picture, merely made again in other colours.
    const pictureChosen = (now.chosen.path ?? 0) > start.revision
    let keys = (Object.keys(patch) as (keyof Settings)[]).filter(key => (now.chosen[key] ?? 0) <= start.revision)
    let settings: Settings = { ...now.settings, ...pick(patch, keys) }
    // Their backdrop first when they chose the picture: pixels this change made from the same path
    // earlier may show the file as it was before.
    let art = (pictureChosen ? [now.art, made?.art] : [made?.art, now.art]).find(a => a !== undefined && a.key === buildKey(settings))

    if (art === undefined && settings.enabled && settings.path !== undefined && pictureChosen && now.art !== undefined) {
      // The picture was chosen elsewhere while this one converted: theirs stays, with its pixels.
      keys = keys.filter(key => !PIXEL_KEYS.includes(key))
      settings = { ...now.settings, ...pick(patch, keys) }
      art = now.art.key === buildKey(settings) ? now.art : undefined
    }
    if (art === undefined && settings.enabled && settings.path !== undefined) {
      // No pixels fit the settings as they now stand: make them, unless this has gone on too long.
      if (round >= MAX_ROUNDS) {
        throw new Told(t('err.busy'))
      }
      wanted = settings
      seen = now.art
      continue
    }

    return commit($, patch, keys, now, settings, art, made?.note ?? '')
  }
}

/** Write the change's result whole; only then take it as this session's own and show it. */
async function commit(
  $: EngineInterface,
  patch: Partial<Settings>,
  keys: (keyof Settings)[],
  now: Snapshot,
  settings: Settings,
  art: Snapshot['art'],
  made: string,
): Promise<string> {
  let note = made

  if ((Object.keys(patch) as (keyof Settings)[]).some(key => PIXEL_KEYS.includes(key) && !keys.includes(key))) {
    // Some of this change's picture settings gave way to a later choice: say so.
    note = t('note.superseded')
  }
  const revision = now.revision + 1
  const chosen = { ...now.chosen }

  for (const key of keys) {
    chosen[key] = revision
  }
  const snapshot: Snapshot = { version: 1, id: newId(), revision, chosen, settings, ...(art === undefined ? {} : { art: refit(art, settings.fit) }) }

  await writeSnapshot($, snapshot)
  await adopt($, snapshot)
  const drawn = await show($)

  $.ui.invalidate('ui.render')

  return [note, drawn].filter(line => line !== '').join(' · ')
}

/**
 * Take up the snapshot on disk when it is not the one shown here (another session wrote it); and
 * when a theme update the host refused left the screen unlike the settings, try it again.
 */
export async function takeUp($: EngineInterface): Promise<void> {
  const snapshot = await readSnapshot($)

  if (typeof snapshot === 'object' && snapshot.id !== S.id) {
    await adopt($, snapshot)
    await show($)
    $.ui.invalidate('ui.render')
  } else if (!S.inSync) {
    await show($)
  }
}

/** At a session's start: the shared snapshot, if there is one to read. */
export async function load($: EngineInterface): Promise<void> {
  const snapshot = await readSnapshot($)

  if (typeof snapshot === 'object') {
    await adopt($, snapshot)
  }
}

let following: Timer | undefined

/** Look for other sessions' changes every few seconds, from now on. */
export function follow($: EngineInterface): void {
  following?.cancel()
  following = $.clock.every(FOLLOW_MS, () => {
    void takeUp($).catch(() => undefined)
  })
}
