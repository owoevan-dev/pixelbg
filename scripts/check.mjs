// Release checks for pixelbg, run before every commit and in CI:
//
//   node scripts/check.mjs
//
// It reads the files git would publish (tracked, plus new ones not ignored) and checks:
// - privacy, in every line, every file name, every commit's names, addresses and message, and
//   every file version the history holds (a file deleted later is still published):
//   no user folders or drive paths, e-mail addresses (but GitHub's no-reply ones), keys, tokens,
//   webhooks or secrets written into settings, private keys, private network addresses, local or
//   internal hosts, session or hardware ids, profile folders, hidden right-to-left characters, or
//   this computer's own names (its login, computer and home folder, unless generic); new commits
//   use a no-reply address; and, when the git-ignored file `.private-terms` exists, none of the
//   words listed in it (one per line), which must stay unpublished;
// - files: known types only, pictures only where pictures go, no picture metadata, SVG pictures
//   of plain shapes and text only, sizes;
//   text in UTF-8 with LF line ends and a final newline;
// - the manifests: names, version, icon, install line and changelog agree;
// - links between the Markdown files resolve;
// - the code: no network, console or debugger; programs started only where expected; every
//   sentence in text.ts used.
//
// Exit status 0 when everything passes, 1 otherwise. It changes nothing.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { homedir, hostname, userInfo } from 'node:os'
import { basename, dirname, join, posix } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const problems = []
const fail = (file, what) => problems.push(`${file}: ${what}`)
const read = file => readFileSync(join(root, file))
const text = file => {
  if (!existsSync(join(root, file))) {
    fail(file, 'missing')

    return ''
  }

  return read(file).toString('utf8')
}

const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root })
  .toString('utf8')
  .split('\0')
  .filter(file => file !== '' && existsSync(join(root, file)))
  .sort()

// ---------------------------------------------------------------------------------------------
// Files

const TEXT_TYPES = /\.(ts|js|mjs|json|md|yml|svg)$/
const NAMED_TEXT = new Set(['LICENSE', '.gitignore', '.gitattributes'])
const PICTURE_FOLDERS = ['assets/', 'docs/images/']
const MAX_TEXT = 1024 * 1024
const MAX_PICTURE = 512 * 1024
/** PNG chunks that carry pixels and how to show them; text and EXIF chunks could carry anything. */
const PNG_CHUNKS = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'sRGB', 'gAMA', 'pHYs'])
const utf8 = new TextDecoder('utf-8', { fatal: true })

function pngInfo(file, bytes = read(file)) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10]

  if (!signature.every((b, i) => bytes[i] === b)) {
    fail(file, 'not a PNG file')

    return undefined
  }
  let at = 8
  let size

  while (at + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(at)
    const type = bytes.toString('latin1', at + 4, at + 8)

    if (!PNG_CHUNKS.has(type)) {
      fail(file, `PNG holds a "${type}" chunk (metadata); write pictures without it`)
    }
    if (type === 'IHDR') {
      size = { w: bytes.readUInt32BE(at + 8), h: bytes.readUInt32BE(at + 12) }
    }
    at += 12 + length
  }

  return size
}

const texts = []

for (const file of files) {
  const name = posix.basename(file)
  const bytes = read(file)

  if (file.endsWith('.png')) {
    if (!PICTURE_FOLDERS.some(folder => file.startsWith(folder))) {
      fail(file, `pictures belong in ${PICTURE_FOLDERS.join(' or ')}`)
    }
    if (bytes.length > MAX_PICTURE) {
      fail(file, `${bytes.length} bytes; pictures stay under ${MAX_PICTURE}`)
    }
    pngInfo(file)
    continue
  }
  if (file.endsWith('.svg') && !PICTURE_FOLDERS.some(folder => file.startsWith(folder))) {
    fail(file, `pictures belong in ${PICTURE_FOLDERS.join(' or ')}`)
  }
  if (!TEXT_TYPES.test(file) && !NAMED_TEXT.has(name)) {
    fail(file, 'a type of file this repository does not ship')
    continue
  }
  if (bytes.length > MAX_TEXT) {
    fail(file, `${bytes.length} bytes; text files stay under ${MAX_TEXT}`)
  }
  let content

  try {
    content = utf8.decode(bytes)
  } catch {
    fail(file, 'not valid UTF-8')
    continue
  }
  if (content.charCodeAt(0) === 0xfeff) {
    fail(file, 'starts with a byte-order mark')
  }
  if (content.includes('\r')) {
    fail(file, 'has CR line ends (LF only)')
  }
  if (content.length > 0 && !content.endsWith('\n')) {
    fail(file, 'does not end with a newline')
  }
  if (file.endsWith('.svg') && /<script|<style|<foreignObject|<image|\shref=|xlink:|url\(|\son[a-z]+=/i.test(content)) {
    fail(file, 'an SVG with scripts, styles, links or embedded content; pictures here are plain shapes and text')
  }
  texts.push([file, content])
}

// ---------------------------------------------------------------------------------------------
// Privacy

// Patterns are put together from pieces, so this file does not match its own rules.
const any = (...parts) => parts.join('')
const PRIVACY = [
  // With either slash, anywhere in the line: after a drive, a server share, a file URL or a relative path.
  ['a user folder', new RegExp(any('[\\\\/](Users|home)', '[\\\\/]+[A-Za-z0-9._-]'))],
  // Any drive letter, either case, either slash; not the end of a URL's scheme.
  ['a drive path', new RegExp(any('(?<![A-Za-z0-9])[A-Za-z]', ':[\\\\/](?!/)'))],
  ['an e-mail address', /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g],
  ['a session or device id', /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i],
  ['a hardware address', /\b[0-9A-Fa-f]{2}([:-])[0-9A-Fa-f]{2}(\1[0-9A-Fa-f]{2}){4}\b/],
  [
    'a key or token',
    new RegExp(
      any(
        '\\b(sk-', '[A-Za-z0-9_-]{16,}',
        '|gh[pousr]_', '[A-Za-z0-9]{30,}',
        '|github_', 'pat_[A-Za-z0-9_]{20,}',
        '|A[KS]', 'IA[0-9A-Z]{16}',
        '|AI', 'za[0-9A-Za-z_-]{35}',
        '|xox[abprs]-', '[A-Za-z0-9-]{10,}',
        '|npm_', '[A-Za-z0-9]{36}',
        '|ey', 'J[A-Za-z0-9_-]{10,}\\.ey', 'J[A-Za-z0-9_-]{10,})',
      ),
    ),
  ],
  ['a webhook address', new RegExp(any('hooks\\.slack', '\\.com/services/|discord(app)?\\.com/api/', 'webhooks/'), 'i')],
  ['a secret written into a setting', new RegExp(any('\\b(api[_-]?key|secret|token|passw(or)?d)', '[\'"]?\\s*[:=]\\s*[\'"]?[A-Za-z0-9_+/=-]{12,}'), 'i')],
  ['a private key', new RegExp(any('-----BEGIN [A-Z ]*', 'PRIVATE KEY-----'))],
  ['a private network address', /\b(10\.\d{1,3}|192\.168|172\.(1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b/],
  ['a local or internal host', new RegExp(any('\\blocal', 'host\\b|\\b127\\.0\\.0', '\\.1\\b|[A-Za-z0-9-]\\.(internal|corp|lan|intranet)\\b'), 'i')],
  ['a folder of a user profile', new RegExp(any('App', 'Data[\\\\/]|\\.claude[\\\\/]', 'projects'), 'i')],
]
/** Addresses that may appear in files: GitHub's no-reply ones, which say nothing about the person. */
const ALLOWED_EMAIL = /^\d+\+[A-Za-z0-9-]+@users\.noreply\.github\.com$/
/** And in commits: those, GitHub's own, and the co-author line of commits made with Claude Code. */
const COMMIT_EMAILS = [ALLOWED_EMAIL, new RegExp(any('^noreply', '@github\\.com$')), new RegExp(any('^noreply', '@anthropic\\.com$'))]
/** The tests' pretend drive. */
const TEST_DRIVE = new RegExp(any('^[Tt]', ':[\\\\/]'))
/** Characters that make text read differently from how it runs (right-to-left overrides and isolates). */
const HIDDEN = /[\u202A-\u202E\u2066-\u2069]/

const privateTermsFile = join(root, '.private-terms')
const privateTerms = existsSync(privateTermsFile)
  ? readFileSync(privateTermsFile, 'utf8')
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line !== '' && !line.startsWith('#'))
  : undefined

if (privateTerms !== undefined) {
  let ignored = true

  try {
    execFileSync('git', ['check-ignore', '-q', '.private-terms'], { cwd: root, stdio: 'ignore' })
  } catch {
    ignored = false
  }
  if (!ignored || files.includes('.private-terms')) {
    fail('.private-terms', 'would be published; it must stay git-ignored')
  }
}

// This computer's own names, when they say something about whoever runs the check: the login,
// the computer, the home folder's last part. A CI runner's are generic, and skipped.
const GENERIC_NAMES = new Set(['user', 'users', 'admin', 'administrator', 'owner', 'root', 'runner', 'runneradmin', 'home', 'default', 'guest', 'pc', 'desktop', 'laptop', any('local', 'host'), 'ubuntu', 'mac', 'workgroup'])
const machineNames = (() => {
  const found = [process.env.USERNAME, process.env.USER, process.env.LOGNAME, process.env.COMPUTERNAME, process.env.HOSTNAME, process.env.USERDOMAIN, hostname(), basename(homedir())]

  try {
    found.push(userInfo().username)
  } catch {
    // No user record (some containers): the environment's names are enough.
  }

  return [...new Set(found.filter(name => typeof name === 'string').map(name => name.trim()))]
    .filter(name => name.length >= 3 && !GENERIC_NAMES.has(name.toLowerCase()))
    .map(name => new RegExp(`(?<![A-Za-z0-9])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9])`, 'i'))
})()

/** What one line gives away, if anything. `addresses`: the e-mail addresses it may hold. */
function exposures(line, { file = '', addresses = [ALLOWED_EMAIL] } = {}) {
  const found = []

  for (const [what, pattern] of PRIVACY) {
    if (pattern.flags.includes('g')) {
      for (const match of line.matchAll(pattern)) {
        if (!addresses.some(allowed => allowed.test(match[0]))) {
          found.push(`holds ${what}`)
        }
      }
      continue
    }
    // Every match on the line: a test's pretend drive excuses only itself, not a real path after it.
    const matches = [...line.matchAll(new RegExp(pattern.source, `${pattern.flags}g`))]

    if (matches.some(match => !(what === 'a drive path' && file.startsWith('tests/') && TEST_DRIVE.test(line.slice(match.index))))) {
      found.push(`holds ${what}`)
    }
  }
  if ((privateTerms ?? []).some(term => line.toLowerCase().includes(term.toLowerCase()))) {
    found.push('holds a word listed in .private-terms')
  }
  if (machineNames.some(name => name.test(line))) {
    found.push("holds a name of this computer or its user")
  }
  if (HIDDEN.test(line)) {
    found.push('holds a hidden right-to-left control character')
  }

  return found
}

// The files' names, then what is in them.
for (const file of files) {
  for (const what of exposures(file, { file })) {
    fail(file, `its name ${what.replace('holds', 'has')}`)
  }
}
for (const [file, content] of texts) {
  content.split('\n').forEach((line, i) => {
    for (const what of exposures(line, { file })) {
      fail(`${file}:${i + 1}`, what)
    }
  })
}

// What git publishes besides the files: who made each commit, and its message.
const git = (...args) => {
  try {
    return execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString('utf8')
  } catch {
    return undefined
  }
}
const configured = (git('config', 'user.email') ?? '').trim()

if (configured !== '' && !ALLOWED_EMAIL.test(configured)) {
  fail('git config user.email', 'new commits would carry an address that is not a GitHub no-reply one')
}
if (git('rev-parse', '--verify', '--quiet', 'HEAD') !== undefined) {
  // Every branch and tag, not only the one checked out: any of them can be pushed. A history that
  // cannot be read fails the check rather than passing it unread.
  const log = git('log', '--all', '--format=%h%x1f%an%x1f%ae%x1f%cn%x1f%ce%x1f%B%x1e')
  const paths = git('log', '--all', '--name-only', '--format=')

  if (log === undefined || paths === undefined) {
    fail('git', 'the history could not be read, so it was not checked')
  }
  // Every path a commit ever held: a file renamed later still shows its old name in that commit.
  for (const path of new Set((paths ?? '').split('\n').filter(Boolean))) {
    for (const what of exposures(path, { file: path })) {
      fail(`history ${path}`, `a committed name ${what.replace('holds', 'has')}`)
    }
  }

  for (const record of (log ?? '').split('\x1e').map(r => r.trim()).filter(r => r !== '')) {
    const [hash, author, authorEmail, committer, committerEmail, message = ''] = record.split('\x1f')

    for (const [who, email] of [[author, authorEmail], [committer, committerEmail]]) {
      if (!COMMIT_EMAILS.some(allowed => allowed.test(email ?? ''))) {
        fail(`commit ${hash}`, `made with an address that is not a no-reply one`)
      }
      for (const what of exposures(who ?? '')) {
        fail(`commit ${hash}`, `its author or committer name ${what.replace('holds', 'has')}`)
      }
    }
    message.split('\n').forEach((line, i) => {
      for (const what of exposures(line, { addresses: COMMIT_EMAILS })) {
        fail(`commit ${hash} message line ${i + 1}`, what)
      }
    })
  }

  // Every version of every file the history holds, not only the ones checked out: a file deleted
  // or changed in a later commit is still published in the commits that held it. Versions equal
  // to a file checked out now were read above.
  const run = (args, input) => execFileSync('git', args, { cwd: root, input, maxBuffer: 256 * 1024 * 1024 })
  const checkedOut = new Set(run(['hash-object', '--stdin-paths'], files.join('\n')).toString('utf8').split('\n').filter(Boolean))
  const named = new Map()

  // Each line is an object id, then its path for a file or folder (commits have none).
  for (const line of run(['rev-list', '--objects', '--all']).toString('utf8').split('\n')) {
    const space = line.indexOf(' ')

    if (space > 0 && space < line.length - 1) {
      named.set(line.slice(0, space), line.slice(space + 1))
    }
  }
  const kinds = run(['cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)'], [...named.keys()].join('\n')).toString('utf8').split('\n').filter(Boolean)

  for (const line of kinds) {
    const [sha, type, size] = line.split(' ')
    const path = named.get(sha) ?? ''

    if (type !== 'blob' || checkedOut.has(sha)) {
      continue
    }
    const where = `history ${path} (${sha.slice(0, 7)})`
    const bytes = run(['cat-file', 'blob', sha])

    for (const what of exposures(path, { file: path })) {
      fail(where, `its name ${what.replace('holds', 'has')}`)
    }
    if (path.endsWith('.png')) {
      pngInfo(where, bytes)
      continue
    }
    if (!TEXT_TYPES.test(path) && !NAMED_TEXT.has(posix.basename(path))) {
      fail(where, 'a type of file this repository does not ship')
      continue
    }
    if (Number(size) > MAX_TEXT) {
      fail(where, `${size} bytes; text files stay under ${MAX_TEXT}`)
      continue
    }
    bytes.toString('utf8').split('\n').forEach((text, i) => {
      for (const what of exposures(text, { file: path })) {
        fail(`${where}:${i + 1}`, what)
      }
    })
  }
}

// ---------------------------------------------------------------------------------------------
// Manifests

const json = file => {
  try {
    return JSON.parse(text(file))
  } catch (error) {
    fail(file, `not valid JSON (${error.message})`)

    return {}
  }
}
const plugin = json('.claude-plugin/plugin.json')
const market = json('.claude-plugin/marketplace.json')
const hooks = json('hooks/hooks.json')
const repo = /^https:\/\/github\.com\/([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)$/.exec(plugin.homepage ?? '')

if (plugin.name !== 'pixelbg') {
  fail('.claude-plugin/plugin.json', 'name is not pixelbg')
}
if (!/^\d+\.\d+\.\d+$/.test(plugin.version ?? '')) {
  fail('.claude-plugin/plugin.json', 'version is not x.y.z')
}
if (repo === null || plugin.repository !== plugin.homepage) {
  fail('.claude-plugin/plugin.json', 'homepage and repository should be the same GitHub repository')
}
if (market.plugins?.length !== 1 || market.plugins[0].name !== plugin.name || market.plugins[0].source !== './') {
  fail('.claude-plugin/marketplace.json', 'should list exactly this plugin, from ./')
}
if (market.name !== plugin.name) {
  fail('.claude-plugin/marketplace.json', 'marketplace name should match the plugin')
}
for (const module of hooks.modules ?? []) {
  if (!files.includes(posix.join('hooks', module))) {
    fail('hooks/hooks.json', `module ${module} is not in the repository`)
  }
}
const icon = typeof plugin.icon === 'string' ? posix.normalize(plugin.icon) : ''

if (!files.includes(icon)) {
  fail('.claude-plugin/plugin.json', `icon ${plugin.icon} is not in the repository`)
} else {
  const size = pngInfo(icon)

  if (size === undefined || size.w !== size.h || size.w < 512 || size.w > 2048) {
    fail(icon, 'the icon should be a square PNG, 512 to 2048 pixels')
  }
}
if (!new RegExp(`^## \\[?${(plugin.version ?? '').replaceAll('.', '\\.')}\\]?`, 'm').test(text('CHANGELOG.md'))) {
  fail('CHANGELOG.md', `no section for version ${plugin.version}`)
}
const install = repo === null ? '' : `/plugin install ${plugin.name} --marketplace ${repo[1]}/${repo[2]}`

if (!files.includes('README.md')) {
  fail('README.md', 'missing')
} else if (!text('README.md').includes(install)) {
  fail('README.md', `does not give the install line: ${install}`)
}

// ---------------------------------------------------------------------------------------------
// Links

for (const [file, content] of texts.filter(([f]) => f.endsWith('.md'))) {
  const targets = [...content.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g), ...content.matchAll(/<img [^>]*src="([^"]+)"/g), ...content.matchAll(/srcset="([^"]+)"/g)].map(m => m[1])

  for (const target of targets) {
    if (/^(https?:|mailto:|#)/.test(target)) {
      continue
    }
    const path = posix.normalize(posix.join(posix.dirname(file), decodeURI(target.split('#')[0])))

    if (!files.includes(path) && !files.some(f => f.startsWith(`${path}/`))) {
      fail(file, `links to ${target}, which is not in the repository`)
    }
  }
}
// ---------------------------------------------------------------------------------------------
// Code

const code = texts.filter(([f]) => f.startsWith('hooks/') && f.endsWith('.ts'))
const STARTS_PROGRAMS = new Set(['hooks/media.ts', 'hooks/text.ts'])

for (const [file, content] of code) {
  if (/\bconsole\.|\bdebugger\b/.test(content)) {
    fail(file, 'console or debugger left in')
  }
  if (/\bfetch\(|\$\.http\b|XMLHttpRequest|WebSocket/.test(content)) {
    fail(file, 'reaches the network; pixelbg never does')
  }
  if (/\$\.process\./.test(content) && !STARTS_PROGRAMS.has(file)) {
    fail(file, `starts a program; only ${[...STARTS_PROGRAMS].join(' and ')} may`)
  }
}
const strings = text('hooks/text.ts')
const english = text('hooks/strings/en.ts')
const keys = [...english.slice(0, english.indexOf('export type Key')).matchAll(/^ {2}(?:'([^']+)'|([A-Za-z]+)):/gm)].map(m => m[1] ?? m[2])
const kinds = /readonly kind: ([^\n]+)/.exec(text('hooks/media.ts'))?.[1].match(/'([a-z]+)'/g)?.map(k => `err.${k.slice(1, -1)}`) ?? []
const elsewhere = code.filter(([f]) => f !== 'hooks/text.ts' && !f.startsWith('hooks/strings/')).map(([, c]) => c).join('\n')

if (keys.length < 50) {
  fail('hooks/strings/en.ts', `found only ${keys.length} sentences; has the table moved?`)
}
for (const key of keys) {
  if (!elsewhere.includes(`'${key}'`) && !strings.includes(`t('${key}'`) && !kinds.includes(key)) {
    fail('hooks/strings/en.ts', `the sentence "${key}" is never used`)
  }
}

// make-colors.js is Anthropic's file, copied unchanged: its body must still match the hash in
// its header.
{
  const vendored = text('hooks/make-colors.js')
  const want = /^\/\/ body-sha256: ([0-9a-f]{64})$/m.exec(vendored)?.[1]
  const body = vendored.split('\n').slice(4).join('\n')
  const got = createHash('sha256').update(body).digest('hex')

  if (want === undefined || got !== want) {
    fail('hooks/make-colors.js', 'changed from the copy the plugin-authoring skill ships (body hash differs)')
  }
  // Its declarations, also Anthropic's, copied unchanged (with LF line endings).
  const declarations = text('hooks/make-colors.d.ts').replace(/\r\n/g, '\n')

  if (createHash('sha256').update(declarations).digest('hex') !== '8c24d70588648581434441047ac2215d6115c01a20a3197bade8a6c4b722a146') {
    fail('hooks/make-colors.d.ts', 'changed from the copy the plugin-authoring skill ships (hash differs)')
  }
}

// ---------------------------------------------------------------------------------------------

if (privateTerms === undefined) {
  console.log('note: no .private-terms file here, so only the general privacy patterns were checked')
}
if (problems.length > 0) {
  console.log(`pixelbg check: ${problems.length} problem(s) in ${files.length} files\n`)
  for (const problem of problems) {
    console.log(`  ${problem}`)
  }
  process.exit(1)
}
console.log(`pixelbg check: ${files.length} files, every check passed`)
