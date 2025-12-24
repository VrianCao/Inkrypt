import crypto from 'node:crypto'
import fs from 'node:fs'

function parseArgs(argv) {
  /** @type {Record<string, string | boolean | undefined> & { _: string[] }} */
  const out = { _: [] }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith('--')) {
      out._.push(arg)
      continue
    }

    const key = arg.slice(2)
    const next = argv[i + 1]
    if (next !== undefined && !next.startsWith('--')) {
      out[key] = next
      i++
      continue
    }
    out[key] = true
  }

  return out
}

function githubOutput(key, value) {
  const outFile = process.env.GITHUB_OUTPUT
  if (!outFile) return
  const str = String(value ?? '')
  const delimiter = `EOF_${crypto.randomUUID().replace(/-/g, '')}`
  fs.appendFileSync(outFile, `${key}<<${delimiter}\n${str}\n${delimiter}\n`)
}

function normalizeDomain(raw) {
  if (!raw) throw new Error('DOMAIN is required')
  const input = String(raw).trim()
  if (!input) throw new Error('DOMAIN is required')

  if (input.includes('://')) {
    const url = new URL(input)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('DOMAIN must be a hostname or a http(s) URL')
    }
    if (url.pathname !== '/' || url.search || url.hash) {
      throw new Error('DOMAIN URL must not include path/query/hash')
    }
    return normalizeDomain(url.hostname)
  }

  if (input.includes('/') || input.includes('?') || input.includes('#')) {
    throw new Error('DOMAIN must not include path/query/hash')
  }
  if (input.includes(':')) {
    throw new Error('DOMAIN must not include a port')
  }

  const domain = input.replace(/\.+$/, '').toLowerCase()
  if (!domain.includes('.')) throw new Error('DOMAIN must contain at least one dot, e.g. notes.example.com')
  return domain
}

class CloudflareApiError extends Error {
  /** @param {{ message: string; status: number; url: string; errors?: any; bodyText?: string }} info */
  constructor(info) {
    super(info.message)
    this.name = 'CloudflareApiError'
    this.status = info.status
    this.url = info.url
    this.errors = info.errors
    this.bodyText = info.bodyText
  }
}

function getToken(args) {
  const token = String(args.token ?? process.env.CLOUDFLARE_API_TOKEN ?? '').trim()
  if (!token) throw new Error('Missing CLOUDFLARE_API_TOKEN (or --token)')
  return token
}

/**
 * @param {string} token
 * @param {{ method: string; path: string; query?: Record<string,string|number|boolean|undefined>; body?: any }} req
 */
async function cf(token, req) {
  const url = new URL(`https://api.cloudflare.com/client/v4${req.path}`)
  for (const [k, v] of Object.entries(req.query ?? {})) {
    if (v === undefined) continue
    url.searchParams.set(k, String(v))
  }

  /** @type {Record<string,string>} */
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'User-Agent': 'inkrypt-deploy/1.0',
  }

  const resp = await fetch(url, {
    method: req.method,
    headers,
    body: req.body === undefined ? undefined : JSON.stringify(req.body),
  })

  const bodyText = await resp.text()
  let data
  try {
    data = bodyText ? JSON.parse(bodyText) : null
  } catch {
    throw new CloudflareApiError({
      message: `Cloudflare API returned non-JSON response (${resp.status})`,
      status: resp.status,
      url: url.toString(),
      bodyText,
    })
  }

  if (!resp.ok || data?.success === false) {
    const errorMessage =
      data?.errors?.[0]?.message ??
      data?.messages?.[0]?.message ??
      `Cloudflare API request failed (${resp.status})`

    throw new CloudflareApiError({
      message: errorMessage,
      status: resp.status,
      url: url.toString(),
      errors: data?.errors,
      bodyText,
    })
  }

  return data?.result
}

async function resolveZone({ token, domain }) {
  const normalized = normalizeDomain(domain)
  const labels = normalized.split('.')
  if (labels.length < 2) throw new Error('DOMAIN must contain at least one dot')

  const candidates = []
  for (let i = 0; i <= labels.length - 2; i++) {
    candidates.push(labels.slice(i).join('.'))
  }

  for (const name of candidates) {
    const result = await cf(token, {
      method: 'GET',
      path: '/zones',
      query: { name, status: 'active', per_page: 50, page: 1 },
    })

    const zone = Array.isArray(result) && result.find((z) => z?.name === name)
    if (!zone) continue

    return {
      zone_id: zone.id,
      zone_name: zone.name,
      account_id: zone.account?.id,
    }
  }

  throw new Error(`No active Cloudflare zone found for DOMAIN=${normalized}. Is it added to Cloudflare and does the token have Zone:Read?`)
}

async function ensureDnsA({ token, zoneId, recordName, ip, proxied, force }) {
  const records = await cf(token, {
    method: 'GET',
    path: `/zones/${zoneId}/dns_records`,
    query: { name: recordName, per_page: 100, page: 1 },
  })

  const existing = Array.isArray(records) ? records : []

  if (existing.length > 1) {
    throw new Error(`Multiple DNS records exist for ${recordName}. Refusing to continue.`)
  }

  const desired = {
    type: 'A',
    name: recordName,
    content: ip,
    ttl: 1,
    proxied: proxied ?? true,
  }

  if (existing.length === 0) {
    const created = await cf(token, { method: 'POST', path: `/zones/${zoneId}/dns_records`, body: desired })
    return { action: 'created', id: created?.id }
  }

  const record = existing[0]
  const matches =
    record?.type === desired.type &&
    String(record?.name).toLowerCase() === String(desired.name).toLowerCase() &&
    String(record?.content) === String(desired.content) &&
    Boolean(record?.proxied) === Boolean(desired.proxied)

  if (matches) return { action: 'unchanged', id: record.id }

  if (!force) {
    throw new Error(
      `DNS record for ${recordName} exists but does not match expected A -> ${ip}. Set FORCE_TAKEOVER_DNS=true to override.`,
    )
  }

  const updated = await cf(token, {
    method: 'PUT',
    path: `/zones/${zoneId}/dns_records/${record.id}`,
    body: desired,
  })
  return { action: 'updated', id: updated?.id ?? record.id }
}

async function ensureWorkerRoutes({ token, zoneId, workerName, patterns, force }) {
  const routes = await cf(token, { method: 'GET', path: `/zones/${zoneId}/workers/routes` })
  const list = Array.isArray(routes) ? routes : []

  for (const pattern of patterns) {
    const existing = list.find((r) => String(r?.pattern).toLowerCase() === String(pattern).toLowerCase())

    if (!existing) {
      await cf(token, {
        method: 'POST',
        path: `/zones/${zoneId}/workers/routes`,
        body: { pattern, script: workerName },
      })
      continue
    }

    if (existing.script === workerName) continue

    if (!force) {
      throw new Error(
        `Worker route ${pattern} is already bound to ${existing.script}. Set FORCE_TAKEOVER_ROUTES=true to override.`,
      )
    }

    await cf(token, {
      method: 'PUT',
      path: `/zones/${zoneId}/workers/routes/${existing.id}`,
      body: { pattern, script: workerName },
    })
  }
}

function parseBool(v) {
  if (typeof v === 'boolean') return v
  if (v === undefined) return false
  const s = String(v).trim().toLowerCase()
  if (!s) return false
  return ['1', 'true', 'yes', 'y', 'on'].includes(s)
}

function usage() {
  return `
Usage:
  node deploy/cf-api.mjs resolve-zone --domain <domain>
  node deploy/cf-api.mjs ensure-dns-a --zone-id <id> --name <fqdn> [--ip 192.0.2.1] [--proxied true|false] [--force]
  node deploy/cf-api.mjs ensure-worker-routes --zone-id <id> --worker-name <name> --route <pattern> [--route <pattern> ...] [--force]

Auth:
  Set env CLOUDFLARE_API_TOKEN or pass --token <token>
`.trim()
}

const args = parseArgs(process.argv.slice(2))
const cmd = args._[0]
if (!cmd) {
  process.stderr.write(`${usage()}\n`)
  process.exit(2)
}

const token = getToken(args)

if (cmd === 'resolve-zone') {
  const domain = normalizeDomain(args.domain ?? process.env.DOMAIN ?? process.env.INKRYPT_DOMAIN)
  const zone = await resolveZone({ token, domain })
  githubOutput('zone_id', zone.zone_id)
  githubOutput('zone_name', zone.zone_name)
  githubOutput('account_id', zone.account_id)
  process.stdout.write(`Resolved zone for ${domain}: ${JSON.stringify(zone)}\n`)
  process.exit(0)
}

if (cmd === 'ensure-dns-a') {
  const zoneId = String(args['zone-id'] ?? '').trim()
  const name = normalizeDomain(args.name ?? args.domain ?? process.env.DOMAIN ?? process.env.INKRYPT_DOMAIN)
  const ip = String(args.ip ?? '192.0.2.1').trim() || '192.0.2.1'
  const proxied = args.proxied === undefined ? true : parseBool(args.proxied)
  const force = parseBool(args.force ?? process.env.FORCE_TAKEOVER_DNS)

  if (!zoneId) throw new Error('--zone-id is required')
  if (!name) throw new Error('--name is required')

  const dns = await ensureDnsA({ token, zoneId, recordName: name, ip, proxied, force })
  process.stdout.write(`DNS A ${name} -> ${ip}: ${dns.action}\n`)
  process.exit(0)
}

if (cmd === 'ensure-worker-routes') {
  const zoneId = String(args['zone-id'] ?? '').trim()
  const workerName = String(args['worker-name'] ?? '').trim()
  if (!zoneId) throw new Error('--zone-id is required')
  if (!workerName) throw new Error('--worker-name is required')

  const patterns = []
  const rawRoutes = []
  for (const [k, v] of Object.entries(args)) {
    if (k === 'route' && typeof v === 'string') rawRoutes.push(v)
  }

  // Allow repeated --route flags: parseArgs keeps the last one, so also accept a comma-separated list.
  if (rawRoutes.length === 0 && typeof args.route === 'string') rawRoutes.push(args.route)
  for (const r of rawRoutes.flatMap((s) => String(s).split(',')).map((s) => s.trim()).filter(Boolean)) patterns.push(r)

  if (patterns.length === 0) throw new Error('At least one --route <pattern> is required')
  const force = parseBool(args.force ?? process.env.FORCE_TAKEOVER_ROUTES)

  await ensureWorkerRoutes({ token, zoneId, workerName, patterns, force })
  process.stdout.write(`Worker routes ensured (${patterns.length})\n`)
  process.exit(0)
}

process.stderr.write(`${usage()}\n`)
process.stderr.write(`Unknown command: ${cmd}\n`)
process.exit(2)
