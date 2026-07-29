import { readFile, readdir, stat } from 'node:fs/promises'
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
  gzipWarningBytes: 245 * 1024,
  requests: 32,
  chunks: {
    js: { rawBytes: 400 * 1024, gzipBytes: 110 * 1024 },
    css: { rawBytes: 180 * 1024, gzipBytes: 35 * 1024 },
  },
}
const chunks = await Promise.all(
  (await readdir(path.join(distDir, 'assets')))
    .filter((file) => /\.(?:css|js)$/i.test(file))
    .map(async (file) => {
      const contents = await readFile(path.join(distDir, 'assets', file))

      return {
        file,
        type: path.extname(file).slice(1).toLowerCase(),
        rawBytes: contents.byteLength,
        gzipBytes: gzipSync(contents, { level: 9 }).byteLength,
      }
    }),
)
const result = {
  rawBytes,
  gzipBytes,
  requests: files.length,
  assets: referencedAssets,
  largestChunks: chunks
    .toSorted((left, right) => right.gzipBytes - left.gzipBytes)
    .slice(0, 10),
  budgets,
}

console.log(JSON.stringify(result, null, 2))

const failures = []
const warnings = []
if (rawBytes > budgets.rawBytes) {
  failures.push(`initial raw graph ${rawBytes} exceeds ${budgets.rawBytes} bytes`)
}
if (gzipBytes > budgets.gzipBytes) {
  failures.push(`initial gzip graph ${gzipBytes} exceeds ${budgets.gzipBytes} bytes`)
} else if (gzipBytes > budgets.gzipWarningBytes) {
  warnings.push(
    `initial gzip graph ${gzipBytes} exceeds warning threshold ${budgets.gzipWarningBytes} bytes`,
  )
}
if (files.length > budgets.requests) {
  failures.push(`initial request count ${files.length} exceeds ${budgets.requests}`)
}
if (indexHtml.includes('recharts') || indexHtml.includes('dev-lab')) {
  failures.push('login entry graph contains charting or development-lab assets')
}
for (const chunk of chunks) {
  const chunkBudget = budgets.chunks[chunk.type]
  if (!chunkBudget) continue

  if (chunk.rawBytes > chunkBudget.rawBytes) {
    failures.push(
      `${chunk.file} raw size ${chunk.rawBytes} exceeds ${chunkBudget.rawBytes} bytes`,
    )
  }
  if (chunk.gzipBytes > chunkBudget.gzipBytes) {
    failures.push(
      `${chunk.file} gzip size ${chunk.gzipBytes} exceeds ${chunkBudget.gzipBytes} bytes`,
    )
  }
}

for (const warning of warnings) {
  console.warn(`Performance budget warning: ${warning}`)
}

if (failures.length) {
  throw new Error(`Performance budget failed:\n- ${failures.join('\n- ')}`)
}
