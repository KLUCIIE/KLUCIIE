import nodemailer from 'nodemailer'
import type { Transporter } from 'nodemailer'
import { db } from '../db/index.js'
import { smtpSettings, recruitEmails } from '../db/schema.js'
import { eq, asc } from 'drizzle-orm'
import { config } from '../config/index.js'

let cachedTransporter: Transporter | null = null
let currentIndex = 0

// Circuit breaker: hosts that recently failed with network-ish errors are
// skipped for a short window so batches fail fast instead of 2-3 timeouts each.
const blockedHosts = new Map<string, number>()
const BLOCK_TTL = 10 * 60 * 1000
const UNREACHABLE_RE = /timeout|timed out|ETIMEDOUT|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|socket hang up|getaddrinfo|connect/i

function isHostBlocked(host: string): boolean {
  const until = blockedHosts.get(host)
  if (until && until > Date.now()) return true
  if (until) blockedHosts.delete(host)
  return false
}

function blockHost(host: string) {
  blockedHosts.set(host, Date.now() + BLOCK_TTL)
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
    maxMessages: 100,
    connectionTimeout: 5000,
    greetingTimeout: 5000,
    socketTimeout: 15000,
  })
}

async function getRotatedTransporter(): Promise<{ transporter: Transporter; account: typeof smtpSettings.$inferSelect }> {
  const accounts = await getAccounts()
  const healthy = accounts.filter((a) => !isHostBlocked(a.host))

  if (healthy.length === 0 && config.SMTP_USER && config.SMTP_PASS && !isHostBlocked(config.SMTP_HOST || 'smtp.gmail.com')) {
    const fallbackTransporter = nodemailer.createTransport({
      host: config.SMTP_HOST || 'smtp.gmail.com',
      port: config.SMTP_PORT || 465,
      secure: true,
      auth: {
        user: config.SMTP_USER,
        pass: config.SMTP_PASS,
      },
      connectionTimeout: 5000,
      greetingTimeout: 5000,
      socketTimeout: 15000,
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
    throw new Error('All SMTP accounts are currently unreachable')
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
  let lastError: Error | null = null

  for (let attempt = 0; attempt < 2; attempt++) {
    let accountHost: string | null = null
    try {
      const { transporter, account } = await getRotatedTransporter()
      accountHost = account.host
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
      if (isUnreachableError(err) && accountHost) blockHost(accountHost)
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
