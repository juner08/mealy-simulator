import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'

/**
 * Turns `src/sw-template.js` into `dist/sw.js`.
 *
 * Kept separate from vite.config.js so verify-pwa.mjs can exercise the exact
 * same hashing the build uses.
 */

const PRECACHE_SKIP = (path) =>
  path === 'sw.js' || path.endsWith('.map') || path.startsWith('.')

/** Every deployable file under `dir`, as './relative/path' strings. */
export function precacheList(dir) {
  const out = []
  const walk = (current) => {
    for (const entry of readdirSync(current)) {
      const abs = join(current, entry)
      if (statSync(abs).isDirectory()) walk(abs)
      else out.push(relative(dir, abs).split(sep).join('/'))
    }
  }
  walk(dir)
  return out
    .filter((path) => !PRECACHE_SKIP(path))
    .sort()
    .map((path) => `./${path}`)
}

/**
 * Content hash over the deployable files. Any change to any asset — including
 * the HTML — produces a new version, which means a new cache name, which means
 * the previous cache is deleted on activate. That is what stops a user from
 * being pinned to an old build.
 */
export function buildVersion(dir, files = precacheList(dir)) {
  const hash = createHash('sha256')
  for (const file of files) {
    hash.update(file)
    hash.update(readFileSync(resolve(dir, file.slice(2))))
  }
  return hash.digest('hex').slice(0, 12)
}

export function renderServiceWorker(template, version, files) {
  return template
    .replace('__BUILD_VERSION__', version)
    .replace('__PRECACHE_MANIFEST__', files.map((f) => JSON.stringify(f)).join(', '))
}

export function writeServiceWorker({ root, outDir, template = 'src/sw-template.js' }) {
  const dir = resolve(root, outDir)
  const files = precacheList(dir)
  const version = buildVersion(dir, files)
  const source = renderServiceWorker(
    readFileSync(resolve(root, template), 'utf8'),
    version,
    files,
  )
  writeFileSync(resolve(dir, 'sw.js'), source)
  return { version, files, dir }
}
