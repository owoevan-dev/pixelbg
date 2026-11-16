/**
 * Turning what the user typed into a picture's path: a full path (quotes and a leading `~` are
 * fine), a number from the last `/pixelbg recent` list, a library entry's name, or the file name
 * of a picture in Downloads, Pictures or Desktop. What comes out is absolute, so every session means
 * the same file by it.
 */
import type { EngineInterface } from 'claude-code'

import { homeFolder } from './host'
import { isLocalPath, isPicture, MediaError, PICTURE_EXTENSIONS, recentPictures } from './media'
import { S } from './state'
import { t, Told } from './text'

export function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

export function unquote(text: string): string {
  return text.trim().replace(/^["']|["']$/g, '')
}

function picture(path: string): string {
  if (!isPicture(path)) {
    throw new Told(t('err.notPicture', { list: PICTURE_EXTENSIONS.join(', ') }))
  }

  return path
}

/** A Windows path: from a drive letter and a colon, or a share (two slashes, then a server). Its names ignore case. */
function isWindowsPath(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path) || /^[\\/]{2}[^\\/]/.test(path)
}

/**
 * A path that names the same file whatever folder a session runs in: a Windows drive or share
 * path, or a POSIX path from the root. (A Windows path from the root of "the current drive",
 * `\Pictures\x.png`, does not: resolvePath gives it the session's drive.)
 */
export function isAbsolutePath(path: string): boolean {
  return isWindowsPath(path) || /^\/(?!\/)/.test(path)
}

/** The same file? Windows paths ignore case and the slash used; other paths are compared exactly. */
export function samePath(a: string, b: string): boolean {
  if (isWindowsPath(a) && isWindowsPath(b)) {
    const norm = (p: string) => p.replace(/\//g, '\\').toLowerCase()

    return norm(a) === norm(b)
  }

  return a === b
}

/**
 * Text for the conversation with the user's home folder written `~`: answers to the command are
 * read by the model and kept in the transcript, and the home folder's name is usually the user's
 * own. (Picture lines already name files only; this covers paths inside error messages.)
 */
export async function withoutHome($: EngineInterface, text: string): Promise<string> {
  const homes = [await $.env.get('USERPROFILE'), await $.env.get('HOME')]
  let out = text

  for (const home of homes) {
    const dir = (home ?? '').replace(/[\\/]+$/, '')

    if (!isAbsolutePath(`${dir}/`) || dir.split(/[\\/]/).filter(part => part !== '').length < 2) {
      continue
    }
    const pattern = dir
      .split(/[\\/]/)
      .map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('[\\\\/]')

    // Only the whole folder: a home of `/srv/al` is not the start of `/srv/alex`.
    out = out.replace(new RegExp(`${pattern}(?![^\\\\/\\s'"),;:\\]])`, isWindowsPath(`${dir}/`) ? 'gi' : 'g'), '~')
  }

  return out
}

/**
 * Paths in a text: a drive or share path, a path from `~`, or one from the root with at least one
 * folder (but `/tmp/…`, the shared temporary folder, which names no one).
 */
const PATHS = new RegExp(
  [
    String.raw`(?<![A-Za-z0-9])(?:file:)?[A-Za-z]:[\\/](?:[^\\/\s'"<>|:*?]+[\\/])*([^\\/\s'"<>|:*?]+)`,
    String.raw`(?<![:\w])[\\/]{2}[^\\/\s'"]+(?:[\\/][^\\/\s'"]+)*[\\/]([^\\/\s'"]+)`,
    String.raw`~[\\/](?:[^\\/\s'"]+[\\/])+([^\\/\s'"]+)`,
    String.raw`(?<![\w.%$~:\\/])\/(?!tmp\/)(?:[^\/\s'"]+\/)+([^\/\s'"]+)`,
  ].join('|'),
  'g',
)

/**
 * Text for the conversation with every path cut to its file name: folders (a project's, a user's)
 * say more than an answer needs. Paths written with a variable (`%TEMP%/pixelbg/…`) are kept: they
 * say where, not whose. Answers are built from pixelbg's own sentences (text.ts `answerText`); this
 * is a second guard.
 */
export function withoutFolders(text: string): string {
  return text.replace(PATHS, (whole: string, ...names: unknown[]) => names.slice(0, 4).find((name): name is string => typeof name === 'string') ?? whole)
}

/**
 * A path made absolute against the session's own folder: a relative name means a different file
 * in each session (two projects with a `cover.png` each), so only absolute paths are kept.
 */
export async function absolute($: EngineInterface, path: string): Promise<string> {
  if (path === '' || isWindowsPath(path)) {
    return path
  }
  const cwd = (await $.session.cwd()).replace(/[\\/]+$/, '')

  // A bare name that is not a file here stays as it is: it may name a library entry or a picture
  // in the usual folders (resolvePath looks those up). In a session whose folder is a network share,
  // it is not looked for there at all: asking could make the system reach another machine.
  if (!/[\\/]/.test(path) && (/^[\\/]{2}/.test(cwd) || !(await $.fs.exists(path)))) {
    return path
  }
  const windows = /^[A-Za-z]:/.test(cwd)

  if (/^[\\/]/.test(path)) {
    // From the root: on Windows, of the session's drive.
    return windows ? `${cwd.slice(0, 2)}${path}` : path
  }
  const sep = cwd.includes('\\') ? '\\' : '/'

  return `${cwd}${sep}${path.replace(/^\.[\\/]/, '')}`
}

export async function resolvePath($: EngineInterface, raw: string): Promise<string> {
  const text = unquote(raw)

  if (/^\d+$/.test(text)) {
    const pick = S.recent[Number(text) - 1]

    if (pick === undefined) {
      throw new Told(t('err.noNumber'))
    }

    return picture(pick.path)
  }
  const home = (await homeFolder($)) ?? ''
  const path = await absolute($, text.startsWith('~') && home !== '' ? `${home}${text.slice(1)}` : text)

  // A network share is refused before anything looks at it: even asking whether it exists could
  // make the system reach another machine.
  if (path !== '' && !isLocalPath(path)) {
    throw new MediaError('local', fileName(path))
  }
  if (path !== '' && isAbsolutePath(path) && (await $.fs.exists(path))) {
    return picture(path)
  }
  // A bare name: the library first, then the newest pictures, then the usual folders. In each, the
  // exact name first; another case only when one file alone matches (`LAKE.PNG` and `lake.png` can
  // both exist outside Windows).
  if (path !== '' && !/[\\/]/.test(path)) {
    const byName = <T>(list: readonly T[], names: (x: T) => string[]): T | undefined => {
      const exact = list.find(x => names(x).includes(path))
      const folded = list.filter(x => names(x).some(n => n.toLowerCase() === path.toLowerCase()))

      return exact ?? (folded.length === 1 ? folded[0] : undefined)
    }
    const match =
      byName(
        S.library.filter(i => isAbsolutePath(i.path)),
        i => [i.name, fileName(i.path)],
      )?.path ??
      byName(S.recent, r => [r.name])?.path ??
      byName(await recentPictures($, 500), r => [r.name])?.path

    if (match !== undefined) {
      return picture(match)
    }
  }
  // The name only: a relative name was made absolute against the session's folder, whose name the
  // user never typed.
  throw new Told(t('err.notFound', { path: fileName(path) }))
}
