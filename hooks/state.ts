/**
 * The mod's state while it runs, in one object every module shares.
 *
 * What must outlive a reload or a new session is in pixelbg's own folder: the shared snapshot of
 * settings and backdrop (shared.ts) and the library (library.ts). Everything here is rebuilt from
 * those, or is only about what this session's panel shows now.
 */
import type { Item } from './library'
import type { Recent } from './media'
import { DEFAULTS } from './settings'
import type { Art, Settings } from './settings'

/** The work that runs now: nothing, or a conversion. */
export type Busy = '' | 'convert'

/** Settings a slider is being dragged through: shown at once, committed when it is let go. */
export type Live = Partial<Pick<Settings, 'dim' | 'opacity' | 'blur'>>

export const S = {
  /** The committed settings and backdrop: the shared snapshot this session last wrote or took up. */
  settings: { ...DEFAULTS } as Settings,
  art: undefined as Art | undefined,
  /** That snapshot's id and revision, and the revision in which each setting was last chosen. */
  id: '',
  revision: 0,
  chosen: {} as Partial<Record<keyof Settings, number>>,
  live: {} as Live,
  /** The library as last read, the thumbnails found for it, and entries that could not be read. */
  library: [] as Item[],
  thumbs: new Map<string, string>(),
  unreadableEntries: 0,
  /** The newest pictures found, for `/pixelbg set <number>` and the panel's recent list. */
  recent: [] as Recent[],
  busy: '' as Busy,
  /**
   * The last result, and the last error, for the panel's status row. A result is about the
   * snapshot it was written for (`noteFor`, its id): once any later change is made here or taken
   * up from another window, or the language changes (a change too), it is out of date and not shown.
   */
  lastNote: '',
  noteFor: '',
  lastError: '',
  /** Panel: the entry being renamed, the last removal (for undo), whether the recent list shows. */
  renaming: '',
  removed: undefined as Item | undefined,
  showRecent: false,
  /** Thumbnails are being made (one pass at a time). */
  thumbing: false,
  /** This mod's theme is up, so taking it down is ours to do. */
  showing: false,
  /** The last theme update ended well: the screen matches the settings (else takeUp tries again). */
  inSync: true,
}
