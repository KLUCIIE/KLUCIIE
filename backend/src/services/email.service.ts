import nodemailer from 'nodemailer'
import type { Transporter } from 'nodemailer'
import { db } from '../db/index.js'
import { smtpSettings, recruitEmails } from '../db/schema.js'
import { eq, asc } from 'drizzle-orm'
import { config } from '../config/index.js'

let cachedTransporter: Transporter | null = null
let currentIndex = 0

// Circuit breaker: accounts that recently failed with network-ish errors are
// skipped for a short window so batches fail fast instead of 2-3 timeouts each.
const blockedKeys = new Map<string, number>()
const keyReasons = new Map<string, string>()
const BLOCK_TTL = 10 * 60 * 1000
const UNREACHABLE_RE = /timeout|timed out|ETIMEDOUT|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|socket hang up|getaddrinfo|connect/i

function accountKey(account: { email: string; host: string; port: number }): string {
  return `${account.email}@${account.host}:${account.port}`
}

function isAccountBlocked(key: string): boolean {
  const until = blockedKeys.get(key)
  if (until && until > Date.now()) return true
  if (until) blockedKeys.delete(key)
  return false
}

function blockAccount(key: string, reason: string) {
  blockedKeys.set(key, Date.now() + BLOCK_TTL)
  keyReasons.set(key, reason)
}

function isUnreachableError(err: any): boolean {
  return Boolean(err && typeof err.message === 'string' && UNREACHABLE_RE.test(err.message))
}

async function getAccounts() {
  return db.query.smtpSettings.findMany({
    where: eq(smtpSettings.isActive, true),
    orderBy: [asc(smtpSettings.position)],
  })
}

async function createTransporter(account: typeof smtpSettings.$inferSelect): Promise<Transporter> {
  return nodemailer.createTransport({
    host: account.host,
    port: account.port,
    secure: account.port === 465,
    auth: {
      user: account.email,
      pass: account.password,
    },
    pool: true,
    maxConnections: 5,
    maxMessages: 500,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
  })
}

async function getRotatedTransporter(): Promise<{ transporter: Transporter; account: typeof smtpSettings.$inferSelect }> {
  const accounts = await getAccounts()
  const healthy = accounts.filter((a) => !isAccountBlocked(accountKey(a)))

  const fallbackKey = config.SMTP_USER
    ? accountKey({ email: config.SMTP_USER, host: config.SMTP_HOST || 'smtp.gmail.com', port: config.SMTP_PORT || 465 })
    : ''

  if (healthy.length === 0 && fallbackKey && config.SMTP_USER && config.SMTP_PASS && !isAccountBlocked(fallbackKey)) {
    const fallbackTransporter = nodemailer.createTransport({
      host: config.SMTP_HOST || 'smtp.gmail.com',
      port: config.SMTP_PORT || 465,
      secure: true,
      auth: {
        user: config.SMTP_USER,
        pass: config.SMTP_PASS,
      },
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 30000,
    })
    return {
      transporter: fallbackTransporter,
      account: {
        id: '',
        email: config.SMTP_USER,
        password: config.SMTP_PASS,
        fromName: 'KL CIIE',
        host: config.SMTP_HOST || 'smtp.gmail.com',
        port: config.SMTP_PORT || 465,
        isActive: true,
        position: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    }
  }

  if (healthy.length === 0) {
    if (accounts.length === 0) throw new Error('No SMTP accounts configured')
    const blockedKey = [...blockedKeys.keys()].find((k) => isAccountBlocked(k))
    const reason = blockedKey ? keyReasons.get(blockedKey) : undefined
    throw new Error(
      reason
        ? `All SMTP accounts are currently unreachable (${blockedKey}: ${reason})`
        : 'All SMTP accounts are currently unreachable',
    )
  }

  const idx = currentIndex % healthy.length
  currentIndex = (currentIndex + 1) % healthy.length

  const account = healthy[idx]
  const transporter = await createTransporter(account)
  return { transporter, account }
}

export async function sendEmail(params: {
  to: string
  subject: string
  text?: string
  html?: string
  applicationId?: string
  sentBy?: string
}): Promise<{ ok: boolean; sender?: string; error?: string }> {
  // Brevo HTTP API is the preferred transport when configured — it only needs
  // HTTPS (443), which works everywhere SMTP ports are blocked. When no Brevo
  // key is set we fall back to the Gmail SMTP pool.
  if (config.BREVO_API_KEY) {
    return sendViaBrevo(params)
  }

  let lastError: Error | null = null

  for (let attempt = 0; attempt < 2; attempt++) {
    let blockedKey: string | null = null
    try {
      const { transporter, account } = await getRotatedTransporter()
      blockedKey = accountKey(account)
      const fromAddress = `"${account.fromName}" <${account.email}>`

      await transporter.sendMail({
        from: fromAddress,
        to: params.to,
        subject: params.subject,
        text: params.text,
        html: params.html,
      })

      await db.insert(recruitEmails).values({
        applicationId: params.applicationId || null,
        toEmail: params.to,
        subject: params.subject,
        body: params.html || params.text || '',
        status: 'sent',
        sentBy: params.sentBy || null,
      })

      return { ok: true, sender: account.email }
    } catch (err: any) {
      lastError = err
      console.error(`[Email] Send attempt ${attempt + 1} failed:`, err.message)
      if (isUnreachableError(err) && blockedKey) blockAccount(blockedKey, err.message)
    }
  }

  if (lastError) {
    await db.insert(recruitEmails).values({
      applicationId: params.applicationId || null,
      toEmail: params.to,
      subject: params.subject,
      body: params.html || params.text || '',
      status: 'failed',
      error: lastError.message,
      sentBy: params.sentBy || null,
    }).catch(() => {})
  }

  return { ok: false, error: lastError?.message }
}

async function brevoSender(): Promise<{ name: string; email: string }> {
  if (config.BREVO_SENDER_EMAIL) {
    return { name: config.BREVO_SENDER_NAME || 'KL CIIE', email: config.BREVO_SENDER_EMAIL }
  }
  if (config.SMTP_USER) {
    return { name: config.BREVO_SENDER_NAME || 'KL CIIE', email: config.SMTP_USER }
  }
  const account = (await getAccounts())[0]
  if (account) return { name: account.fromName || 'KL CIIE', email: account.email }
  throw new Error('No Brevo sender configured — set BREVO_SENDER_EMAIL (or an SMTP account email)')
}

async function sendViaBrevo(params: {
  to: string
  subject: string
  text?: string
  html?: string
  applicationId?: string
  sentBy?: string
}): Promise<{ ok: boolean; sender?: string; error?: string }> {
  try {
    const sender = await brevoSender()
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'api-key': config.BREVO_API_KEY!,
      },
      body: JSON.stringify({
        sender,
        to: [{ email: params.to }],
        subject: params.subject,
        ...(params.html ? { htmlContent: params.html } : params.text ? { textContent: params.text } : {}),
      }),
    })

    if (!res.ok) {
      let detail = ''
      try {
        const body = (await res.json()) as Record<string, unknown>
        detail = typeof body?.message === 'string' ? body.message : JSON.stringify(body)
      } catch {
        detail = `HTTP ${res.status}`
      }
      throw new Error(`Brevo rejected the email (${res.status}): ${detail || 'unknown error'}`)
    }

    await db.insert(recruitEmails).values({
      applicationId: params.applicationId || null,
      toEmail: params.to,
      subject: params.subject,
      body: params.html || params.text || '',
      status: 'sent',
      sentBy: params.sentBy || null,
    }).catch(() => {})

    return { ok: true, sender: sender.email }
  } catch (err: any) {
    const message = err?.message ?? String(err)
    await db.insert(recruitEmails).values({
      applicationId: params.applicationId || null,
      toEmail: params.to,
      subject: params.subject,
      body: params.html || params.text || '',
      status: 'failed',
      error: message,
      sentBy: params.sentBy || null,
    }).catch(() => {})
    return { ok: false, error: message }
  }
}
