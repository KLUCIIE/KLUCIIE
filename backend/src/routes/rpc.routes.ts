import type { FastifyInstance, FastifyRequest } from 'fastify'
import crypto from 'node:crypto'
import { db } from '../db/index.js'
import { pgClient } from '../db/index.js'
import * as schema from '../db/schema.js'
import {
  profiles, events, eventRegistrations, attendance,
  memberPointsTransactions, memberQrCodes, adminRecoveryCodes,
  joinApplications, emailOtpCodes, emailVerificationThrottle, recruitApplications,
  recruitFormTemplates, recruitEvaluations, recruitRejectRequests,
  amtpsMembers, startups, smtpSettings, registrationRoles, platformSettings,
} from '../db/schema.js'
import { eq, and, not, asc, desc, sql, isNull, inArray } from 'drizzle-orm'
import { authenticate, authenticateOptional, type JwtPayload } from '../middleware/auth.js'
import { createProfile, getPublicMember } from '../services/auth.service.js'
import { markAttendance, setAttendance } from '../services/attendance.service.js'
import { logAdminEvent } from '../services/audit.service.js'
import { getLeaderboard, getMemberRank, getPointsStats } from '../services/points.service.js'
import { useRecoveryCode, createRecoveryCodes, saveRecoveryCodes } from '../auth/recovery.js'
import { hashPassword } from '../auth/passwords.js'
import { sendEmail } from '../services/email.service.js'
import { generateRegistrationCode, generateOtp, sha256Hash } from '../utils/codes.js'
import { BadRequestError, ForbiddenError, NotFoundError } from '../utils/errors.js'

type Handler = (ctx: { request: FastifyRequest; user: JwtPayload; body: Record<string, any> }) => Promise<any>

function isAdmin(role: string | undefined) {
  return ['super_admin', 'main_admin', 'event_admin', 'member_admin', 'content_admin',
    'gallery_admin', 'reports_admin', 'attendance_coordinator', 'mail_admin'].includes(role ?? '')
}

async function promoteJoinApplication(app: typeof schema.joinApplications.$inferSelect) {
  if (!app.email) return
  const existingProfile = await db.query.profiles.findFirst({ where: eq(profiles.email, app.email) })
  const profileId = existingProfile?.id ?? (
    await createProfile({
      id: crypto.randomUUID(),
      email: app.email,
      fullName: app.fullName ?? undefined,
      studentId: app.studentId ?? undefined,
      phone: app.phone ?? undefined,
      department: app.department ?? undefined,
      yearOfBirth: app.yearOfBirth ?? undefined,
      status: 'recruit',
    })
  ).id

  const existingRa = await db.query.recruitApplications.findFirst({ where: eq(recruitApplications.email, app.email) })
  if (!existingRa) {
    await db.insert(recruitApplications).values({
      memberId: profileId,
      email: app.email,
      fullName: app.fullName ?? null,
      studentId: app.studentId ?? null,
      phone: app.phone ?? null,
      department: app.department ?? null,
      yearOfBirth: app.yearOfBirth ?? null,
      joinFields: (app.fields ?? {}) as Record<string, any>,
      stage: 'gd',
    })
  }
}

const OTP_ALPHABET = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ'
const OTP_BASE = 34n
const OTP_DIGITS = 6

/** HMAC-SHA1 rotating code, mirrors frontend `rotatingCode()` / SQL `registration_otp_at()`. */
function registrationOtp(secret: string, back = 0): string {
  const counter = Math.floor(Date.now() / 1000 / 60) - back
  const msg = Buffer.alloc(8)
  msg.writeBigUInt64BE(BigInt(counter), 0)
  const h = crypto.createHmac('sha1', secret).update(msg).digest()
  const offset = h[h.length - 1] & 0x0f
  const bin =
    ((h[offset] & 0x7f) << 24) |
    ((h[offset + 1] & 0xff) << 16) |
    ((h[offset + 2] & 0xff) << 8) |
    (h[offset + 3] & 0xff)
  let value = BigInt(bin) % OTP_BASE ** BigInt(OTP_DIGITS)
  let out = ''
  for (let i = 0; i < OTP_DIGITS; i++) {
    out = OTP_ALPHABET[Number(value % OTP_BASE)] + out
    value = value / OTP_BASE
  }
  return out
}

/** Signed, window-tagged token proving validate_role_registration passed (migration 0008). */
function registrationToken(slug: string, email: string, window: number, signingSecret: string): string {
  return crypto.createHmac('sha256', signingSecret).update(`${slug}|${email.toLowerCase()}|${window}`).digest('hex')
}

function isSuperAdmin(role: string | undefined) {
  return role === 'super_admin' || role === 'main_admin'
}

function requireAdmin(user: JwtPayload) {
  if (!isAdmin(user.role)) throw new ForbiddenError('Admin role required')
}

function requireSuper(user: JwtPayload) {
  if (!isSuperAdmin(user.role)) throw new ForbiddenError('Super admin role required')
}

async function withScannerName(record: any) {
  if (!record?.markedBy) return record
  const scanner = await db.query.profiles.findFirst({
    where: eq(profiles.id, record.markedBy),
    columns: { fullName: true, ciieId: true },
  })
  return {
    ...record,
    markedBy: scanner ? { full_name: scanner.fullName, ciie_id: scanner.ciieId } : null,
  }
}

function rows(res: any): any[] {
  return Array.isArray(res) ? res : ((res as any)?.rows ?? [])
}

// ─── response key conversion (camelCase → snake_case) ───
// The frontend was written against PostgREST/Supabase and reads snake_case
// everywhere, but drizzle rows/objects come back camelCase. Convert at the
// route boundary so every RPC returns the PostgREST-shaped contract.
// jsonb column values (form_data, fields, social_links, ...) must NOT be
// converted — their inner keys are user data.

const JSONB_COLS = new Set<string>()

for (const [, value] of Object.entries(schema)) {
  const cols = (value as any)?.[Symbol.for('drizzle:Columns')]
  if (!cols || typeof cols !== 'object') continue
  for (const [colKey, col] of Object.entries(cols as Record<string, any>)) {
    if (col && typeof col === 'object' && 'name' in col && col.dataType === 'jsonb') {
      JSONB_COLS.add(colKey)
      JSONB_COLS.add(col.name)
    }
  }
}

for (const alias of ['gd_form_fields', 'interview_form_fields', 'gd_responses', 'interview_responses']) {
  JSONB_COLS.add(alias)
}

function camelToSnake(key: string): string {
  return key.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`)
}

// Event start/end date+times are entered as Asia/Kolkata (UTC+5:30) wall-clock
// values. Same math as the frontend's kolkataMs/endOfDayMs so both sides agree.
function isoDate(d: Date | null | undefined): string | null {
  return d ? d.toISOString().slice(0, 10) : null
}

function kolkataMs(date: Date | null | undefined, time?: string | null): number {
  if (!date) return 0
  const [y, m, dd] = isoDate(date)!.split('-').map(Number)
  const [hh, mm] = (time || '00:00').split(':').map(Number)
  return Date.UTC(y, m - 1, dd, hh - 5, mm - 30, 0)
}

function endOfDayUnix(date: Date | null | undefined): number {
  if (!date) return 0
  const [y, m, dd] = isoDate(date)!.split('-').map(Number)
  return Date.UTC(y, m - 1, dd, 18, 29, 59)
}

function isPlainObjectValue(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !(v instanceof Date) && !Array.isArray(v)
}

function toSnakeResponse(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toSnakeResponse)
  if (!isPlainObjectValue(value)) return value
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(value)) {
    const v = value[key]
    const outputKey = camelToSnake(key)
    if (JSONB_COLS.has(key)) {
      out[outputKey] = v
    } else if (isPlainObjectValue(v) || Array.isArray(v)) {
      out[outputKey] = toSnakeResponse(v)
    } else if (v instanceof Date) {
      out[outputKey] = v.toISOString()
    } else {
      out[outputKey] = v
    }
  }
  return out
}

const handlers: Record<string, Handler> = {}

// ─── AUDIT / AUTH ───
handlers['log_admin_event'] = async ({ request, user, body }) => {
  await logAdminEvent({
    actorId: user.sub,
    action: body.p_action ?? body.action,
    entityType: body.p_entity_type ?? body.entity_type ?? null,
    entityId: body.p_entity_id ? String(body.p_entity_id) : (body.entity_id ? String(body.entity_id) : undefined),
    details: body.p_details ?? body.details ?? null,
    ip: request.ip,
  })
  return {}
}

handlers['log_failed_admin_login'] = async ({ request, body }) => {
  const email = body.p_email ?? body.email
  const prof = email ? await db.query.profiles.findFirst({ where: eq(profiles.email, email) }) : null
  await logAdminEvent({
    actorId: prof?.id ?? null as any,
    action: 'failed_admin_login',
    entityType: 'profile',
    entityId: (prof?.id ?? email) ?? undefined,
    ip: request.ip,
  })
  return {}
}

handlers['record_login'] = async ({ user, body }) => {
  const userId = body.p_user_id ?? user.sub
  await db.update(profiles).set({ lastLoginAt: new Date(), updatedAt: new Date() }).where(eq(profiles.id, userId))
  return {}
}

handlers['ensure_my_profile'] = async ({ user }) => {
  const existing = await db.query.profiles.findFirst({ where: eq(profiles.id, user.sub) })
  if (!existing) {
    await createProfile({ id: user.sub, email: `member-${user.sub}@kluniversity.in`, fullName: 'Member' })
  }
  return { created: !existing }
}

handlers['get_audit_logs'] = async ({ user, body }) => {
  requireAdmin(user)
  const limit = Number(body.p_limit ?? 300)
  const res = await pgClient`
    SELECT l.*, p.full_name as actor_full_name, p.email as actor_email
    FROM admin_audit_logs l
    LEFT JOIN profiles p ON p.id = l.actor_id
    ORDER BY l.created_at DESC
    LIMIT ${limit}
  `
  return rows(res)
}

handlers['expire_temporary_roles'] = async () => {
  const res = await pgClient`
    UPDATE profiles
    SET role = COALESCE(pre_temp_role, 'member'), pre_temp_role = NULL, temp_role_expires_at = NULL, updated_at = NOW()
    WHERE temp_role_expires_at IS NOT NULL AND temp_role_expires_at < NOW()
  `
  return { updated: (res as any)?.count ?? 0 }
}

// ─── POINTS ───
handlers['get_leaderboard'] = async ({ body }) => {
  return getLeaderboard({
    academicYear: body.p_academic_year ?? null,
    department: body.p_department ?? null,
    year: body.p_year ?? null,
    team: body.p_team ?? null,
    period: body.p_period ?? 'all',
  })
}

handlers['get_points_stats'] = async () => getPointsStats()

handlers['get_member_rank'] = async ({ user, body }) => {
  const memberId = body.p_member_id ?? user.sub
  return getMemberRank(memberId)
}

handlers['award_points'] = async ({ user, body }) => {
  requireAdmin(user)
  const [tx] = await db.insert(memberPointsTransactions).values({
    memberId: body.p_member_id ?? body.memberId,
    points: Number(body.p_points ?? body.points ?? 0),
    activityType: body.p_activity_type ?? body.activity_type ?? 'other',
    description: body.p_description ?? body.description ?? null,
    eventId: body.p_event_id ?? body.eventId ?? null,
    awardedBy: user.sub,
    isAutomatic: false,
  }).returning()
  return tx
}

handlers['get_member_events_worked'] = async ({ user, body }) => {
  const memberId = body.p_member_id ?? user.sub
  const res = await pgClient`
    SELECT
      e.id, e.title, e.start_date, e.end_date, e.category, e.mode,
      r.name as role_name, r.category as role_category,
      tm.hours_worked, tm.created_at as joined_at
    FROM event_team_members tm
    JOIN events e ON e.id = tm.event_id
    JOIN event_roles r ON r.id = tm.role_id
    WHERE tm.member_id = ${memberId}
    ORDER BY e.start_date DESC
  `
  return rows(res)
}

// ─── PUBLIC MEMBER ───
handlers['get_public_member'] = async ({ body }) => {
  const memberId = body.p_member_id ?? body.member_id
  return getPublicMember(memberId)
}

// ─── RECOVERY CODE ───
handlers['generate_recovery_codes'] = async ({ user, body }) => {
  const provided = Array.isArray(body.p_codes) && body.p_codes.length > 0
    ? body.p_codes.map(String)
    : null
  const codes = provided
    ? await saveRecoveryCodes(user.sub, provided)
    : await createRecoveryCodes(user.sub)
  await logAdminEvent({ actorId: user.sub, action: 'generate_recovery_codes', ip: '' })
  return { codes }
}

handlers['use_recovery_code'] = async ({ request, user, body }) => {
  const valid = await useRecoveryCode(user.sub, body.p_code, request.ip)
  if (!valid) throw new BadRequestError('Invalid or already used recovery code')
  return { valid: true }
}

handlers['reset_admin_mfa'] = async ({ user, body }) => {
  requireSuper(user)
  const targetId = body.p_admin_id
  await db.update(profiles).set({
    mfaEnabled: false,
    mfaSetupRequired: false,
    updatedAt: new Date(),
  }).where(eq(profiles.id, targetId))
  await db.delete(adminRecoveryCodes).where(eq(adminRecoveryCodes.adminId, targetId))
  return { success: true }
}

// ─── EVENTS / REGISTRATIONS ───
handlers['get_event_counts'] = async () => {
  const res = await pgClient`
    SELECT event_id, COUNT(*)::int as registrations
    FROM event_registrations
    WHERE status = 'confirmed'
    GROUP BY event_id
  `
  return rows(res)
}

handlers['create_registration'] = async ({ request, body }) => {
  const event = await db.query.events.findFirst({ where: eq(events.id, body.p_event_id) })
  if (!event) throw new NotFoundError('Event')
  if (!event.registrationEnabled) throw new BadRequestError('Registrations are closed')
  if (event.registrationDeadline && event.registrationDeadline.getTime() < Date.now()) {
    throw new BadRequestError('Registrations are closed — the registration deadline has passed')
  }

  const email = (body.p_email ?? '').toLowerCase()
  const existing = await db.query.eventRegistrations.findFirst({
    where: and(eq(eventRegistrations.eventId, body.p_event_id), eq(eventRegistrations.email, email)),
  })
  if (existing) throw new BadRequestError('You are already registered for this event')

  const [reg] = await db.insert(eventRegistrations).values({
    eventId: body.p_event_id,
    attendeeName: body.p_attendee_name ?? body.attendee_name ?? 'Attendee',
    email,
    phone: body.p_phone ?? body.phone ?? null,
    department: body.p_department ?? body.department ?? null,
    studentId: body.p_student_id ?? body.student_id ?? null,
    college: body.p_college ?? body.college ?? null,
    registrationCode: generateRegistrationCode(),
    formData: body.p_form_data ?? body.form_data ?? {},
    status: 'confirmed',
  }).returning()

  const member = body.p_email ? await db.query.profiles.findFirst({ where: eq(profiles.email, email) }) : null
  if (member) {
    await db.update(eventRegistrations).set({ memberId: member.id }).where(eq(eventRegistrations.id, reg.id))
  }
  return reg
}

handlers['get_my_ticket'] = async ({ user, body }) => {
  const regId = body.p_registration_id
  const reg = await db.query.eventRegistrations.findFirst({
    where: eq(eventRegistrations.id, regId),
  })
  if (!reg) throw new NotFoundError('Registration')
  return reg
}

handlers['admin_get_event_stats'] = async ({ user, body }) => {
  requireAdmin(user)
  const eventId = body.p_event_id ?? body.event_id ?? null
  const whereSql = eventId ? 'e.id = $1' : 'TRUE'
  const params = eventId ? [eventId] : ([] as unknown[])
  const rows = await pgClient.unsafe(
    `SELECT
       e.id AS event_id, e.title, e.status, e.start_date::date AS start_date,
       e.attendance_rounds,
       COALESCE(r.registrations, 0)::bigint AS registrations,
       COALESCE(a.present, 0)::bigint AS present,
       GREATEST(COALESCE(r.registrations, 0) - COALESCE(a.present, 0), 0)::bigint AS absent,
       COALESCE(t.team_size, 0)::bigint AS team_size,
       COALESCE(c.certificates, 0)::bigint AS certificates
     FROM events e
     LEFT JOIN (SELECT event_id, COUNT(*)::bigint AS registrations FROM event_registrations GROUP BY event_id) r ON r.event_id = e.id
     LEFT JOIN (SELECT event_id, COUNT(DISTINCT member_id)::bigint AS present FROM attendance WHERE status = 'present' GROUP BY event_id) a ON a.event_id = e.id
     LEFT JOIN (SELECT event_id, COUNT(*)::bigint AS team_size FROM event_team_members GROUP BY event_id) t ON t.event_id = e.id
     LEFT JOIN (SELECT event_id, COUNT(*)::bigint AS certificates FROM certificates GROUP BY event_id) c ON c.event_id = e.id
     WHERE ${whereSql}
     ORDER BY e.start_date DESC`,
    params as any[],
  )
  return Array.isArray(rows) ? rows : [rows]
}

handlers['admin_delete_event'] = async ({ user, body }) => {
  requireAdmin(user)
  await db.delete(events).where(eq(events.id, body.p_event_id ?? body.event_id)).returning()
  return { success: true }
}

// ─── ATTENDANCE ───
handlers['get_scan_details'] = async ({ body }) => {
  const eventId = body.p_event_id ?? body.event_id
  const regCode = body.p_registration_code ?? body.registration_code ?? null
  const memberId = body.p_member_id ?? body.member_id ?? null

  let reg = null
  let member = null
  if (regCode) {
    reg = await db.query.eventRegistrations.findFirst({
      where: and(
        eq(eventRegistrations.eventId, eventId),
        eq(eventRegistrations.registrationCode, regCode),
        not(eq(eventRegistrations.status, 'cancelled')),
      ),
    })
    if (reg?.memberId) {
      member = await db.query.profiles.findFirst({ where: eq(profiles.id, reg.memberId) })
    }
  } else if (memberId) {
    member = await db.query.profiles.findFirst({ where: eq(profiles.id, memberId) })
    if (member) {
      reg = await db.query.eventRegistrations.findFirst({
        where: and(
          eq(eventRegistrations.eventId, eventId),
          eq(eventRegistrations.memberId, memberId),
          not(eq(eventRegistrations.status, 'cancelled')),
        ),
      })
    }
  }
  if (regCode && !reg) return null
  if (memberId && !member) return null

  let att = null
  if (reg) {
    att = await db.query.attendance.findFirst({
      where: and(eq(attendance.eventId, eventId), eq(attendance.registrationId, reg.id)),
      orderBy: desc(attendance.markedAt),
    })
  } else if (member) {
    att = await db.query.attendance.findFirst({
      where: and(
        eq(attendance.eventId, eventId),
        eq(attendance.memberId, member.id),
        eq(attendance.status, 'present'),
      ),
      orderBy: desc(attendance.markedAt),
    })
  }

  let markedBy: { full_name: string | null; ciie_id: string | null } | null = null
  if (att?.markedBy) {
    const p = await db.query.profiles.findFirst({ where: eq(profiles.id, att.markedBy) })
    if (p) markedBy = { full_name: p.fullName, ciie_id: p.ciieId }
  }

  return {
    name: member?.fullName ?? reg?.attendeeName ?? null,
    ciie_id: member?.ciieId ?? null,
    student_id: member?.studentId ?? reg?.studentId ?? null,
    email: member?.email ?? reg?.email ?? null,
    phone: member?.phone ?? reg?.phone ?? null,
    department: member?.department ?? reg?.department ?? null,
    year_of_study: member?.yearOfBirth ?? reg?.yearOfBirth ?? null,
    college: reg?.college ?? null,
    registration_code: reg?.registrationCode ?? null,
    round: att?.round ?? null,
    status: att?.status ?? null,
    method: att?.method ?? null,
    marked_at: att?.markedAt ?? null,
    marked_by: markedBy,
  }
}

handlers['mark_attendance'] = async ({ user, body }) => {
  const record = await markAttendance({
    eventId: body.p_event_id ?? body.event_id,
    registrationCode: body.p_registration_code ?? body.registration_code ?? null,
    memberCode: body.p_member_code ?? body.member_code ?? null,
    method: 'qr',
    round: Number(body.p_round ?? 1),
    markedBy: user.sub,
  })
  return await withScannerName(record)
}

handlers['admin_mark_attendance_code'] = async ({ user, body }) => {
  requireAdmin(user)
  const record = await markAttendance({
    eventId: body.p_event_id ?? body.event_id,
    registrationCode: body.p_registration_code ?? body.registration_code ?? null,
    memberCode: body.p_member_code ?? body.member_code ?? null,
    method: 'qr',
    round: Number(body.p_round ?? 1),
    markedBy: user.sub,
  })
  return await withScannerName(record)
}

handlers['admin_set_attendance'] = async ({ user, body }) => {
  requireAdmin(user)
  const eventId = body.p_event_id ?? body.event_id
  const memberId = body.p_member_id ?? body.member_id
  const status = body.p_status ?? body.status ?? 'present'
  const existing = await db.query.attendance.findFirst({
    where: and(eq(attendance.eventId, eventId), eq(attendance.memberId, memberId)),
  })
  if (existing) {
    return setAttendance(existing.id, status)
  }
  const [rec] = await db.insert(attendance).values({
    eventId, memberId, status, method: 'manual', round: 1, markedBy: user.sub,
  }).returning()
  return rec
}

handlers['link_my_event_registrations'] = async ({ user }) => {
  const profile = await db.query.profiles.findFirst({ where: eq(profiles.id, user.sub) })
  if (!profile?.email) return { linked: 0 }
  const res = await pgClient`
    UPDATE event_registrations SET member_id = ${user.sub}
    WHERE email ILIKE ${profile.email} AND member_id IS NULL
  `
  return { linked: (res as any)?.count ?? 0 }
}

handlers['get_my_event_attendance_qr'] = async ({ user, body }) => {
  const eventId = body.p_event_id ?? body.event_id
  const event = await db.query.events.findFirst({ where: eq(events.id, eventId) })
  if (!event) throw new NotFoundError('Event')

  const qr = await db.query.memberQrCodes.findFirst({ where: eq(memberQrCodes.memberId, user.sub) })
  if (!qr) return null

  const now = Date.now()
  const startMs = kolkataMs(event.startDate, event.startTime)
  const endMs = event.endDate
    ? event.endTime
      ? kolkataMs(event.endDate, event.endTime)
      : endOfDayUnix(event.endDate)
    : 0

  const windows = await db.query.eventRoundWindows.findMany({
    where: eq(schema.eventRoundWindows.eventId, eventId),
    orderBy: asc(schema.eventRoundWindows.round),
  })
  const roundWindows = windows.map((w) => ({
    round: w.round,
    starts_at: w.startsAt ?? null,
    ends_at: w.endsAt ?? null,
  }))
  const activeWindow = roundWindows.find(
    (w) => w.starts_at && w.ends_at && now >= new Date(w.starts_at).getTime() && now < new Date(w.ends_at).getTime(),
  )

  const attRecord = await db.query.attendance.findFirst({
    where: and(eq(attendance.eventId, eventId), eq(attendance.memberId, user.sub)),
  })

  const roundsCount = Math.max(1, event.attendanceRounds ?? 1)
  const rounds = Array.from({ length: roundsCount }, (_, i) => ({
    round: i + 1,
    code: qr.code,
    status: attRecord?.status === 'present' ? 'present' : null,
  }))

  const started = now >= startMs && event.status !== 'draft'
  const closed =
    event.status === 'completed' ||
    event.status === 'cancelled' ||
    (endMs > 0 && now >= endMs)

  return {
    started,
    closed,
    attendance_rounds: roundsCount,
    rounds,
    active_round: activeWindow?.round ?? (roundWindows.length ? null : 1),
    round_windows: roundWindows,
    audience: event.audience === 'faculty' ? 'faculty' : 'members',
    event_title: event.title,
    start_date: isoDate(event.startDate),
    start_time: event.startTime,
    end_date: isoDate(event.endDate),
    end_time: event.endTime,
  }
}

// ─── MFA via auth ───
handlers['reset_password_with_otp'] = async ({ body }) => {
  const email = (body.p_email ?? '').toLowerCase()
  const code = body.p_code
  const newPassword = body.p_new_password ?? body.new_password
  const otp = await db.query.emailOtpCodes.findFirst({
    where: and(
      eq(emailOtpCodes.email, email),
      eq(emailOtpCodes.purpose, 'password_reset'),
      eq(emailOtpCodes.codeHash, sha256Hash(code)),
      isNull(emailOtpCodes.consumedAt),
    ),
  })
  if (!otp) throw new BadRequestError('Invalid or expired code')
  if (otp.expiresAt < new Date()) throw new BadRequestError('Code has expired')
  if (otp.attempts >= 5) throw new BadRequestError('Too many attempts')

  await db.update(emailOtpCodes).set({ consumedAt: new Date() }).where(eq(emailOtpCodes.id, otp.id))
  const hash = await hashPassword(newPassword)
  const profile = await db.query.profiles.findFirst({ where: eq(profiles.email, email) })
  if (!profile) throw new NotFoundError('Account')
  await db.execute(sql`
    UPDATE profiles SET custom_fields = COALESCE(custom_fields, '{}'::jsonb) ||
      jsonb_build_object('password_hash', ${hash}), updated_at = NOW() WHERE id = ${profile.id}
  `)
  return { success: true }
}

// ─── EMAIL / OTP / JOIN ───
handlers['email_send_status'] = async ({ body }) => {
  const email = (body.p_email ?? '').toLowerCase()
  const throttle = await db.query.emailVerificationThrottle.findFirst({ where: eq(emailVerificationThrottle.email, email) })
  if (!throttle) return { wait_seconds: 0, resend_count: 0, locked: false }
  const now = Date.now()
  const lockedUntil = throttle.lockedUntil ? new Date(throttle.lockedUntil).getTime() : 0
  const lastSent = throttle.lastSentAt ? new Date(throttle.lastSentAt).getTime() : 0
  return {
    wait_seconds: Math.max(0, Math.ceil((lastSent + 60_000 - now) / 1000)),
    resend_count: throttle.resendCount,
    locked: lockedUntil > now,
    lock_seconds: Math.max(0, Math.ceil((lockedUntil - now) / 1000)),
  }
}

handlers['verify_email_otp'] = async ({ body }) => {
  const email = (body.p_email ?? '').toLowerCase()
  const code = body.p_code
  const purpose = body.p_purpose ?? 'join_verification'
  const otp = await db.query.emailOtpCodes.findFirst({
    where: and(
      eq(emailOtpCodes.email, email),
      eq(emailOtpCodes.purpose, purpose),
      eq(emailOtpCodes.codeHash, sha256Hash(code)),
      isNull(emailOtpCodes.consumedAt),
    ),
  })
  if (!otp) throw new BadRequestError('Invalid verification code')
  if (otp.expiresAt < new Date()) throw new BadRequestError('Code has expired')
  await db.update(emailOtpCodes).set({ consumedAt: new Date() }).where(eq(emailOtpCodes.id, otp.id))
  return { verified: true }
}

handlers['apply_to_ciie'] = async ({ request, body }) => {
  const email = (body.p_email ?? '').toLowerCase()

  const settings = await db.query.platformSettings.findFirst({ where: eq(platformSettings.id, 1) })
  if (settings?.signupDeadline && settings.signupDeadline.getTime() < Date.now()) {
    return { application_id: null, to_email: email, full_name: body.p_full_name ?? '', duplicate: false, reason: 'closed' }
  }

  const liveApp = await db.query.recruitApplications.findFirst({
    where: and(eq(recruitApplications.email, email), inArray(recruitApplications.stage, ['gd', 'interview', 'final'])),
  })
  if (liveApp) return { application_id: null, to_email: email, full_name: body.p_full_name, duplicate: true, reason: 'in-review', stage: liveApp.stage }

  const existingProfile = await db.query.profiles.findFirst({ where: eq(profiles.email, email) })
  if (existingProfile) return { application_id: null, to_email: email, full_name: body.p_full_name, duplicate: true, reason: 'member' }

  const existingApp = await db.query.joinApplications.findFirst({
    where: and(eq(joinApplications.email, email), inArray(joinApplications.status, ['pending', 'submitted'])),
  })
  if (existingApp) {
    if (existingApp.status === 'submitted') {
      return { application_id: null, to_email: email, full_name: body.p_full_name, duplicate: true, reason: 'in-review' }
    }
    return { application_id: existingApp.id, full_name: existingApp.fullName, to_email: existingApp.email, duplicate: true, reason: 'pending' }
  }

  const code = generateOtp()
  const [app] = await db.insert(joinApplications).values({
    email,
    fullName: body.p_full_name ?? '',
    studentId: body.p_student_id ?? null,
    phone: body.p_phone ?? null,
    department: body.p_department ?? null,
    yearOfBirth: body.p_year_of_study ?? null,
    fields: body.p_fields ?? {},
    status: 'pending',
    codeHash: sha256Hash(code),
    codeExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
  }).returning()

  const throttle = await db.query.emailVerificationThrottle.findFirst({ where: eq(emailVerificationThrottle.email, email) })
  if (throttle) {
    await db.update(emailVerificationThrottle).set({
      resendCount: throttle.resendCount + 1,
      lastSentAt: new Date(),
    }).where(eq(emailVerificationThrottle.email, email))
  } else {
    await db.insert(emailVerificationThrottle).values({ email, resendCount: 1, lastSentAt: new Date() })
  }

  if (!settings?.signupEmailOtp) {
    await promoteJoinApplication(app)
  }
  let delivered = false
  try {
    delivered = (await sendEmail({
      to: email,
      subject: 'Your CIIE verification code',
      text: `Your CIIE verification code is ${code}. It expires in 10 minutes.`,
    })).ok
  } catch {
    // code is stored so verification still works
  }

  return {
    application_id: app.id,
    to_email: email,
    full_name: app.fullName,
    ...(delivered ? {} : { debug_code: code }),
  }
}

handlers['verify_join_application'] = async ({ body }) => {
  const id = body.p_id ?? body.p_application_id ?? body.application_id
  const code = body.p_code ?? body.code
  const app = await db.query.joinApplications.findFirst({ where: eq(joinApplications.id, id) })
  if (!app) throw new NotFoundError('Application')
  if (!app.codeHash || app.codeHash !== sha256Hash(code)) {
    throw new BadRequestError('Invalid verification code')
  }
  if (app.codeExpiresAt && app.codeExpiresAt < new Date()) throw new BadRequestError('Code has expired')
  if (app.codeAttempts >= 5) throw new BadRequestError('Too many attempts')

  await db.update(joinApplications).set({
    status: 'submitted',
    verifiedAt: new Date(),
    codeExpiresAt: null,
  }).where(eq(joinApplications.id, id))

  await promoteJoinApplication(app)

  const raRow = await db.query.recruitApplications.findFirst({ where: eq(recruitApplications.email, app.email) })

  try {
    await sendEmail({
      to: app.email,
      subject: 'CIIE application received',
      text: `Hi ${app.fullName}, your CIIE application has been received. We will review it and get back to you.`,
    })
  } catch {}

  return {
    ok: true,
    verified: true,
    application_id: id,
    email: app.email,
    batch: raRow?.interviewBatch ?? null,
  }
}

// ─── REGISTRATION ROLES ───
handlers['get_registration_role'] = async ({ body }) => {
  const role = await db.query.registrationRoles.findFirst({
    where: and(eq(registrationRoles.slug, body.p_slug ?? body.slug), eq(registrationRoles.enabled, true)),
  })
  if (!role) throw new NotFoundError('Role')
  return {
    role: role.role,
    slug: role.slug,
    label: role.label,
    enabled: role.enabled,
    fields: role.fields,
    requires_keys: role.requiresKeys,
  }
}

handlers['validate_role_registration'] = async ({ body }) => {
  const slug = body.p_slug ?? body.slug
  const staticKey = String(body.p_static_key ?? body.static_key ?? '').trim()
  const code = String(body.p_code ?? body.code ?? '').trim()
  const email = String(body.p_email ?? body.email ?? '').toLowerCase().trim()
  if (!email || email.indexOf('@') === -1) {
    return { valid: false, error: 'Please enter a valid email address.' }
  }

  const settings = await db.query.platformSettings.findFirst({ where: eq(platformSettings.id, 1) })
  if (settings?.signupDeadline && settings.signupDeadline.getTime() < Date.now()) {
    return { valid: false, error: 'Registrations are closed.' }
  }
  if (settings?.signupDomainRestriction) {
    const domain = email.split('@').pop()?.toLowerCase() ?? ''
    const allowed = (settings.signupAllowedDomains ?? []).map((d) => d.toLowerCase())
    const ok = allowed.length === 0 || allowed.some((d) => domain === d || domain.endsWith('.' + d))
    if (!ok) {
      return { valid: false, error: `Registration is limited to ${allowed.join(', ')} email addresses.` }
    }
  }

  const role = await db.query.registrationRoles.findFirst({
    where: and(eq(registrationRoles.slug, slug), eq(registrationRoles.enabled, true)),
  })
  if (!role) return { valid: false, error: 'This registration page is not available.' }

  if (role.requiresKeys) {
    if (!staticKey || staticKey !== role.secret) {
      return { valid: false, error: 'The registration key is incorrect.' }
    }
    const current = registrationOtp(role.secret)
    const previous = registrationOtp(role.secret, 1)
    if (code.toUpperCase() !== current && code.toUpperCase() !== previous) {
      return { valid: false, error: 'The MFA code is incorrect or expired. Codes change every minute.' }
    }
  }

  const window = Math.floor(Date.now() / 1000 / 60)
  const token = registrationToken(slug, email, window, role.signingSecret)
  return { valid: true, error: null, token, role: role.role, label: role.label }
}

// ─── RECRUIT ───
handlers['get_recruit_applications'] = async () => {
  const res = await pgClient`
    SELECT
      a.id as application_id, a.member_id, a.stage,
      COALESCE(NULLIF(a.full_name, ''), p.full_name) as full_name,
      COALESCE(NULLIF(a.email, ''), p.email) as email,
      COALESCE(NULLIF(a.phone, ''), p.phone) as phone,
      COALESCE(NULLIF(a.department, ''), p.department) as department,
      COALESCE(NULLIF(a.year_of_study, ''), p.year_of_study) as year_of_study,
      COALESCE(NULLIF(a.student_id, ''), p.student_id) as student_id,
      a.interview_batch,
      a.gd_form_id, a.interview_form_id,
      a.gd_submitted_at, a.interview_submitted_at, a.final_decision, a.final_message,
      a.decided_by, a.decided_at, a.created_at,
      p.ciie_id,
      gf.title as gd_form_title, gf.fields as gd_form_fields,
      sgf.title as interview_form_title, sgf.fields as interview_form_fields,
      gd_e.full_name as gd_evaluator, gd_eval.remarks as gd_remarks, gd_eval.responses as gd_responses,
      iv_e.full_name as interview_evaluator, iv_eval.remarks as interview_remarks, iv_eval.responses as interview_responses,
      COALESCE((
        SELECT json_agg(json_build_object(
          'evaluator_id', ev.evaluator_id,
          'evaluator_name', evp.full_name,
          'evaluator_ciie_id', evp.ciie_id,
          'submitted_at', ev.submitted_at,
          'responses', ev.responses,
          'remarks', ev.remarks
        ) ORDER BY ev.submitted_at)
        FROM recruit_evaluations ev
        LEFT JOIN profiles evp ON evp.id = ev.evaluator_id
        WHERE ev.application_id = a.id AND ev.kind = 'gd'
      ), '[]'::json) as gd_evaluations,
      COALESCE((
        SELECT json_agg(json_build_object(
          'evaluator_id', ev.evaluator_id,
          'evaluator_name', evp.full_name,
          'evaluator_ciie_id', evp.ciie_id,
          'submitted_at', ev.submitted_at,
          'responses', ev.responses,
          'remarks', ev.remarks
        ) ORDER BY ev.submitted_at)
        FROM recruit_evaluations ev
        LEFT JOIN profiles evp ON evp.id = ev.evaluator_id
        WHERE ev.application_id = a.id AND ev.kind = 'interview'
      ), '[]'::json) as interview_evaluations
    FROM recruit_applications a
    LEFT JOIN profiles p ON p.id = a.member_id
    LEFT JOIN recruit_form_templates gf ON gf.id = a.gd_form_id
    LEFT JOIN recruit_form_templates sgf ON sgf.id = a.interview_form_id
    LEFT JOIN recruit_evaluations gd_eval ON gd_eval.application_id = a.id AND gd_eval.kind = 'gd'
    LEFT JOIN profiles gd_e ON gd_e.id = gd_eval.evaluator_id
    LEFT JOIN recruit_evaluations iv_eval ON iv_eval.application_id = a.id AND iv_eval.kind = 'interview'
    LEFT JOIN profiles iv_e ON iv_e.id = iv_eval.evaluator_id
    WHERE (a.full_name IS NOT NULL AND a.full_name <> '')
       OR (p.full_name IS NOT NULL AND p.full_name <> '')
    ORDER BY a.created_at ASC
  `
  return rows(res)
}

handlers['submit_recruit_evaluation'] = async ({ user, body }) => {
  const applicationId = body.p_application_id ?? body.application_id
  const kind = body.p_kind ?? body.kind
  const existing = await db.query.recruitEvaluations.findFirst({
    where: and(
      eq(recruitEvaluations.applicationId, applicationId),
      eq(recruitEvaluations.kind, kind),
      eq(recruitEvaluations.evaluatorId, user.sub),
    ),
  })
  if (existing) {
    await db.update(recruitEvaluations).set({
      responses: body.p_responses ?? body.responses ?? {},
      remarks: body.p_remarks ?? body.remarks ?? null,
      submittedAt: new Date(),
    }).where(eq(recruitEvaluations.id, existing.id))
  } else {
    await db.insert(recruitEvaluations).values({
      applicationId, kind, evaluatorId: user.sub,
      responses: body.p_responses ?? body.responses ?? {},
      remarks: body.p_remarks ?? body.remarks ?? null,
    })
  }
  const updates: any = { updatedAt: new Date() }
  if (kind === 'gd') { updates.gdSubmittedAt = new Date(); updates.stage = 'interview' }
  if (kind === 'interview') updates.interviewSubmittedAt = new Date()
  await db.update(recruitApplications).set(updates).where(eq(recruitApplications.id, applicationId))
  return { success: true }
}

handlers['forward_recruit_to_final'] = async ({ body }) => {
  const applicationId = body.p_application_id ?? body.application_id
  await db.update(recruitApplications).set({
    stage: 'final',
    interviewSubmittedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(recruitApplications.id, applicationId))
  return { success: true }
}

handlers['select_recruit'] = async ({ user, body }) => {
  const applicationId = body.p_application_id ?? body.application_id
  const accepted = body.p_accepted !== undefined ? body.p_accepted
    : body.accepted !== undefined ? body.accepted
    : true
  const message = body.p_message ?? body.final_message ?? null
  await db.update(recruitApplications).set({
    stage: accepted ? 'selected' : 'rejected',
    finalDecision: accepted ? 'selected' : 'rejected',
    finalMessage: message,
    decidedBy: user.sub,
    decidedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(recruitApplications.id, applicationId))
  const app = await db.query.recruitApplications.findFirst({ where: eq(recruitApplications.id, applicationId) })
  if (app?.memberId) {
    await db.update(profiles).set({
      status: accepted ? 'active' : 'disabled',
      role: accepted ? 'member_ciie' : 'member',
      updatedAt: new Date(),
    }).where(eq(profiles.id, app.memberId))
  }
  let mail: Record<string, unknown> | null = null
  if (accepted && app?.email) {
    const fname = app.fullName || 'there'
    const bodyText = [
      `Hi ${fname},`,
      '',
      message ?? 'Congratulations! You have been selected to be part of the KL CIIE family.',
      '',
      `Sign in at ${process.env.FRONTEND_URL ?? 'http://localhost:5173'} to get started.`,
      '',
      'Regards,',
      'KL CIIE',
    ].join('\n')
    mail = {
      to_email: app.email,
      subject: 'Welcome to KL CIIE 🎉',
      text: bodyText,
      html: `<div style="font-family:Arial,sans-serif;padding:24px;color:#0f172a"><h3>Hi ${fname}</h3><p>${(message ?? 'Congratulations! You have been selected to be part of the KL CIIE family.').replace(/\n/g, '<br/>')}</p><p>Sign in at <a href="${process.env.FRONTEND_URL ?? 'http://localhost:5173'}">KL CIIE</a> to get started.</p><p>Regards,<br/><strong>KL CIIE</strong></p></div>`,
    }
  }
  return { success: true, ...(mail ?? {}) }
}

handlers['request_reject_all'] = async ({ user, body }) => {
  const [req] = await db.insert(recruitRejectRequests).values({
    requestedBy: user.sub,
    reason: body.p_reason ?? body.reason ?? null,
  }).returning()
  return req
}

handlers['execute_reject_all'] = async ({ user, body }) => {
  const requestId = body.p_request_id ?? body.request_id
  const req = await db.query.recruitRejectRequests.findFirst({ where: eq(recruitRejectRequests.id, requestId) })
  if (!req) throw new NotFoundError('Request')
  if (req.requestedBy !== user.sub) throw new ForbiddenError('Only the requester can execute this request')
  if (req.status !== 'approved') throw new BadRequestError('Request not approved')
  const members = await db.query.profiles.findMany({ where: eq(profiles.status, 'recruit') })
  for (const m of members) {
    await db.update(profiles).set({ status: 'disabled', updatedAt: new Date() }).where(eq(profiles.id, m.id))
  }
  await db.execute(sql`
    UPDATE recruit_applications
    SET stage = 'rejected', final_decision = 'rejected', updated_at = NOW()
    WHERE stage <> 'selected'
  `)
  await db.update(recruitRejectRequests).set({ status: 'used', usedAt: new Date() }).where(eq(recruitRejectRequests.id, requestId))
  return { rejected: members.length }
}

handlers['decide_reject_request'] = async ({ user, body }) => {
  requireAdmin(user)
  const requestId = body.p_request_id ?? body.request_id
  await db.update(recruitRejectRequests).set({
    status: body.p_approved ? 'approved' : 'denied',
    decidedBy: user.sub,
    decidedAt: new Date(),
  }).where(eq(recruitRejectRequests.id, requestId))
  return { success: true }
}

handlers['upsert_recruit_form'] = async ({ user, body }) => {
  requireAdmin(user)
  const id = body.p_id ?? body.id
  const payload = {
    kind: body.p_kind ?? body.kind,
    title: body.p_title ?? body.title,
    description: body.p_description ?? body.description ?? null,
    fields: body.p_fields ?? body.fields ?? [],
    isActive: body.p_is_active ?? body.is_active ?? true,
    createdBy: user.sub,
    updatedAt: new Date(),
  }
  let result: any
  if (id) {
    const [updated] = await db.update(recruitFormTemplates).set(payload).where(eq(recruitFormTemplates.id, id)).returning()
    result = updated
  } else {
    const [inserted] = await db.insert(recruitFormTemplates).values(payload).returning()
    result = inserted
  }
  return result
}

// ─── AMTPS / STARTUPS ───
handlers['admin_add_amtps_member'] = async ({ user, body }) => {
  requireSuper(user)
  const b = body.p_ ?? body
  const [m] = await db.insert(amtpsMembers).values({
    fullName: b.full_name ?? b.p_full_name ?? b.name ?? '',
    email: b.email ?? b.p_email ?? null,
    studentId: b.student_id ?? b.p_student_id ?? null,
    department: b.department ?? b.p_department ?? null,
    yearOfBirth: b.year_of_study ?? b.p_year_of_study ?? null,
    position: b.position ?? b.p_position ?? null,
    domain: b.domain ?? b.p_domain ?? null,
    about: b.about ?? b.p_about ?? null,
    avatarUrl: b.avatar_url ?? b.p_avatar_url ?? null,
    telegram: b.telegram ?? b.p_telegram ?? null,
    github: b.github ?? b.p_github ?? null,
    linkedin: b.linkedin ?? b.p_linkedin ?? null,
    contactEmail: b.contact_email ?? b.p_contact_email ?? null,
    displayOrder: Number(b.display_order ?? b.p_display_order ?? 0),
    wing: b.wing ?? b.p_wing ?? null,
  }).returning()
  return m
}

handlers['admin_update_amtps_member'] = async ({ user, body }) => {
  requireSuper(user)
  const id = body.p_id ?? body.id
  const b = body
  const [m] = await db.update(amtpsMembers).set({
    fullName: b.full_name ?? b.p_full_name,
    email: b.email ?? b.p_email ?? null,
    studentId: b.student_id ?? b.p_student_id ?? null,
    department: b.department ?? b.p_department ?? null,
    yearOfBirth: b.year_of_study ?? b.p_year_of_study ?? null,
    position: b.position ?? b.p_position ?? null,
    domain: b.domain ?? b.p_domain ?? null,
    about: b.about ?? b.p_about ?? null,
    avatarUrl: b.avatar_url ?? b.p_avatar_url ?? null,
    telegram: b.telegram ?? b.p_telegram ?? null,
    github: b.github ?? b.p_github ?? null,
    linkedin: b.linkedin ?? b.p_linkedin ?? null,
    contactEmail: b.contact_email ?? b.p_contact_email ?? null,
    displayOrder: Number(b.display_order ?? b.p_display_order ?? 0),
    wing: b.wing ?? b.p_wing ?? null,
    updatedAt: new Date(),
  }).where(eq(amtpsMembers.id, id)).returning()
  return m
}

handlers['admin_delete_amtps_member'] = async ({ user, body }) => {
  requireSuper(user)
  await db.delete(amtpsMembers).where(eq(amtpsMembers.id, body.p_id ?? body.id))
  return { success: true }
}

handlers['admin_add_startup'] = async ({ user, body }) => {
  requireSuper(user)
  const b = body.p_ ?? body
  const [s] = await db.insert(startups).values({
    name: b.name ?? '',
    websiteUrl: b.website_url ?? null,
    logoUrl: b.logo_url ?? null,
    bannerUrl: b.banner_url ?? null,
    contactEmail: b.contact_email ?? null,
    location: b.location ?? null,
    socialLinks: b.social_links ?? {},
    displayOrder: Number(b.display_order ?? 0),
  }).returning()
  return s
}

handlers['admin_update_startup'] = async ({ user, body }) => {
  requireSuper(user)
  const [s] = await db.update(startups).set({
    name: body.name ?? body.p_name,
    websiteUrl: body.website_url ?? body.p_website_url ?? null,
    logoUrl: body.logo_url ?? body.p_logo_url ?? null,
    bannerUrl: body.banner_url ?? body.p_banner_url ?? null,
    contactEmail: body.contact_email ?? body.p_contact_email ?? null,
    location: body.location ?? body.p_location ?? null,
    socialLinks: body.social_links ?? body.p_social_links ?? {},
    displayOrder: Number(body.display_order ?? body.p_display_order ?? 0),
    updatedAt: new Date(),
  }).where(eq(startups.id, body.p_id ?? body.id)).returning()
  return s
}

handlers['admin_delete_startup'] = async ({ user, body }) => {
  requireSuper(user)
  await db.delete(startups).where(eq(startups.id, body.p_id ?? body.id))
  return { success: true }
}

// ─── SMTP ───
handlers['get_smtp_settings'] = async ({ user }) => {
  requireSuper(user)
  const settings = await db.query.smtpSettings.findMany({ orderBy: [asc(smtpSettings.position)] })
  return settings.map((s) => ({ ...s, password: '' }))
}

handlers['delete_smtp_setting'] = async ({ user, body }) => {
  requireSuper(user)
  await db.delete(smtpSettings).where(eq(smtpSettings.id, body.p_id ?? body.id))
  return { success: true }
}

handlers['save_smtp_settings'] = async ({ user, body }) => {
  requireSuper(user)
  const arr = Array.isArray(body.p_settings)
    ? body.p_settings
    : (body.settings ?? [])
  const out: any[] = []
  for (const [idx, s] of (arr as any[]).entries()) {
    if (s.id && s.id !== 'new') {
      const payload: any = {
        email: s.email,
        fromName: s.from_name ?? 'KL CIIE',
        host: s.host ?? 'smtp.gmail.com',
        port: Number(s.port ?? 465),
        isActive: s.is_active ?? true,
        position: Number(s.position ?? idx),
        updatedAt: new Date(),
      }
      if (s.password) payload.password = s.password
      const [u] = await db.update(smtpSettings).set(payload).where(eq(smtpSettings.id, s.id)).returning()
      out.push({ ...u, password: '' })
    } else {
      const [u] = await db.insert(smtpSettings).values({
        email: s.email, password: s.password ?? '',
        fromName: s.from_name ?? 'KL CIIE',
        host: s.host ?? 'smtp.gmail.com',
        port: Number(s.port ?? 465),
        isActive: s.is_active ?? true,
        position: Number(s.position ?? idx),
      }).returning()
      out.push({ ...u, password: '' })
    }
  }
  return out
}

// ─── ADMIN MEMBER ops ───
handlers['admin_list_member'] = async ({ user, body }) => {
  requireAdmin(user)
  const email = (body.p_email ?? body.email ?? '').toLowerCase()
  const profile = await db.query.profiles.findFirst({ where: eq(profiles.email, email) })
  if (!profile) throw new NotFoundError('Member with that email')
  return profile
}

handlers['admin_delete_user'] = async ({ user, body }) => {
  requireSuper(user)
  const userId = body.p_user_id ?? body.user_id
  await db.delete(profiles).where(eq(profiles.id, userId))
  return { success: true }
}

handlers['admin_register_event_user'] = async ({ user, body }) => {
  requireAdmin(user)
  const eventId = body.p_event_id ?? body.event_id
  const memberId = body.p_member_id ?? body.member_id
  const member = await db.query.profiles.findFirst({ where: eq(profiles.id, memberId) })
  if (!member) throw new NotFoundError('Member')
  const existing = await db.query.eventRegistrations.findFirst({
    where: and(eq(eventRegistrations.eventId, eventId), eq(eventRegistrations.memberId, memberId)),
  })
  if (existing) return existing
  const [reg] = await db.insert(eventRegistrations).values({
    eventId, memberId,
    attendeeName: member.fullName ?? 'Member',
    email: member.email,
    registrationCode: generateRegistrationCode(),
    status: 'confirmed',
  }).returning()
  return reg
}

handlers['admin_force_register_event_users'] = async ({ user, body }) => {
  requireAdmin(user)
  const eventId = body.p_event_id ?? body.event_id
  const memberIds: string[] = body.p_member_ids ?? body.member_ids ?? []
  if (!eventId) throw new BadRequestError('p_event_id is required')
  if (memberIds.length === 0) return { results: [] }

  const results: any[] = []
  for (const memberId of memberIds) {
    const existing = await db.query.eventRegistrations.findFirst({
      where: and(eq(eventRegistrations.eventId, eventId), eq(eventRegistrations.memberId, memberId)),
    })
    if (existing) {
      results.push({ member_id: memberId, ok: true, error: null })
      continue
    }
    const member = await db.query.profiles.findFirst({ where: eq(profiles.id, memberId) })
    if (!member) {
      results.push({ member_id: memberId, ok: false, error: 'Member not found' })
      continue
    }
    try {
      const [reg] = await db.insert(eventRegistrations).values({
        eventId, memberId,
        attendeeName: member.fullName ?? 'Member',
        email: member.email,
        registrationCode: generateRegistrationCode(),
        status: 'confirmed',
      }).returning()
      results.push({ member_id: memberId, ok: true, error: null, registration_id: reg.id })
    } catch (e: any) {
      results.push({ member_id: memberId, ok: false, error: e?.message ?? 'Insert failed' })
    }
  }
  return { results }
}

// ─── MEMBER ADMIN: bulk (via functions route) ───

// RPCs that may be called without a session (mirrors the public site paths)
const PUBLIC_RPC = new Set([
  'get_leaderboard', 'get_event_counts', 'get_scan_details',
  'get_points_stats',
  'apply_to_ciie', 'verify_join_application', 'email_send_status',
  'verify_email_otp', 'get_registration_role', 'validate_role_registration',
  'get_public_member', 'reset_password_with_otp', 'log_failed_admin_login',
])

export default async function rpcRoutes(app: FastifyInstance) {
  app.post<{ Params: { name: string }; Body: Record<string, any> }>(
    '/:name',
    { preHandler: [authenticateOptional] },
    async (request, reply) => {
      const name = request.params.name
      const handler = handlers[name]
      if (!handler) {
        return reply.status(404).send({ error: { message: `RPC "${name}" not implemented` } })
      }
      const user = request.user as JwtPayload | undefined
      if (!user && !PUBLIC_RPC.has(name)) {
        return reply.status(401).send({ error: { message: 'Authentication required' } })
      }
      const body = (request.body ?? {}) as Record<string, any>
      try {
        const data = await handler({ request, user: user as JwtPayload, body })
        return reply.send({ data: toSnakeResponse(data) })
      } catch (err: any) {
        const status = err?.statusCode ?? err?.status ?? 400
        return reply.status(status).send({ error: { message: err?.message ?? String(err) } })
      }
    },
  )
}