import type { FastifyInstance } from 'fastify'
import crypto from 'node:crypto'
import { db } from '../db/index.js'
import { pgClient } from '../db/index.js'
import { profiles, emailOtpCodes, joinApplications } from '../db/schema.js'
import { eq, and, isNull, gt } from 'drizzle-orm'
import { authenticate, authenticateOptional, type JwtPayload } from '../middleware/auth.js'
import { createProfile } from '../services/auth.service.js'
import { hashPassword } from '../auth/passwords.js'
import { sha256Hash, generateOtp } from '../utils/codes.js'
import { sendEmail } from '../services/email.service.js'
import { logAdminEvent } from '../services/audit.service.js'
import { ForbiddenError, BadRequestError } from '../utils/errors.js'

function isAdminRole(role: string) {
  return ['super_admin', 'main_admin', 'event_admin', 'member_admin',
    'content_admin', 'gallery_admin', 'reports_admin', 'attendance_coordinator',
    'mail_admin'].includes(role)
}

function randomPassword(): string {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789'
  let out = 'CiiE!'
  for (let i = 0; i < 8; i++) out += chars[crypto.randomInt(chars.length)]
  return out
}

export default async function functionsRoutes(app: FastifyInstance) {
  // ─── BULK CREATE MEMBERS ───
  app.post('/bulk-create-members', { preHandler: [authenticate] }, async (request, reply) => {
    const user = request.user as JwtPayload
    if (!isAdminRole(user.role)) throw new ForbiddenError('Admin role required')

    const body = (request.body ?? {}) as {
      role?: string
      members?: Array<{
        client_index?: number | string
        full_name?: string
        email?: string
        student_id?: string
        department?: string
        year_of_study?: string
        phone?: string
      }>
    }
    const role = body.role ?? 'member_ciie'
    const members = body.members ?? []
    const results: Array<Record<string, unknown>> = []

    for (const m of members) {
      const email = (m.email ?? '').trim().toLowerCase()
      const client_index = typeof m.client_index === 'number' ? m.client_index : null
      try {
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          results.push({ client_index, ok: false, error: 'Invalid email' })
          continue
        }
        const existing = await db.query.profiles.findFirst({ where: eq(profiles.email, email) })
        if (existing) {
          results.push({ client_index, ok: false, error: 'An account with this email already exists.' })
          continue
        }
        const password = randomPassword()
        const passwordHash = await hashPassword(password)
        const id = crypto.randomUUID()
        const profile = await createProfile({
          id,
          email,
          fullName: m.full_name ?? '',
          role,
          studentId: m.student_id ?? undefined,
          phone: m.phone ?? undefined,
          department: m.department ?? undefined,
          yearOfBirth: m.year_of_study ?? undefined,
        })
        await db.update(profiles).set({
          status: 'active',
          customFields: {
            ...((profile.customFields ?? {}) as Record<string, unknown>),
            password_hash: passwordHash,
          },
        }).where(eq(profiles.id, id))

        if (role === 'member_ciie') {
          await pgClient`
            INSERT INTO recruit_applications
              (member_id, full_name, email, student_id, phone, department, year_of_study, stage, final_decision)
            VALUES
              (${id}, ${m.full_name ?? ''}, ${email}, ${m.student_id ?? null}, ${m.phone ?? null}, ${m.department ?? null}, ${m.year_of_study ?? null}, 'selected', 'selected')
          `
        }

        results.push({ client_index, ok: true, id, password })
      } catch (err: any) {
        results.push({ client_index, ok: false, error: err?.message ?? String(err) })
      }
    }

    await logAdminEvent({ actorId: user.sub, action: 'bulk_create_members', details: { attempted: members.length, role }, ip: request.ip })
    return reply.send({ results })
  })

  // ─── BULK DELETE MEMBERS ───
  app.post('/bulk-delete-members', { preHandler: [authenticate] }, async (request, reply) => {
    const user = request.user as JwtPayload
    if (!isAdminRole(user.role)) throw new ForbiddenError('Admin role required')

    const body = (request.body ?? {}) as { emails?: string[] }
    const emails = (body.emails ?? []).map((e) => String(e).trim().toLowerCase()).filter(Boolean)
    const deleted: string[] = []
    const results: Array<Record<string, unknown>> = []
    for (const email of emails) {
      const profile = await db.query.profiles.findFirst({ where: eq(profiles.email, email) })
      if (profile) {
        await db.delete(profiles).where(eq(profiles.id, profile.id))
        deleted.push(email)
        results.push({ email, ok: true })
      } else {
        results.push({ email, ok: false, error: 'No account found with this email.' })
      }
    }
    await logAdminEvent({ actorId: user.sub, action: 'bulk_delete_members', details: { requested: emails.length, deleted: deleted.length }, ip: request.ip })
    return reply.send({ deleted: deleted.length, deleted_members: deleted, results })
  })

  // ─── SEND RECRUIT EMAIL (generic mailer + OTP flows) ───
  app.post('/send-recruit-email', { preHandler: [authenticateOptional] }, async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, any>
    const to = String(body.to_email ?? '').trim().toLowerCase()

    // public OTP flows
    if (body.kind === 'registration-otp' || body.kind === 'role-registration-otp') {
      const purpose = String(body.purpose ?? 'registration')
      const otpPurpose = purpose.startsWith('role:') ? 'role_registration' : 'password_reset'
      const code = generateOtp()
      await db.insert(emailOtpCodes).values({
        email: to || 'unknown',
        purpose: otpPurpose,
        codeHash: sha256Hash(code),
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      })
      if (!to) throw new BadRequestError('to_email is required')
      const safe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)
      if (!safe) throw new BadRequestError('Invalid to_email')
      const fullName = body.full_name || 'there'
      const { ok, sender, error } = await sendEmail({
        to,
        subject: otpPurpose === 'password_reset' ? 'Your CIIE password reset code' : `Your CIIE ${purpose} verification code`,
        text: `Hi ${fullName},\n\nYour CIIE verification code is ${code}.\nIt expires in 15 minutes.\n\nRegards,\nKL CIIE`,
        html: `<div style="font-family:Arial,sans-serif;padding:24px;color:#0f172a"><h3>Hey ${fullName}</h3><p>Your CIIE verification code is:</p><p style="font-size:28px;font-weight:800;letter-spacing:6px">${code}</p><p>It expires in 15 minutes.</p><p>Regards,<br/><strong>KL CIIE</strong></p></div>`,
      })
      if (!ok) throw new BadRequestError(`Email could not be sent: ${error ?? 'unknown error'}`)
      return reply.send({ ok: true, wait_seconds: 60, account: sender })
    }

    if (body.kind === 'join-verification') {
      const app = body.application_id
        ? await db.query.joinApplications.findFirst({ where: eq(joinApplications.id, body.application_id) })
        : null
      const email = app?.email ?? to
      if (!email) throw new BadRequestError('Could not determine recipient')
      let code = ''
      if (app?.codeHash && app.codeExpiresAt && app.codeExpiresAt > new Date()) {
        const existing = await db.query.emailOtpCodes.findFirst({
          where: and(eq(emailOtpCodes.email, email), isNull(emailOtpCodes.consumedAt), gt(emailOtpCodes.expiresAt, new Date())),
          orderBy: [emailOtpCodes.createdAt],
        })
        if (existing?.codeHash) code = '(code emailed earlier — check your inbox)'
      }
      if (!code) {
        code = generateOtp()
        await db.insert(emailOtpCodes).values({
          email, purpose: 'join_verification', codeHash: sha256Hash(code), expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        })
      }
      const { ok, sender, error } = await sendEmail({
        to: email,
        subject: 'Your CIIE verification code',
        text: code.startsWith('(') ? code : `Your CIIE verification code is ${code}. It expires in 10 minutes.`,
      })
      if (!ok && !code.startsWith('(')) {
        return reply.send({ ok: true, debugCode: code })
      }
      if (!ok) throw new BadRequestError(`Email could not be sent: ${error ?? 'unknown error'}`)
      return reply.send({ ok: true, account: sender })
    }

    // generic / welcome / final-selection emails
    const subject = String(body.subject ?? '')
    const text = String(body.text ?? '')
    const html = String(body.html ?? '')
    if (!to || !subject) throw new BadRequestError('to_email and subject are required')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new BadRequestError('Invalid to_email')

    const { ok, sender, error } = await sendEmail({
      to,
      subject,
      text,
      html,
      applicationId: body.application_id ?? null,
    })
    if (!ok) throw new BadRequestError(`Email could not be sent: ${error ?? 'unknown error'}`)
    return reply.send({ ok: true, account: sender })
  })
}