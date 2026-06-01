import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'

const root = process.cwd()
const targets = new Set(['.ts', '.tsx', '.js', '.jsx'])
const ignoreDirs = new Set(['node_modules', '.next', 'out', 'dist'])

const offenders = []

function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (ignoreDirs.has(name)) continue
    const full = join(dir, name)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      walk(full)
      continue
    }
    if (!targets.has(extname(name))) continue

    const content = readFileSync(full, 'utf8')
    const firstLine = content.split(/\r?\n/, 1)[0]?.replace(/^\uFEFF/, '') || ''
    if (firstLine.startsWith('diff --git ')) {
      offenders.push(full.replace(`${root}/`, ''))
    }
  }
}

walk(root)

if (offenders.length > 0) {
  console.error('Found git patch headers committed as source code in:')
  for (const file of offenders) {
    console.error(`- ${file}`)
  }
  process.exit(1)
}

console.log('No accidental git patch headers found in source files.')
