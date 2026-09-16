import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { db } from '../db/index.js'
import { oauthSettings, platformSettings, profiles, recruitApplications } from '../db/schema.js'
import { eq } from 'drizzle-orm'
import { requireSuperAdmin, type JwtPayload } from '../middleware/auth.js'
import { config } from '../config/index.js'
import { getProfileByEmail, getProfile, createProfile, recordLogin } from '../services/auth.service.js'
import { hashPassword } from '../auth/passwords.js'
import { logAdminEvent } from '../services/audit.service.js'
import { BadRequestError } from '../utils/errors.js'

type OAuthMode = 'register' | 'github' | 'microsoft' | 'both' | 'microsoft-only' | 'github-only' | 'microsoft+github-only'
type OAuthProvider = 'microsoft' | 'github'

async function getOauthRow() {
  const row = await db.query.oauthSettings.findFirst({ where: eq(oauthSettings.id, 1) })
  if (row) return row
  // Singleton row missing (fresh install before the migration ran): create it.
  const [created] = await db
    .insert(oauthSettings)
    .values({ id: 1, enabled: false, mode: 'register' })
    .onConflictDoNothing()
    .returning()
  return (created ?? (await db.query.oauthSettings.findFirst({ where: eq(oauthSettings.id, 1) })))!
}

function frontendUrl(): string {
  return config.FRONTEND_URL.replace(/\/+$/, '')
}

/** Public base URL this backend is reachable at (for OAuth callbacks). */
function backendUrl(): string {
  const base = config.OAUTH_CALLBACK_BASE_URL ?? config.FRONTEND_URL
  return base.replace(/\/+$/, '')
}

function providerRedirectUri(provider: OAuthProvider): string {
  if (provider === 'github') {
    return `${backendUrl()}/api/oauth/github/callback`
  }
  return config.OAUTH_REDIRECT_URI || `${backendUrl()}/api/oauth/microsoft/callback`
}

/** The OAuth sign-in is only honoured for email domains a Super Admin has
 *  allowed in Settings → "Allowed email domains" (when domain restriction is on). */
async function isDomainAllowed(email: string): Promise<boolean> {
  const ps = await db.query.platformSettings.findFirst({ where: eq(platformSettings.id, 1) })
  if (!ps?.signupDomainRestriction) return true
  const domain = email.split('@').pop()?.toLowerCase() ?? ''
  if (!domain) return false
  const allowed = (ps.signupAllowedDomains ?? [])
    .map((d) => d.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean)
  return allowed.some((d) => domain === d || domain.endsWith('.' + d))
}

function providerConfigured(provider: OAuthProvider, row: { enabled: boolean; mode: string; msTenantId: string | null; msClientId: string | null; msClientSecret: string | null; ghClientId: string | null; ghClientSecret: string | null }): boolean {
  if (!row.enabled || row.mode === 'register') return false
  if (provider === 'microsoft') {
    return ['microsoft', 'both', 'microsoft-only', 'microsoft+github-only'].includes(row.mode) ? !!(row.msTenantId && row.msClientId && row.msClientSecret) : false
  }
  return ['github', 'both', 'github-only', 'microsoft+github-only'].includes(row.mode) ? !!(row.ghClientId && row.ghClientSecret) : false
}

function microsoftConfigured(row: { enabled: boolean; mode: string; msTenantId: string | null; msClientId: string | null; msClientSecret: string | null }): boolean {
  return row.enabled && ['microsoft', 'both', 'microsoft-only', 'microsoft+github-only'].includes(row.mode) && !!(row.msTenantId && row.msClientId && row.msClientSecret)
}

function githubConfigured(row: { enabled: boolean; mode: string; ghClientId: string | null; ghClientSecret: string | null }): boolean {
  return row.enabled && ['github', 'both', 'github-only', 'microsoft+github-only'].includes(row.mode) && !!(row.ghClientId && row.ghClientSecret)
}

export default async function oauthRoutes(app: FastifyInstance) {
  // ─── Public: minimal config the login/register pages need (no secrets) ───
  app.get('/config', async (_request, reply) => {
    const row = await getOauthRow()
    return reply.send({
      enabled: row.enabled,
      login_enabled: row.loginEnabled,
      login_microsoft: row.loginMicrosoft,
      login_github: row.loginGithub,
      mode: row.mode,
      configured: microsoftConfigured(row) || githubConfigured(row),
      microsoft_configured: microsoftConfigured(row),
      github_configured: !!(row.ghClientId && row.ghClientSecret),
    })
  })

  // ─── Super Admin: read back the full settings (secrets included) ───
  app.get('/settings', { preHandler: [requireSuperAdmin] }, async (_request, reply) => {
    const row = await getOauthRow()
    return reply.send({
      id: row.id,
      enabled: row.enabled,
      login_enabled: row.loginEnabled,
      login_microsoft: row.loginMicrosoft,
      login_github: row.loginGithub,
      mode: row.mode,
      ms_tenant_id: row.msTenantId ?? '',
      ms_client_id: row.msClientId ?? '',
      ms_client_secret: row.msClientSecret ?? '',
      gh_client_id: row.ghClientId ?? '',
      gh_client_secret: row.ghClientSecret ?? '',
      redirect_uri: providerRedirectUri('microsoft'),
      github_redirect_uri: providerRedirectUri('github'),
      updated_at: row.updatedAt?.toISOString() ?? null,
    })
  })

  // ─── Super Admin: save OAuth settings ───
  app.post<{ Body: { enabled?: boolean; login_enabled?: boolean; login_microsoft?: boolean; login_github?: boolean; mode?: string; ms_tenant_id?: string; ms_client_id?: string; ms_client_secret?: string; gh_client_id?: string; gh_client_secret?: string } }>(
    '/settings',
    { preHandler: [requireSuperAdmin] },
    async (request, reply) => {
      const user = request.user as JwtPayload
      const body = z
        .object({
          enabled: z.boolean(),
          login_enabled: z.boolean().optional(),
          login_microsoft: z.boolean().optional(),
          login_github: z.boolean().optional(),
          mode: z.enum(['register', 'github', 'microsoft', 'both', 'microsoft-only', 'github-only', 'microsoft+github-only']),
          ms_tenant_id: z.string().optional(),
          ms_client_id: z.string().optional(),
          ms_client_secret: z.string().optional(),
          gh_client_id: z.string().optional(),
          gh_client_secret: z.string().optional(),
        })
        .parse(request.body ?? {})

      const current = await getOauthRow()
      const values = {
        enabled: body.enabled,
        loginEnabled: body.login_enabled ?? current.loginEnabled,
        loginMicrosoft: body.login_microsoft ?? current.loginMicrosoft,
        loginGithub: body.login_github ?? current.loginGithub,
        mode: body.mode as OAuthMode,
        msTenantId: (body.ms_tenant_id ?? '').trim() || null,
        msClientId: (body.ms_client_id ?? '').trim() || null,
        msClientSecret: (body.ms_client_secret ?? '').trim() || null,
        ghClientId: (body.gh_client_id ?? '').trim() || null,
        ghClientSecret: (body.gh_client_secret ?? '').trim() || null,
        updatedBy: user.sub,
        updatedAt: new Date(),
      }

      const [row] = await db
        .insert(oauthSettings)
        .values({ id: 1, ...values })
        .onConflictDoUpdate({
          target: oauthSettings.id,
          set: values,
        })
        .returning()

      await logAdminEvent({
        actorId: user.sub,
        action: 'OAuth Settings Updated',
        entityType: 'settings',
        entityId: 'oauth',
        details: { enabled: row.enabled, login_enabled: row.loginEnabled, mode: row.mode },
        ip: request.ip,
      })
      return reply.send({ ok: true })
    },
  )

  // ─── Shared: start an OAuth journey (browser redirect) ───
  async function startAuthorize(provider: OAuthProvider, request: FastifyRequest, reply: FastifyReply) {
    const row = await getOauthRow()
    if (!providerConfigured(provider, row)) {
      const fe = frontendUrl()
      const reason = row.enabled ? 'not_configured' : 'disabled'
      return reply.redirect(`${fe}/oauth/callback?error=${reason}`)
    }

    const state = app.jwt.sign({ purpose: 'oauth-state', nonce: randomUUID() }, { expiresIn: '10m' })
    let url: URL
    if (provider === 'github') {
      url = new URL('https://github.com/login/oauth/authorize')
      url.searchParams.set('client_id', row.ghClientId!)
      url.searchParams.set('redirect_uri', providerRedirectUri('github'))
      url.searchParams.set('scope', 'read:user user:email')
      url.searchParams.set('state', state)
    } else {
      url = new URL(`https://login.microsoftonline.com/${encodeURIComponent(row.msTenantId!)}/oauth2/v2.0/authorize`)
      url.searchParams.set('client_id', row.msClientId!)
      url.searchParams.set('response_type', 'code')
      url.searchParams.set('redirect_uri', providerRedirectUri('microsoft'))
      url.searchParams.set('response_mode', 'query')
      url.searchParams.set('scope', 'openid profile email')
      url.searchParams.set('prompt', 'select_account')
      url.searchParams.set('state', state)
    }
    request.log.info({ provider, redirectUri: providerRedirectUri(provider) }, 'redirecting to OAuth provider')
    return reply.redirect(url.toString())
  }

  app.get('/microsoft/authorize', async (request, reply) => startAuthorize('microsoft', request as any, reply as any))
  app.get('/github/authorize', async (request, reply) => startAuthorize('github', request as any, reply as any))

  // ─── Shared: provider redirects the browser here after sign-in ───
  async function handleCallback(provider: OAuthProvider, request: FastifyRequest, reply: FastifyReply) {
    const q = request.query as Record<string, string | undefined>
    const fe = frontendUrl()
    const fail = (reason: string) =>
      reply.redirect(`${fe}/oauth/callback?error=${encodeURIComponent(reason)}`)

    if (q.error) return fail(q.error)
    if (!q.code || !q.state) return fail('missing_code')

    let statePayload: Record<string, unknown>
    try {
      statePayload = app.jwt.verify(q.state) as Record<string, unknown>
    } catch {
      return fail('invalid_state')
    }
    if (statePayload?.purpose !== 'oauth-state') return fail('invalid_state')

    const row = await getOauthRow()
    if (!providerConfigured(provider, row)) return fail('disabled')

    let email = ''
    let fullName = ''
    try {
      if (provider === 'github') {
        // ── Exchange the code for a GitHub access token ──
        const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            client_id: row.ghClientId!,
            client_secret: row.ghClientSecret!,
            code: q.code,
            redirect_uri: providerRedirectUri('github'),
          }),
        })
        const tokenBody = ((await tokenRes.json().catch(() => ({}))) ?? {}) as Record<string, any>
        if (!tokenRes.ok || !tokenBody.access_token) return fail('token_exchange_failed')

        // ── Fetch the GitHub user ──
        const headers = { Authorization: `Bearer ${tokenBody.access_token}`, Accept: 'application/json' }
        const [userRes, emailsRes] = await Promise.all([
          fetch('https://api.github.com/user', { headers }),
          fetch('https://api.github.com/user/emails', { headers }),
        ])
        const me = ((await userRes.json().catch(() => ({}))) ?? {}) as Record<string, any>
        if (userRes.ok && me.id) {
          const verifiedEmail =
            String(me.email ?? '').trim() ||
            (await Promise.resolve(
              (async () => {
                const emails = ((await emailsRes.json().catch(() => [])) ?? []) as Array<{ email?: string; primary?: boolean; verified?: boolean }>
                const primary = emails.find((e) => e.primary && e.verified)
                return String((primary ?? emails[0])?.email ?? '').trim()
              })(),
            ))
          email = String(verifiedEmail).toLowerCase()
          fullName = String(me.name ?? me.login ?? '').trim()
        }
      } else {
        // ── Microsoft token exchange + user info ──
        const tokenRes = await fetch(
          `https://login.microsoftonline.com/${encodeURIComponent(row.msTenantId!)}/oauth2/v2.0/token`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              client_id: row.msClientId!,
              client_secret: row.msClientSecret!,
              code: q.code,
              redirect_uri: providerRedirectUri('microsoft'),
              grant_type: 'authorization_code',
              scope: 'openid profile email',
            }),
          },
        )
        const tokenBody = ((await tokenRes.json().catch(() => ({}))) ?? {}) as Record<string, any>
        if (!tokenRes.ok || !tokenBody.access_token) return fail('token_exchange_failed')

        const meRes = await fetch('https://graph.microsoft.com/v1.0/me', {
          headers: { Authorization: `Bearer ${tokenBody.access_token}` },
        })
        const me = ((await meRes.json().catch(() => ({}))) ?? {}) as Record<string, any>
        if (meRes.ok && me.id) {
          email = String(me.mail ?? me.userPrincipalName ?? '').trim().toLowerCase()
          fullName = String(me.displayName ?? '').trim()
        }
      }
    } catch {
      return fail('userinfo_failed')
    }

    if (!email) return fail('no_email')
    if (!(await isDomainAllowed(email))) return fail('domain_not_allowed')

    const profile = await getProfileByEmail(email)
    const exchange = profile
      ? { purpose: 'oauth-exchange', type: 'login', sub: profile.id, aal: profile.mfaEnabled ? 'aal1' : 'aal2' }
      : { purpose: 'oauth-exchange', type: 'signup', email, fullName, provider }
    const token = app.jwt.sign(exchange, { expiresIn: '10m' })
    return reply.redirect(`${fe}/oauth/callback?token=${encodeURIComponent(token)}`)
  }

  app.get('/microsoft/callback', async (request, reply) => handleCallback('microsoft', request as any, reply as any))
  app.get('/github/callback', async (request, reply) => handleCallback('github', request as any, reply as any))

  // ─── Shared: SPA exchanges the one-time callback token for a session ───
  async function handleExchange(request: FastifyRequest, reply: FastifyReply) {
    const token = ((request.body as { token?: string } | undefined)?.token) ?? ''
    if (!token) throw new BadRequestError('Token required')

    let payload: Record<string, any>
    try {
      payload = app.jwt.verify(token) as Record<string, any>
    } catch {
      throw new BadRequestError('Invalid or expired token')
    }
    if (payload?.purpose !== 'oauth-exchange') throw new BadRequestError('Invalid token')

    if (payload.type === 'signup') {
      const email = String(payload.email ?? '').toLowerCase()
      const exists = await getProfileByEmail(email)
      if (exists) throw new BadRequestError('An account with this email already exists. Please log in instead.')
      return reply.send({ action: 'signup', email, fullName: payload.fullName ?? null, provider: payload.provider ?? 'microsoft' })
    }

    if (payload.type === 'login') {
      const profile = await getProfile(payload.sub as string)
      if (!profile) throw new BadRequestError('Account not found')
      const aal = profile.mfaEnabled ? 'aal1' : 'aal2'
      const accessToken = app.jwt.sign({ sub: profile.id, role: profile.role, aal }, { expiresIn: config.JWT_ACCESS_EXPIRY })
      const refreshToken = app.jwt.sign({ sub: profile.id, role: profile.role, type: 'refresh', aal }, { expiresIn: config.JWT_REFRESH_EXPIRY })
      await recordLogin(profile.id)
      return reply.send({
        action: 'login',
        accessToken,
        refreshToken,
        user: {
          id: profile.id,
          email: profile.email,
          fullName: profile.fullName,
          role: profile.role,
          ciieId: profile.ciieId,
          mfaEnabled: profile.mfaEnabled,
        },
      })
    }

    throw new BadRequestError('Invalid token')
  }

  app.post('/microsoft/exchange', async (request, reply) => handleExchange(request as any, reply as any))
  app.post('/github/exchange', async (request, reply) => handleExchange(request as any, reply as any))

  // ─── Shared: first-time OAuth user completes registration (details + password) ───
  async function handleSignup(provider: OAuthProvider, request: FastifyRequest, reply: FastifyReply) {
    const body = z
      .object({
        token: z.string(),
        fullName: z.string().min(1),
        password: z.string().min(8),
        studentId: z.string().optional(),
        phone: z.string().optional(),
        department: z.string().optional(),
        yearOfBirth: z.string().optional(),
      })
      .parse((request.body ?? {}) as any)

    let payload: Record<string, any>
    try {
      payload = app.jwt.verify(body.token) as Record<string, any>
    } catch {
      throw new BadRequestError('Invalid or expired token')
    }
    if (payload?.purpose !== 'oauth-exchange' || payload.type !== 'signup') {
      throw new BadRequestError('Invalid token')
    }
    const email = String(payload.email ?? '').toLowerCase()
    if (!email) throw new BadRequestError('Invalid token')

    if (!(await isDomainAllowed(email))) {
      throw new BadRequestError('Email domain is not allowed')
    }
    const existing = await getProfileByEmail(email)
    if (existing) {
      throw new BadRequestError('An account with this email already exists. Please log in instead.')
    }

    const passwordHash = await hashPassword(body.password)
    const profile = await createProfile({
      id: randomUUID(),
      email,
      fullName: body.fullName.trim(),
      role: 'user',
      studentId: body.studentId?.trim() || undefined,
      phone: body.phone?.trim() || undefined,
      department: body.department?.trim() || undefined,
      yearOfBirth: body.yearOfBirth?.trim() || undefined,
    })

    await db
      .update(profiles)
      .set({
        customFields: {
          ...((profile.customFields ?? {}) as Record<string, any>),
          password_hash: passwordHash,
          [provider === 'github' ? 'gh_oauth' : 'ms_oauth']: true,
        },
      })
      .where(eq(profiles.id, profile.id))

    await db.insert(recruitApplications).values({
      memberId: profile.id,
      email,
      fullName: body.fullName.trim(),
      studentId: body.studentId?.trim() ?? null,
      phone: body.phone?.trim() ?? null,
      department: body.department?.trim() ?? null,
      yearOfBirth: body.yearOfBirth?.trim() ?? null,
    })

    await recordLogin(profile.id)
    const aal = profile.mfaEnabled ? 'aal1' : 'aal2'
    const accessToken = app.jwt.sign({ sub: profile.id, role: profile.role, aal }, { expiresIn: config.JWT_ACCESS_EXPIRY })
    const refreshToken = app.jwt.sign({ sub: profile.id, role: profile.role, type: 'refresh', aal }, { expiresIn: config.JWT_REFRESH_EXPIRY })
    return reply.send({
      accessToken,
      refreshToken,
      user: {
        id: profile.id,
        email: profile.email,
        fullName: profile.fullName,
        role: profile.role,
        ciieId: profile.ciieId,
        mfaEnabled: profile.mfaEnabled,
      },
    })
  }

  app.post('/microsoft/signup', async (request, reply) => handleSignup('microsoft', request as any, reply as any))
  app.post('/github/signup', async (request, reply) => handleSignup('github', request as any, reply as any))
}
