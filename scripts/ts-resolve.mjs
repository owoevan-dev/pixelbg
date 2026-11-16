// Lets Node load the mod's TypeScript modules for the scripts in this folder: an import
// written without an extension ('./quantize') is tried as a .ts file. Node strips the types.
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export async function resolve(specifier, context, next) {
  if (specifier.startsWith('.') && !/\.[cm]?[jt]s$/.test(specifier) && context.parentURL !== undefined) {
    const url = new URL(`${specifier}.ts`, context.parentURL)

    if (existsSync(fileURLToPath(url))) {
      return next(url.href, context)
    }
  }

  return next(specifier, context)
}
