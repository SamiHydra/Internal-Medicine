import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { gzipSync } from 'node:zlib'

const distDir = path.resolve('dist')
const indexPath = path.join(distDir, 'index.html')
const indexHtml = await readFile(indexPath, 'utf8')
const referencedAssets = [
  ...new Set(
    [...indexHtml.matchAll(/(?:src|href)=["'](\/assets\/[^"'?#]+)/g)].map(
      (match) => match[1],
    ),
  ),
]

const files = [indexPath, ...referencedAssets.map((asset) => path.join(distDir, asset))]
let rawBytes = 0
let gzipBytes = 0

for (const file of files) {
  const contents = await readFile(file)
  rawBytes += (await stat(file)).size
  gzipBytes += gzipSync(contents, { level: 9 }).byteLength
}

const budgets = {
  rawBytes: 900 * 1024,
  gzipBytes: 260 * 1024,
  requests: 32,
}
const result = {
  rawBytes,
  gzipBytes,
  requests: files.length,
  assets: referencedAssets,
  budgets,
}

console.log(JSON.stringify(result, null, 2))

const failures = []
if (rawBytes > budgets.rawBytes) {
  failures.push(`initial raw graph ${rawBytes} exceeds ${budgets.rawBytes} bytes`)
}
if (gzipBytes > budgets.gzipBytes) {
  failures.push(`initial gzip graph ${gzipBytes} exceeds ${budgets.gzipBytes} bytes`)
}
if (files.length > budgets.requests) {
  failures.push(`initial request count ${files.length} exceeds ${budgets.requests}`)
}
if (indexHtml.includes('recharts') || indexHtml.includes('dev-lab')) {
  failures.push('login entry graph contains charting or development-lab assets')
}

if (failures.length) {
  throw new Error(`Performance budget failed:\n- ${failures.join('\n- ')}`)
}
