import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db } from '../db/index.js'
import { profiles } from '../db/schema.js'
import { eq } from 'drizzle-orm'
import { authenticate, type JwtPayload } from '../middleware/auth.js'
import { authRateLimit } from '../middleware/rateLimit.js'
import { hashPassword, verifyPassword } from '../auth/passwords.js'
import { generateTotpSecret, verifyTotp } from '../auth/mfa.js'
import { createRecoveryCodes, useRecoveryCode } from '../auth/recovery.js'
import { getProfile, getProfileByEmail, createProfile, recordLogin } from '../services/auth.service.js'
import { logAdminEvent } from '../services/audit.service.js'
import { sha256Hash, generateOtp } from '../utils/codes.js'
import { cacheGet, cacheSet, cacheDel } from '../redis/index.js'
import { db as drizzleDb } from '../db/index.js'
import { emailOtpCodes, adminRecoveryCodes, recruitApplications, registrationRoles } from '../db/schema.js'
import { and, isNull, gt } from 'drizzle-orm'
import { verifyRegistrationToken } from '../utils/registration.js'
import { BadRequestError, UnauthorizedError, NotFoundError } from '../utils/errors.js'

export default async function authRoutes(app: FastifyInstance) {
  // ─── LOGIN ───
  app.post('/login', { preHandler: [authRateLimit] }, async (request, reply) => {
    const body = z.object({
      email: z.string().email(),
      password: z.string().min(1),
    }).parse(request.body)

    const profile = await getProfileByEmail(body.email)
    if (!profile) {
      return reply.status(401).send({ error: 'Invalid email or password' })
    }

    const storedHash = ((profile.customFields ?? {}) as Record<string, any>)?.password_hash as string | undefined
    if (!storedHash) {
      return reply.status(401).send({ error: 'Invalid email or password' })
    }
    const passwordOk = await verifyPassword(body.password, storedHash)
    if (!passwordOk) {
      return reply.status(401).send({ error: 'Invalid email or password' })
    }

    await recordLogin(profile.id)

    const aal = profile.mfaEnabled ? 'aal1' : 'aal2'
    const token = app.jwt.sign(
      { sub: profile.id, role: profile.role, aal },
      { expiresIn: config.JWT_ACCESS_EXPIRY }
    )

    const refreshToken = app.jwt.sign(
      { sub: profile.id, role: profile.role, type: 'refresh', aal },
      { expiresIn: config.JWT_REFRESH_EXPIRY }
    )

    await logAdminEvent({
      actorId: profile.id,
      action: 'login',
      ip: request.ip,
    })

    return reply.send({
      accessToken: token,
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
  })

  // ─── SIGNUP ───
  app.post('/signup', { preHandler: [authRateLimit] }, async (request, reply) => {
    const body = z.object({
      email: z.string().email(),
      password: z.string().min(8),
      fullName: z.string().min(1),
      studentId: z.string().optional(),
      phone: z.string().optional(),
      department: z.string().optional(),
      yearOfBirth: z.string().optional(),
      roleSlug: z.string().optional(),
      registrationToken: z.string().optional(),
    }).parse(request.body)

    const existing = await getProfileByEmail(body.email)
    if (existing) {
      return reply.status(409).send({ error: 'Email already registered' })
    }

    // Resolve the role from the registration page slug, but only if the token
    // issued by validate_role_registration is valid. Otherwise fall back to 'member'.
    let role = 'member'
    if (body.roleSlug && body.registrationToken) {
      const regRole = await db.query.registrationRoles.findFirst({
        where: and(eq(registrationRoles.slug, body.roleSlug), eq(registrationRoles.enabled, true)),
      })
      if (regRole && verifyRegistrationToken(regRole.slug, body.email, body.registrationToken, regRole.signingSecret)) {
        role = regRole.role
      }
    }

    const passwordHash = await hashPassword(body.password)

    const profile = await createProfile({
      id: crypto.randomUUID(),
      email: body.email,
      fullName: body.fullName,
      role,
      studentId: body.studentId,
      phone: body.phone,
      department: body.department,
      yearOfBirth: body.yearOfBirth,
    })

    await db.update(profiles).set({
      customFields: {
        ...((profile.customFields ?? {}) as Record<string, any>),
        password_hash: passwordHash,
      },
    }).where(eq(profiles.id, profile.id))

    await db.insert(recruitApplications).values({
      memberId: profile.id,
      email: body.email,
      fullName: body.fullName,
      studentId: body.studentId ?? null,
      phone: body.phone ?? null,
      department: body.department ?? null,
      yearOfBirth: body.yearOfBirth ?? null,
    })

    const token = app.jwt.sign(
      { sub: profile.id, role: profile.role, aal: 'aal2' },
      { expiresIn: config.JWT_ACCESS_EXPIRY }
    )

    return reply.status(201).send({
      accessToken: token,
      user: {
        id: profile.id,
        email: profile.email,
        fullName: profile.fullName,
        role: profile.role,
      },
    })
  })

  // ─── GET CURRENT USER ───
  app.get('/me', { preHandler: [authenticate] }, async (request, reply) => {
    const user = request.user as JwtPayload
    const profile = await getProfile(user.sub)
    if (!profile) {
      return reply.status(404).send({ error: 'Profile not found' })
    }
    return reply.send({ user: profile })
  })

  // ─── MFA: ENROLL ───
  app.post('/mfa/enroll', { preHandler: [authenticate] }, async (request, reply) => {
    const user = request.user as JwtPayload
    const profile = await getProfile(user.sub)
    if (!profile) throw new NotFoundError('Profile')

    const { uri, secret } = generateTotpSecret(profile.email || 'user@klciie.com')
    await cacheSet(`mfa:pending:${user.sub}`, secret, 300)

    return reply.send({
      id: 'totp',
      type: 'totp',
      friendlyName: 'CIIE Authenticator',
      status: 'unverified',
      totp: { uri, secret },
    })
  })

  // ─── MFA: LIST FACTORS (derived from persisted enrollment) ───
  app.get('/mfa/factors', { preHandler: [authenticate] }, async (request, reply) => {
    const user = request.user as JwtPayload
    const profile = await getProfile(user.sub)
    const pendingSecret = await cacheGet<string>(`mfa:pending:${user.sub}`)
    const storedSecret = ((profile?.customFields ?? {}) as Record<string, any>)?.totp_secret as string | undefined

    const factor = (id: string, status: string) => ({
      id,
      type: 'totp',
      friendlyName: 'CIIE Authenticator',
      status,
      created_at: profile?.updatedAt?.toISOString() ?? null,
    })

    let all: unknown[] = []
    if (profile?.mfaEnabled && storedSecret) {
      all = [factor('totp', 'verified')]
    } else if (pendingSecret) {
      all = [factor('totp', 'unverified')]
    }
    const totp = all.filter((f: any) => f.type === 'totp')
    return reply.send({ all, totp })
  })

  // ─── MFA: VERIFY ───
  app.post('/mfa/verify', { preHandler: [authenticate] }, async (request, reply) => {
    const body = z.object({ code: z.string().length(6) }).parse(request.body)
    const user = request.user as JwtPayload

    const secret = await cacheGet<string>(`mfa:pending:${user.sub}`)
    if (!secret) {
      return reply.status(400).send({ error: 'MFA enrollment not started or expired' })
    }

    const valid = verifyTotp(secret, body.code)
    if (!valid) {
      return reply.status(400).send({ error: 'Invalid MFA code' })
    }

    const profile = await getProfile(user.sub)
    const customFields = ((profile?.customFields ?? {}) as Record<string, any>) ?? {}
    await db.update(profiles).set({
      mfaEnabled: true,
      mfaSetupRequired: false,
      customFields: { ...customFields, totp_secret: secret },
      updatedAt: new Date(),
    }).where(eq(profiles.id, user.sub))

    const recoveryCodes = await createRecoveryCodes(user.sub)
    await cacheDel(`mfa:pending:${user.sub}`)

    const aal2Token = app.jwt.sign(
      { sub: user.sub, role: user.role, aal: 'aal2' },
      { expiresIn: config.JWT_ACCESS_EXPIRY }
    )

    return reply.send({ success: true, recoveryCodes, accessToken: aal2Token })
  })

  // ─── MFA: VERIFY FOR LOGIN ───
  app.post('/mfa/verify-login', { preHandler: [authenticate] }, async (request, reply) => {
    const body = z.object({ code: z.string() }).parse(request.body)
    const user = request.user as JwtPayload

    const profile = await getProfile(user.sub)
    if (!profile) throw new NotFoundError('Profile')

    // TOTP persisted at enrollment
    const storedSecret = ((profile.customFields ?? {}) as Record<string, any>)?.totp_secret as string | undefined
    if (storedSecret && verifyTotp(storedSecret, body.code)) {
      const newToken = app.jwt.sign(
        { sub: user.sub, role: user.role, aal: 'aal2' },
        { expiresIn: config.JWT_ACCESS_EXPIRY }
      )
      return reply.send({ verified: true, accessToken: newToken })
    }

    // Pending (post enrollment) secret
    const pendingSecret = await cacheGet<string>(`mfa:secret:${user.sub}`)
    if (pendingSecret) {
      const valid = verifyTotp(pendingSecret, body.code)
      if (valid) {
        const newToken = app.jwt.sign(
          { sub: user.sub, role: user.role, aal: 'aal2' },
          { expiresIn: config.JWT_ACCESS_EXPIRY }
        )
        return reply.send({ verified: true, accessToken: newToken })
      }
    }

    // Try recovery code
    const used = await useRecoveryCode(user.sub, body.code, request.ip)
    if (used) {
      const newToken = app.jwt.sign(
        { sub: user.sub, role: user.role, aal: 'aal2' },
        { expiresIn: config.JWT_ACCESS_EXPIRY }
      )
      return reply.send({ verified: true, accessToken: newToken })
    }

    return reply.status(400).send({ error: 'Invalid code' })
  })

  // ─── MFA: UNENROLL (self) ───
  app.post('/mfa/unenroll', { preHandler: [authenticate] }, async (request, reply) => {
    const user = request.user as JwtPayload
    const profile = await getProfile(user.sub)
    if (!profile) throw new NotFoundError('Profile')

    const customFields = ((profile.customFields ?? {}) as Record<string, any>) ?? {}
    delete customFields.totp_secret
    await db.update(profiles).set({
      mfaEnabled: false,
      mfaSetupRequired: true,
      customFields,
      updatedAt: new Date(),
    }).where(eq(profiles.id, user.sub))
    await db.delete(adminRecoveryCodes).where(eq(adminRecoveryCodes.adminId, user.sub))
    await cacheDel(`mfa:pending:${user.sub}`)
    await cacheDel(`mfa:secret:${user.sub}`)

    return reply.send({ success: true })
  })

  // ─── REFRESH TOKEN ───
  app.post('/refresh', async (request, reply) => {
    const body = z.object({ refreshToken: z.string() }).parse(request.body)

    try {
      const decoded = app.jwt.verify<{ sub: string; role: string; type: string; aal?: string }>(body.refreshToken)
      if (decoded.type !== 'refresh') throw new Error('Not a refresh token')

      const profile = await getProfile(decoded.sub)
      let aal = decoded.aal ?? 'aal2'
      if (decoded.aal === 'aal2' && profile?.mfaEnabled) aal = 'aal2'
      else if (profile?.mfaEnabled) aal = 'aal1'

      const token = app.jwt.sign(
        { sub: decoded.sub, role: decoded.role, aal },
        { expiresIn: config.JWT_ACCESS_EXPIRY }
      )

      return reply.send({ accessToken: token, aal })
    } catch {
      return reply.status(401).send({ error: 'Invalid refresh token' })
    }
  })

  // ─── LOGOUT ───
  app.post('/logout', { preHandler: [authenticate] }, async (request, reply) => {
    const user = request.user as JwtPayload
    await logAdminEvent({ actorId: user.sub, action: 'logout', ip: request.ip })
    return reply.send({ success: true })
  })
}

import { config } from '../config/index.js'
