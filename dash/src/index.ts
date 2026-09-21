import { readFileSync } from 'fs'
import { randomBytes } from 'crypto'
import { homedir } from 'os'
import { join } from 'path'
import { Database } from 'bun:sqlite'

function parsePort(args: string[]): number {
  const i = args.indexOf('--port')
  if (i === -1) return 3000
  const value = Number(args[i + 1])
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error('Invalid port: ' + args[i + 1])
  }
  return value
}

const PORT = parsePort(Bun.argv)
const PUBLIC_DIR = join(import.meta.dir, '..', 'public')
const OPENCODE_DB = join(homedir(), '.local', 'share', 'opencode', 'opencode.db')
const APP_VERSION = (
  JSON.parse(
    readFileSync(join(import.meta.dir, '..', 'package.json'), 'utf-8')
  ) as { version: string }
).version

const TOKEN = randomBytes(18).toString('hex')

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
}

const MAX_DAYS = 730

const DAYS_PER_RANGE: Record<string, number> = {
  '7d': 7,
  '14d': 14,
  '28d': 28,
  '1y': 365,
  all: MAX_DAYS,
}

function daysForRange(range: string | null): number {
  return DAYS_PER_RANGE[range ?? '7d'] ?? 7
}

interface Series {
  labels: string[]
  data: number[]
}

function generateSeries(
  totalDays: number,
  base: number,
  amp: number,
  phase: number
): Series {
  const labels: string[] = []
  const data: number[] = []
  const today = new Date()

  for (let i = 0; i < totalDays; i++) {
    const d = new Date(today)
    d.setDate(d.getDate() - (totalDays - 1 - i))
    labels.push(
      d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    )
    const wave =
      base +
      Math.sin((i + phase) / 14) * amp +
      Math.cos(i / 60) * amp * 0.4 +
      i * 0.04 +
      (Math.random() - 0.5) * amp * 0.5
    data.push(Math.max(0, Math.round(wave)))
  }

  return { labels, data }
}

function sliceSeries(series: Series, days: number): Series {
  return {
    labels: series.labels.slice(-days),
    data: series.data.slice(-days),
  }
}

function generateScatterData(points: number): { x: number; y: number }[] {
  const data: { x: number; y: number }[] = []
  for (let i = 0; i < points; i++) {
    const x = Math.round(Math.random() * 100)
    const y = Math.round(x * 0.8 + Math.random() * 30 - 15)
    data.push({ x, y })
  }
  return data
}

interface TokenRow {
  day: string
  input_tokens: number
  output_tokens: number
}

interface TokenResponse {
  range: string
  labels: string[]
  datasets: { label: string; data: (number | null)[] }[]
}

function localDayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`
}

function loadTokenData(range: string, days: number | null): TokenResponse {
  const db = new Database(OPENCODE_DB, { readonly: true, strict: true })
  try {
    const where = days === null ? '' : 'WHERE time_created >= ?'
    const filter: number[] =
      days === null ? [] : [Date.now() - days * 86_400_000]
    const rows = db
      .query<TokenRow, number[]>(
        `SELECT
           date(time_created / 1000, 'unixepoch', 'localtime') AS day,
           SUM(tokens_input) AS input_tokens,
           SUM(tokens_output) AS output_tokens
         FROM session
         ${where}
         GROUP BY day
         ORDER BY day`
      )
      .all(...filter)

    const byDay = new Map(rows.map((r) => [r.day, r]))

    const today = new Date()
    const end = new Date(today.getFullYear(), today.getMonth(), today.getDate())
    if (rows.length > 0) {
      const last = rows[rows.length - 1].day
      const lastDate = new Date(
        Number(last.slice(0, 4)),
        Number(last.slice(5, 7)) - 1,
        Number(last.slice(8, 10))
      )
      if (lastDate.getTime() > end.getTime()) end.setTime(lastDate.getTime())
    }

    const startStr =
      days === null
        ? rows.length > 0
          ? rows[0].day
          : localDayKey(end)
        : (() => {
            const d = new Date(
              end.getFullYear(),
              end.getMonth(),
              end.getDate() - (days - 1)
            )
            return localDayKey(d)
          })()

    const labels: string[] = []
    const inputTokens: number[] = []
    const outputTokens: number[] = []
    const ratio: (number | null)[] = []

    const cur = new Date(
      Number(startStr.slice(0, 4)),
      Number(startStr.slice(5, 7)) - 1,
      Number(startStr.slice(8, 10))
    )
    while (cur.getTime() <= end.getTime()) {
      const key = localDayKey(cur)
      const row = byDay.get(key)
      const input = row?.input_tokens ?? 0
      const output = row?.output_tokens ?? 0
      labels.push(
        cur.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      )
      inputTokens.push(input)
      outputTokens.push(output)
      ratio.push(
        output === 0 ? null : Math.round((input / output) * 100) / 100
      )
      cur.setDate(cur.getDate() + 1)
    }

    return {
      range,
      labels,
      datasets: [
        { label: 'Input Tokens', data: inputTokens },
        { label: 'Output Tokens', data: outputTokens },
        { label: 'Input/Output Ratio', data: ratio },
      ],
    }
  } finally {
    db.close()
  }
}

const router: Record<string, (params: URLSearchParams) => unknown> = {
  '/api/session-count': (params) => {
    const range = params.get('range') ?? '7d'
    const days = range === 'all' ? null : daysForRange(range)
    const db = new Database(OPENCODE_DB, { readonly: true, strict: true })
    try {
      const where = days === null ? '' : 'WHERE time_created >= ?'
      const filter: number[] =
        days === null ? [] : [Date.now() - days * 86_400_000]
      const row = db
        .query<{ count: number }, number[]>(
          `SELECT COUNT(*) AS count FROM session ${where}`
        )
        .get(...filter)
      return { range, count: row?.count ?? 0 }
    } finally {
      db.close()
    }
  },
  '/api/message-count': (params) => {
    const range = params.get('range') ?? '7d'
    const days = range === 'all' ? null : daysForRange(range)
    const db = new Database(OPENCODE_DB, { readonly: true, strict: true })
    try {
      const where = days === null ? '' : 'WHERE time_created >= ?'
      const filter: number[] =
        days === null ? [] : [Date.now() - days * 86_400_000]
      const row = db
        .query<{ count: number }, number[]>(
          `SELECT COUNT(*) AS count FROM message ${where}`
        )
        .get(...filter)
      return { range, count: row?.count ?? 0 }
    } finally {
      db.close()
    }
  },
  '/api/day-count': () => {
    const db = new Database(OPENCODE_DB, { readonly: true, strict: true })
    try {
      const row = db
        .query<{ earliest: number }>(
          'SELECT MIN(time_created) AS earliest FROM session'
        )
        .get()
      const count = row?.earliest
        ? (() => {
            const start = new Date(row.earliest).setHours(0, 0, 0, 0)
            const today = new Date().setHours(0, 0, 0, 0)
            return Math.max(1, Math.round((today - start) / 86_400_000))
          })()
        : 0
      return { count }
    } finally {
      db.close()
    }
  },
  '/api/line': (params) => {
    const days = daysForRange(params.get('range'))
    const revenue = sliceSeries(generateSeries(MAX_DAYS, 55, 18, 0), days)
    const expenses = sliceSeries(generateSeries(MAX_DAYS, 35, 12, 9), days)
    return {
      range: params.get('range') ?? '7d',
      labels: revenue.labels,
      datasets: [
        { label: 'Revenue', data: revenue.data },
        { label: 'Expenses', data: expenses.data },
      ],
    }
  },
  '/api/bar': (params) => ({
    labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    datasets: [
      { label: 'Sales', data: [120, 190, 80, 150, 220, 300, 170] },
      { label: 'Returns', data: [10, 25, 5, 15, 30, 40, 12] },
    ],
  }),
  '/api/pie': (params) => ({
    labels: ['Desktop', 'Mobile', 'Tablet', 'Other'],
    data: [45, 35, 15, 5],
  }),
  '/api/area': (params) => {
    const days = daysForRange(params.get('range'))
    const active = sliceSeries(generateSeries(MAX_DAYS, 70, 22, 0), days)
    const fresh = sliceSeries(generateSeries(MAX_DAYS, 35, 10, 5), days)
    return {
      range: params.get('range') ?? '7d',
      labels: active.labels,
      datasets: [
        { label: 'Active Users', data: active.data },
        { label: 'New Users', data: fresh.data },
      ],
    }
  },
  '/api/scatter': (params) => ({
    label: 'Performance',
    data: generateScatterData(30),
  }),
  '/api/tokens': (params) => {
    const range = params.get('range') ?? '7d'
    return loadTokenData(range, range === 'all' ? null : daysForRange(range))
  },
  '/api/tool-usage': (params) => {
    const range = params.get('range') ?? '7d'
    const days = range === 'all' ? null : daysForRange(range)
    const db = new Database(OPENCODE_DB, { readonly: true, strict: true })
    try {
      const where =
        days === null
          ? `WHERE data->>'$.type' = 'tool'`
          : `WHERE data->>'$.type' = 'tool' AND time_created >= ?`
      const filter: number[] = days === null ? [] : [Date.now() - days * 86_400_000]
      const rows = db
        .query<{ tool: string; toolcount: number }, number[]>(
          `SELECT data->>'$.tool' AS tool, COUNT(*) AS toolcount
           FROM part
           ${where}
           GROUP BY tool
           ORDER BY toolcount DESC, tool ASC`
        )
        .all(...filter)
      return { range, labels: rows.map((r) => r.tool), data: rows.map((r) => r.toolcount) }
    } finally {
      db.close()
    }
  },
}

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url)
    const { pathname } = url

    const token = url.searchParams.get('token')
    const gated =
      pathname === '/' ||
      pathname === '/index.html' ||
      pathname.startsWith('/api/')
    if (gated && token !== TOKEN) {
      return new Response(
        `Unauthorized. Open the dashboard with the token URL printed at startup (http://localhost:${PORT}/?token=...)`,
        { status: 401 }
      )
    }

    if (pathname === '/' || pathname === '/index.html') {
      const html = readFileSync(join(PUBLIC_DIR, 'index.html'), 'utf-8')
        .replace('{{VERSION}}', APP_VERSION)
      return new Response(html, { headers: { 'Content-Type': 'text/html' } })
    }

    const handler = router[pathname]
    if (handler) {
      return Response.json(handler(url.searchParams))
    }

    const ext = pathname.substring(pathname.lastIndexOf('.'))
    const mime = MIME[ext]
    if (mime) {
      try {
        const file = readFileSync(join(PUBLIC_DIR, pathname))
        return new Response(file, {
          headers: {
            'Content-Type': mime,
            'Cache-Control': 'no-cache',
          },
        })
      } catch {
        return new Response('Not Found', { status: 404 })
      }
    }

    return new Response('Not Found', { status: 404 })
  },
})

console.log(`Dashboard running at http://localhost:${PORT}/?token=${TOKEN}`)
