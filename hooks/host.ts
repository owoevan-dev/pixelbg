/**
 * The system the session runs on, and the folders that system takes as absolute.
 *
 * The engine does not say which system it is, and the environment cannot be trusted to: a Linux
 * session can carry Windows-style variables (a drive path in LOCALAPPDATA, from WSL or a copied
 * profile), and a folder of that form is a *relative* path there, which would land in the user's
 * project. The session's own working folder says it: a drive or a share on Windows, a path from `/`
 * elsewhere.
 */
import type { EngineInterface } from 'claude-code'

/** An environment variable's name and its value, read by the caller (the engine wants each name written out). */
export type Variable = readonly [name: string, value: string | undefined]

/**
 * Does this session run on Windows? Undefined when its working folder cannot tell (it could not
 * be read, or is of neither form): then nothing should be written, rather than guessed at.
 */
export async function onWindows($: EngineInterface): Promise<boolean | undefined> {
  const cwd = await $.session.cwd().catch(() => '')

  if (/^[A-Za-z]:[\\/]/.test(cwd) || /^[\\/]{2}[^\\/]/.test(cwd)) {
    return true
  }
  if (cwd.startsWith('/')) {
    return false
  }

  return undefined
}

/**
 * The folder, without a trailing slash, if this system takes it as absolute: a drive path on
 * Windows (a drive letter, a colon and a slash; a letter and colon alone mean "the current folder
 * of that drive"), a path from the root elsewhere. On a system that could not be told, none.
 */
export function absoluteFolder(dir: string | undefined, windows: boolean | undefined): string | undefined {
  const trimmed = (dir ?? '').trim()
  const folder = trimmed.replace(/[\\/]+$/, '')

  if (windows === undefined) {
    return undefined
  }
  if (windows) {
    return /^[A-Za-z]:[\\/]/.test(trimmed) ? folder : undefined
  }

  return folder.startsWith('/') && folder.length > 1 ? folder : undefined
}

/** The first of these variables that names an absolute folder on this system. */
export function firstFolder(variables: readonly Variable[], windows: boolean | undefined): { name: string; folder: string } | undefined {
  for (const [name, value] of variables) {
    const folder = absoluteFolder(value, windows)

    if (folder !== undefined) {
      return { name, folder }
    }
  }

  return undefined
}

/** The user's home folder on this system, if the environment names one. */
export async function homeFolder($: EngineInterface): Promise<string | undefined> {
  const windows = await onWindows($)
  const profile: Variable = ['USERPROFILE', await $.env.get('USERPROFILE')]
  const home: Variable = ['HOME', await $.env.get('HOME')]

  return firstFolder(windows ? [profile, home] : [home, profile], windows)?.folder
}
