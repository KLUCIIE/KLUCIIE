import { db } from '../db/index.js'
import { attendance, eventRegistrations, events, memberQrCodes, profiles } from '../db/schema.js'
import { eq, and, sql } from 'drizzle-orm'
import { NotFoundError, BadRequestError } from '../utils/errors.js'
import { cacheGet, cacheSet, cacheDel } from '../redis/index.js'

export async function markAttendance(params: {
  eventId: string
  registrationCode?: string
  memberCode?: string
  method: 'qr' | 'member_qr' | 'manual'
  round?: number
  markedBy?: string
}) {
  const { eventId, registrationCode, memberCode, method, round = 1, markedBy } = params

  let memberId: string | null = null
  let registrationId: string | null = null

  if (registrationCode) {
    const reg = await db.query.eventRegistrations.findFirst({
      where: and(
        eq(eventRegistrations.eventId, eventId),
        eq(eventRegistrations.registrationCode, registrationCode),
      ),
    })
    if (!reg) throw new NotFoundError('Registration')
    memberId = reg.memberId
    registrationId = reg.id
  } else if (memberCode) {
    const qr = await db.query.memberQrCodes.findFirst({
      where: eq(memberQrCodes.code, memberCode),
    })
    if (!qr) throw new NotFoundError('Member QR code')
    memberId = qr.memberId
  }

  if (!memberId) throw new BadRequestError('Could not identify member')

  const existing = await db.query.attendance.findFirst({
    where: and(
      eq(attendance.eventId, eventId),
      eq(attendance.memberId, memberId),
    ),
  })

  if (existing) {
    return {
      duplicate: true,
      status: existing.status ?? 'present',
      method: existing.method ?? null,
      round: existing.round ?? round,
      markedBy: existing.markedBy ?? null,
      markedAt: existing.markedAt ?? null,
      memberId,
      registrationId,
      registrationCode: registrationCode ?? null,
    }
  }

  const [record] = await db
    .insert(attendance)
    .values({
      eventId,
      registrationId: registrationId as any,
      memberId,
      status: 'present',
      method,
      round,
      markedBy: markedBy || null,
    })
    .returning()

  return {
    duplicate: false,
    status: record.status,
    method: record.method ?? null,
    round: record.round ?? round,
    markedBy: record.markedBy ?? null,
    markedAt: record.markedAt ?? null,
    memberId,
    registrationId,
    registrationCode: registrationCode ?? null,
  }
}

export async function getAttendanceForEvent(eventId: string) {
  return db.query.attendance.findMany({
    where: eq(attendance.eventId, eventId),
  })
}

export async function getMyAttendanceQr(eventId: string, memberId: string) {
  const qr = await db.query.memberQrCodes.findFirst({
    where: eq(memberQrCodes.memberId, memberId),
  })

  if (!qr) return null

  const record = await db.query.attendance.findFirst({
    where: and(
      eq(attendance.eventId, eventId),
      eq(attendance.memberId, memberId),
    ),
  })

  return {
    code: qr.code,
    isPresent: record?.status === 'present',
    method: record?.method,
    markedAt: record?.markedAt,
  }
}

export async function setAttendance(attendanceId: string, status: 'present' | 'absent') {
  const [updated] = await db
    .update(attendance)
    .set({ status })
    .where(eq(attendance.id, attendanceId))
    .returning()

  return updated
}
