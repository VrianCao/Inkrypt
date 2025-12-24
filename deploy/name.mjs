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

function normalizeDomain(raw) {
  if (!raw) throw new Error('DOMAIN is required')
  const input = String(raw).trim()
  if (!input) throw new Error('DOMAIN is required')

  // Be forgiving: accept https://... and strip to hostname.
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
  if (!domain) throw new Error('DOMAIN is required')

  // Minimal hostname validation: ascii labels, at least one dot.
  if (!/^[a-z0-9.-]+$/.test(domain)) throw new Error('DOMAIN must be an ASCII hostname (use punycode for IDN)')
  if (!domain.includes('.')) throw new Error('DOMAIN must contain at least one dot, e.g. notes.example.com')
  if (domain.length > 253) throw new Error('DOMAIN is too long')

  const labels = domain.split('.')
  for (const label of labels) {
    if (!label) throw new Error('DOMAIN contains an empty label')
    if (label.length > 63) throw new Error('DOMAIN label is too long')
    if (!/^[a-z0-9-]+$/.test(label)) throw new Error('DOMAIN label contains invalid characters')
    if (label.startsWith('-') || label.endsWith('-')) throw new Error('DOMAIN label must not start or end with "-"')
  }

  return domain
}

function slugifyDomain(domain) {
  const slug = domain
    .toLowerCase()
    .replace(/[^a-z0-9.-]/g, '-')
    .replace(/\./g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')

  return slug || 'site'
}

function shortHash(input) {
  return crypto.createHash('sha256').update(input).digest('hex').slice(0, 8)
}

function buildName(prefix, slug, hash, maxLen = 63) {
  const fixed = `${prefix}--${hash}` // double dash to make truncation safer
  const availableSlugLen = maxLen - fixed.length
  const trimmedSlug = slug.slice(0, Math.max(1, availableSlugLen)).replace(/-+$/g, '')
  return `${prefix}-${trimmedSlug}-${hash}`.replace(/--+/g, '-')
}

function githubOutput(key, value) {
  const outFile = process.env.GITHUB_OUTPUT
  if (!outFile) return
  const str = String(value ?? '')
  const delimiter = `EOF_${crypto.randomUUID().replace(/-/g, '')}`
  fs.appendFileSync(outFile, `${key}<<${delimiter}\n${str}\n${delimiter}\n`)
}

const args = parseArgs(process.argv.slice(2))

const domain = normalizeDomain(args.domain ?? process.env.DOMAIN ?? process.env.INKRYPT_DOMAIN)

const origin = `https://${domain}`
const rpId = domain

const rpName = String(args['rp-name'] ?? process.env.INKRYPT_RP_NAME ?? 'Inkrypt').trim() || 'Inkrypt'
const cookieSameSite = String(args['cookie-samesite'] ?? process.env.INKRYPT_COOKIE_SAMESITE ?? 'Lax').trim() || 'Lax'

const corsOriginRaw = String(args['cors-origin'] ?? process.env.INKRYPT_CORS_ORIGIN ?? '').trim()
const corsOrigin = corsOriginRaw || origin

const slug = slugifyDomain(domain)
const hash = shortHash(domain)

const workerNameOverride = String(args['worker-name'] ?? process.env.INKRYPT_WORKER_NAME ?? '').trim()
const d1NameOverride = String(args['d1-name'] ?? process.env.INKRYPT_D1_NAME ?? '').trim()

const workerName = workerNameOverride || buildName('inkrypt-api', slug, hash)
const d1Name = d1NameOverride || buildName('inkrypt', slug, hash)

const outputs = {
  domain,
  origin,
  rp_id: rpId,
  rp_name: rpName,
  cors_origin: corsOrigin,
  cookie_samesite: cookieSameSite,
  worker_name: workerName,
  d1_name: d1Name,
}

for (const [k, v] of Object.entries(outputs)) githubOutput(k, v)

if (!process.env.GITHUB_OUTPUT) {
  process.stdout.write(`${JSON.stringify(outputs, null, 2)}\n`)
} else {
  process.stdout.write(`Resolved deploy config:\n${JSON.stringify(outputs, null, 2)}\n`)
}

