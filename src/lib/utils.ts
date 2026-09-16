export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

export function formatDate(value: string | null | undefined, opts?: Intl.DateTimeFormatOptions): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleDateString('en-IN', opts ?? { day: 'numeric', month: 'short', year: 'numeric' })
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function initials(name: string | null | undefined): string {
  if (!name) return '?'
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('')
}

/**
 * Builds a usable social/profile URL from a user-supplied handle.
 * Handles values that already include a scheme or the base host
 * (e.g. "linkedin.com/in/xyz", "https://www.linkedin.com/in/xyz")
 * so we never double the prefix like "linkedin.com/in/linkedin.com/in/xyz".
 */
export function socialHref(value: string | null | undefined, base: string): string {
  const u = (value ?? '').trim().replace(/^@/, '')
  if (!u) return '#'
  if (/^https?:\/\//i.test(u)) return u
  const baseHost = base.replace(/^https?:\/\//i, '').replace(/\/+$/, '')
  if (baseHost && u.includes(baseHost)) return `https://${u}`
  return base + u
}

export function isUpcoming(event: { start_date: string; end_date?: string | null; end_time?: string | null; status?: string }): boolean {
  return !isEventEnded(event) && new Date(event.start_date) >= startOfToday()
}

export function startOfToday(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

// Event start/end dates and times are entered in Asia/Kolkata (UTC+5:30).
// These helpers convert that wall-clock time to a UTC epoch so client-side
// "is this event still upcoming?" checks match the server.
export function kolkataMs(date: string, time?: string | null): number {
  const [y, m, d] = date.split('-').map(Number)
  const [hh, mm] = (time || '00:00').split(':').map(Number)
  return Date.UTC(y, m - 1, d, hh - 5, mm - 30, 0)
}

export function endOfDayMs(date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  return Date.UTC(y, m - 1, d, 18, 29, 59)
}

/** True once the event's end date/time has passed, or it is marked done/cancelled. */
export function isEventEnded(
  event: { end_date?: string | null; end_time?: string | null; status?: string } | null | undefined,
): boolean {
  if (!event) return false
  if (event.status === 'completed' || event.status === 'cancelled') return true
  if (!event.end_date) return false
  return Date.now() >= (event.end_time ? kolkataMs(event.end_date, event.end_time) : endOfDayMs(event.end_date))
}

export function seatsRemaining(event: { seats: number; registrations?: number }): number {
  const used = event.registrations ?? 0
  return Math.max(0, event.seats - used)
}

export function downloadTextFile(filename: string, content: string, mime = 'text/plain'): void {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '')
}

export function moneyPoints(points: number): string {
  return points > 0 ? `+${points}` : `${points}`
}

// ---------------------------------------------------------------------------
// Student ID / phone validation — both are mandatory and must be exactly
// 10 digits everywhere in the app (forms, Excel import, bulk import).
// ---------------------------------------------------------------------------

/** Strips everything except digits ("+91 98765 43210" -> "91876543210" ...). */
export function digitsOnly(value: string | null | undefined): string {
  return (value ?? '').replace(/\D/g, '')
}

/**
 * Normalizes a phone number to a plain 10-digit subscriber number with no
 * country code: "+91 9123456789", "919123456789" and "9123456789" all become
 * "9123456789". Used for both storage and display.
 */
export function normalizePhone(value: string | null | undefined): string {
  const digits = digitsOnly(value)
  return digits.length > 10 ? digits.slice(-10) : digits
}

/** Exactly 10 digits (no more, no less) after stripping separators. */
export function isValidTenDigit(value: string | null | undefined): boolean {
  return /^\d{10}$/.test(digitsOnly(value))
}

export function errorMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message: unknown }).message)
  }
  return String(err ?? 'Something went wrong')
}

/**
 * Extracts the `error` field from a Supabase Edge Function HTTP error body
 * (e.g. `send-recruit-email` throttling responses), falling back to the
 * generic error message when the body cannot be parsed.
 */
export async function emailInvokeMessage(err: unknown): Promise<string> {
  const ctx = (err as { context?: unknown } | null)?.context
  const response = ctx as Response | undefined
  if (response && typeof response.json === 'function') {
    try {
      const body = (await response.json()) as { error?: string }
      if (body?.error) return String(body.error)
    } catch {
      // ignore unparseable body
    }
  }
  return errorMessage(err)
}

// ---------------------------------------------------------------------------
// Media helpers
// ---------------------------------------------------------------------------

export interface EmbedInfo {
  kind: 'youtube' | 'vimeo' | 'direct'
  embedSrc: string
  thumbUrl?: string
}

export function getEmbedInfo(url: string | null | undefined): EmbedInfo | null {
  if (!url) return null
  const trimmed = url.trim()
  if (!trimmed) return null
  try {
    const u = new URL(trimmed)

    if (/(youtube\.com|youtu\.be)/i.test(u.hostname)) {
      let id = ''
      if (u.hostname.toLowerCase().includes('youtu.be')) {
        id = u.pathname.split('/').filter(Boolean)[0] ?? ''
      } else if (u.pathname === '/watch') {
        id = u.searchParams.get('v') ?? ''
      } else {
        const parts = u.pathname.split('/').filter(Boolean)
        id = parts[1] ?? ''
      }
      if (id) {
        return {
          kind: 'youtube',
          embedSrc: `https://www.youtube.com/embed/${id}`,
          thumbUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
        }
      }
    }

    if (/vimeo\.com/i.test(u.hostname)) {
      const id = u.pathname.split('/').filter(Boolean)[0] ?? ''
      if (/^\d+$/.test(id)) {
        return { kind: 'vimeo', embedSrc: `https://player.vimeo.com/video/${id}` }
      }
    }

    if (/\.(mp4|webm|ogv|ogg|mov|m4v)(\?.*)?$/i.test(u.pathname)) {
      return { kind: 'direct', embedSrc: trimmed }
    }
  } catch {
    return null
  }
  return null
}

export function isImageUrl(url: string | null | undefined): boolean {
  if (!url) return false
  try {
    const u = new URL(url.trim())
    return /\.(png|jpe?g|gif|webp|svg|avif|bmp)(\?.*)?$/i.test(u.pathname)
  } catch {
    return false
  }
}

export function isStorageUpload(url: string | null | undefined): boolean {
  if (!url) return false
  return /\/storage\/v1\/object\/public\/media\//i.test(url)
}
