import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authenticate, type JwtPayload } from '../middleware/auth.js'
import { apiRateLimit } from '../middleware/rateLimit.js'
import {
  listEvents,
  getEvent,
  createRegistration,
  getEventCounts,
  getRegistration,
} from '../services/event.service.js'
import { markAttendance, getMyAttendanceQr } from '../services/attendance.service.js'
import { cacheGet, cacheSet } from '../redis/index.js'
import { BadRequestError, NotFoundError } from '../utils/errors.js'
import { db } from '../db/index.js'
import { events, eventTeamMembers, eventRoles, profiles } from '../db/schema.js'
import { eq, and } from 'drizzle-orm'

export default async function eventRoutes(app: FastifyInstance) {
  // ─── LIST EVENTS ───
  app.get('/', async (request, reply) => {
    const { status, upcoming, category } = request.query as any
    const eventsList = await listEvents((status || 'published') as any, upcoming === 'true')
    return reply.send({ events: eventsList })
  })

  // ─── GET EVENT ───
  app.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const event = await getEvent(id)
    if (!event) throw new NotFoundError('Event')
    return reply.send({ event })
  })

  // ─── GET EVENT COUNTS ───
  app.get('/counts/all', async (request, reply) => {
    const counts = await getEventCounts()
    return reply.send({ counts })
  })

  // ─── REGISTER FOR EVENT ───
  app.post('/:id/register', { preHandler: [authenticate] }, async (request, reply) => {
    const user = request.user as JwtPayload
    const { id: eventId } = request.params as { id: string }

    const body = z.object({
      attendeeName: z.string().min(1),
      email: z.string().email().optional(),
      phone: z.string().optional(),
      department: z.string().optional(),
      yearOfBirth: z.string().optional(),
      college: z.string().optional(),
      studentId: z.string().optional(),
      formData: z.record(z.any()).optional(),
    }).parse(request.body)

    const event = await getEvent(eventId)
    if (!event) throw new NotFoundError('Event')
    if (!event.registrationEnabled) throw new BadRequestError('Registration is closed for this event')
    if (event.registrationDeadline && event.registrationDeadline.getTime() < Date.now()) {
      throw new BadRequestError('Registration is closed for this event — the registration deadline has passed')
    }

    const reg = await createRegistration({
      eventId,
      memberId: user.sub,
      attendeeName: body.attendeeName,
      email: body.email,
      phone: body.phone,
      department: body.department,
      yearOfBirth: body.yearOfBirth,
      college: body.college,
      studentId: body.studentId,
      formData: body.formData || {},
      status: 'confirmed',
    })

    return reply.status(201).send({ registration: reg })
  })

  // ─── GET MY REGISTRATION ───
  app.get('/:id/my-registration', { preHandler: [authenticate] }, async (request, reply) => {
    const user = request.user as JwtPayload
    const { id: eventId } = request.params as { id: string }

    const { eventRegistrations } = await import('../db/schema.js')
    const reg = await db.query.eventRegistrations.findFirst({
      where: and(
        eq(eventRegistrations.eventId, eventId),
        eq(eventRegistrations.memberId, user.sub),
      ),
    })

    return reply.send({ registration: reg || null })
  })

  // ─── GET EVENT TEAM ───
  app.get('/:id/team', async (request, reply) => {
    const { id: eventId } = request.params as { id: string }

    const team = await db
      .select({
        id: eventTeamMembers.id,
        memberId: eventTeamMembers.memberId,
        isPublic: eventTeamMembers.isPublic,
        hoursWorked: eventTeamMembers.hoursWorked,
        member: {
          fullName: profiles.fullName,
          avatarUrl: profiles.avatarUrl,
        },
        role: {
          id: eventRoles.id,
          name: eventRoles.name,
          category: eventRoles.category,
        },
      })
      .from(eventTeamMembers)
      .innerJoin(profiles, eq(eventTeamMembers.memberId, profiles.id))
      .innerJoin(eventRoles, eq(eventTeamMembers.roleId, eventRoles.id))
      .where(eq(eventTeamMembers.eventId, eventId))

    return reply.send({ team })
  })

  // ─── MARK ATTENDANCE (for members with QR) ───
  app.post('/:id/attendance/mark', { preHandler: [authenticate] }, async (request, reply) => {
    const user = request.user as JwtPayload
    const { id: eventId } = request.params as { id: string }

    const body = z.object({
      registrationCode: z.string().optional(),
      memberCode: z.string().optional(),
      method: z.enum(['qr', 'member_qr', 'manual']).default('qr'),
      round: z.number().default(1),
    }).parse(request.body)

    const record = await markAttendance({
      eventId,
      registrationCode: body.registrationCode,
      memberCode: body.memberCode,
      method: body.method,
      round: body.round,
      markedBy: user.sub,
    })

    return reply.status(201).send({ attendance: record })
  })

  // ─── GET MY ATTENDANCE QR ───
  app.get('/:id/attendance/qr', { preHandler: [authenticate] }, async (request, reply) => {
    const user = request.user as JwtPayload
    const { id: eventId } = request.params as { id: string }

    const qrData = await getMyAttendanceQr(eventId, user.sub)
    return reply.send({ qr: qrData })
  })
}
