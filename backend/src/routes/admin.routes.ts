import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireAdmin, requireSuperAdmin, type JwtPayload } from '../middleware/auth.js'
import { adminRateLimit } from '../middleware/rateLimit.js'
import { db } from '../db/index.js'
import {
  profiles, events, eventRoles, eventTeamMembers, eventRegistrations,
  attendance, pointRules, memberPointsTransactions, certificates,
  announcements, posts, galleryItems, brandingSettings, platformSettings,
  recruitApplications, recruitFormTemplates, recruitEvaluations,
  recruitRejectRequests, amtpsMembers, startups, facultyForms,
  facultyFormSubmissions, registrationRoles, duties, smtpSettings,
  memberPrivacySettings, memberQrCodes, adminAuditLogs, adminRecoveryCodes,
} from '../db/schema.js'
import { eq, desc, and, sql, count, asc } from 'drizzle-orm'
import { createEvent, updateEvent, deleteEvent } from '../services/event.service.js'
import { awardPoints } from '../services/points.service.js'
import { logAdminEvent, getAuditLogs } from '../services/audit.service.js'
import { sendEmail } from '../services/email.service.js'
import { NotFoundError, BadRequestError } from '../utils/errors.js'

export default async function adminRoutes(app: FastifyInstance) {
  // ─── ADMIN DASHBOARD STATS ───
  app.get('/stats', { preHandler: [requireAdmin, adminRateLimit] }, async (request, reply) => {
    const totalMembers = await db.execute(sql`SELECT COUNT(*)::int as count FROM profiles`)
    const totalEvents = await db.execute(sql`SELECT COUNT(*)::int as count FROM events`)
    const totalRegistrations = await db.execute(sql`SELECT COUNT(*)::int as count FROM event_registrations`)
    const totalAttendance = await db.execute(sql`SELECT COUNT(*)::int as count FROM attendance WHERE status = 'present'`)

    const rows = (r: any) => (r.rows || r)[0]

    return reply.send({
      stats: {
        totalMembers: rows(totalMembers).count,
        totalEvents: rows(totalEvents).count,
        totalRegistrations: rows(totalRegistrations).count,
        totalAttendance: rows(totalAttendance).count,
      },
    })
  })

  // ─── EVENT MANAGEMENT ───
  app.post('/events', { preHandler: [requireAdmin] }, async (request, reply) => {
    const user = request.user as JwtPayload
    const body = request.body as any
    const event = await createEvent({ ...body, createdBy: user.sub })
    await logAdminEvent({ actorId: user.sub, action: 'create_event', entityType: 'event', entityId: event.id, ip: request.ip })
    return reply.status(201).send({ event })
  })

  app.put('/events/:id', { preHandler: [requireAdmin] }, async (request, reply) => {
    const user = request.user as JwtPayload
    const { id } = request.params as { id: string }
    const event = await updateEvent(id, request.body as any)
    await logAdminEvent({ actorId: user.sub, action: 'update_event', entityType: 'event', entityId: id, ip: request.ip })
    return reply.send({ event })
  })

  app.delete('/events/:id', { preHandler: [requireAdmin] }, async (request, reply) => {
    const user = request.user as JwtPayload
    const { id } = request.params as { id: string }
    await deleteEvent(id)
    await logAdminEvent({ actorId: user.sub, action: 'delete_event', entityType: 'event', entityId: id, ip: request.ip })
    return reply.send({ success: true })
  })

  // ─── MEMBER MANAGEMENT ───
  app.get('/members', { preHandler: [requireAdmin] }, async (request, reply) => {
    const { role, status, search } = request.query as any
    const conditions = []
    if (role) conditions.push(eq(profiles.role, role))
    if (status) conditions.push(eq(profiles.status, status))

    const where = conditions.length > 0 ? and(...conditions) : undefined

    const members = await db.query.profiles.findMany({
      where,
      orderBy: [desc(profiles.createdAt)],
      limit: 200,
    })

    return reply.send({ members })
  })

  app.put('/members/:id', { preHandler: [requireAdmin] }, async (request, reply) => {
    const user = request.user as JwtPayload
    const { id } = request.params as { id: string }
    const body = request.body as any

    const [updated] = await db.update(profiles).set({
      ...body,
      updatedAt: new Date(),
    }).where(eq(profiles.id, id)).returning()

    if (!updated) throw new NotFoundError('Member')
    await logAdminEvent({ actorId: user.sub, action: 'update_member', entityType: 'profile', entityId: id, details: body, ip: request.ip })
    return reply.send({ member: updated })
  })

  app.delete('/members/:id', { preHandler: [requireAdmin] }, async (request, reply) => {
    const user = request.user as JwtPayload
    const { id } = request.params as { id: string }

    await db.delete(profiles).where(eq(profiles.id, id))
    await logAdminEvent({ actorId: user.sub, action: 'delete_member', entityType: 'profile', entityId: id, ip: request.ip })
    return reply.send({ success: true })
  })

  // ─── POINTS MANAGEMENT ───
  app.post('/points/award', { preHandler: [requireAdmin] }, async (request, reply) => {
    const user = request.user as JwtPayload
    const body = z.object({
      memberId: z.string().uuid(),
      points: z.number().positive(),
      activityType: z.string(),
      description: z.string().optional(),
      eventId: z.string().uuid().optional(),
    }).parse(request.body)

    const tx = await awardPoints({
      ...body,
      awardedBy: user.sub,
    })

    await logAdminEvent({ actorId: user.sub, action: 'award_points', entityType: 'points', entityId: tx.id, details: body, ip: request.ip })
    return reply.status(201).send({ transaction: tx })
  })

  app.get('/points/rules', { preHandler: [requireAdmin] }, async (request, reply) => {
    const rules = await db.query.pointRules.findMany({ orderBy: [desc(pointRules.createdAt)] })
    return reply.send({ rules })
  })

  app.post('/points/rules', { preHandler: [requireAdmin] }, async (request, reply) => {
    const user = request.user as JwtPayload
    const body = request.body as any
    const [rule] = await db.insert(pointRules).values({ ...body, createdBy: user.sub }).returning()
    return reply.status(201).send({ rule })
  })

  // ─── AUDIT LOGS ───
  app.get('/audit-logs', { preHandler: [requireAdmin] }, async (request, reply) => {
    const { limit } = request.query as any
    const logs = await getAuditLogs(limit || 100)
    return reply.send({ logs })
  })

  // ─── BRANDING ───
  app.get('/branding', { preHandler: [requireAdmin] }, async (request, reply) => {
    const settings = await db.query.brandingSettings.findFirst({ where: eq(brandingSettings.id, 1) })
    return reply.send({ branding: settings })
  })

  app.put('/branding', { preHandler: [requireAdmin] }, async (request, reply) => {
    const user = request.user as JwtPayload
    const body = request.body as any
    const [updated] = await db.update(brandingSettings).set({
      ...body,
      updatedBy: user.sub,
      updatedAt: new Date(),
    }).where(eq(brandingSettings.id, 1)).returning()

    await logAdminEvent({ actorId: user.sub, action: 'update_branding', entityType: 'branding', ip: request.ip })
    return reply.send({ branding: updated })
  })

  // ─── PLATFORM SETTINGS ───
  app.get('/settings', { preHandler: [requireAdmin] }, async (request, reply) => {
    const settings = await db.query.platformSettings.findFirst({ where: eq(platformSettings.id, 1) })
    return reply.send({ settings })
  })

  app.put('/settings', { preHandler: [requireAdmin] }, async (request, reply) => {
    const user = request.user as JwtPayload
    const body = request.body as any
    const [updated] = await db.update(platformSettings).set({
      ...body,
      updatedBy: user.sub,
      updatedAt: new Date(),
    }).where(eq(platformSettings.id, 1)).returning()

    await logAdminEvent({ actorId: user.sub, action: 'update_settings', entityType: 'settings', ip: request.ip })
    return reply.send({ settings: updated })
  })

  // ─── EVENT ROLES ───
  app.get('/event-roles', { preHandler: [requireAdmin] }, async (request, reply) => {
    const roles = await db.query.eventRoles.findMany()
    return reply.send({ roles })
  })

  app.post('/event-roles', { preHandler: [requireAdmin] }, async (request, reply) => {
    const body = request.body as any
    const [role] = await db.insert(eventRoles).values(body).returning()
    return reply.status(201).send({ role })
  })

  // ─── RECRUITMENT ───
  app.get('/recruit', { preHandler: [requireAdmin] }, async (request, reply) => {
    const { stage } = request.query as any
    const conditions = stage ? [eq(recruitApplications.stage, stage)] : undefined
    const applications = await db.query.recruitApplications.findMany({
      where: conditions ? and(...conditions) : undefined,
      orderBy: [desc(recruitApplications.createdAt)],
    })
    return reply.send({ applications })
  })

  // ─── SMTP SETTINGS ───
  app.get('/smtp', { preHandler: [requireSuperAdmin] }, async (request, reply) => {
    const settings = await db.query.smtpSettings.findMany({ orderBy: [asc(smtpSettings.position)] })
    return reply.send({ settings })
  })

  app.post('/smtp', { preHandler: [requireSuperAdmin] }, async (request, reply) => {
    const body = request.body as any
    const [setting] = await db.insert(smtpSettings).values(body).returning()
    return reply.status(201).send({ setting })
  })

  app.put('/smtp/:id', { preHandler: [requireSuperAdmin] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = request.body as any
    const [updated] = await db.update(smtpSettings).set({ ...body, updatedAt: new Date() }).where(eq(smtpSettings.id, id)).returning()
    return reply.send({ setting: updated })
  })

  app.delete('/smtp/:id', { preHandler: [requireSuperAdmin] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    await db.delete(smtpSettings).where(eq(smtpSettings.id, id))
    return reply.send({ success: true })
  })

  // ─── SEND EMAIL ───
  app.post('/send-email', { preHandler: [requireSuperAdmin] }, async (request, reply) => {
    const user = request.user as JwtPayload
    const body = z.object({
      to: z.string().email(),
      subject: z.string().min(1),
      text: z.string().optional(),
      html: z.string().optional(),
    }).parse(request.body)

    const sent = await sendEmail({ ...body, sentBy: user.sub })
    return reply.send({ sent: sent.ok, account: sent.sender })
  })

  // ─── GALLERY ───
  app.get('/gallery', { preHandler: [requireAdmin] }, async (request, reply) => {
    const items = await db.query.galleryItems.findMany({ orderBy: [desc(galleryItems.createdAt)] })
    return reply.send({ items })
  })

  app.post('/gallery', { preHandler: [requireAdmin] }, async (request, reply) => {
    const body = request.body as any
    const user = request.user as JwtPayload
    const [item] = await db.insert(galleryItems).values({ ...body, uploadedBy: user.sub }).returning()
    return reply.status(201).send({ item })
  })

  // ─── ANNOUNCEMENTS ───
  app.get('/announcements', { preHandler: [requireAdmin] }, async (request, reply) => {
    const items = await db.query.announcements.findMany({ orderBy: [desc(announcements.createdAt)] })
    return reply.send({ items })
  })

  app.post('/announcements', { preHandler: [requireAdmin] }, async (request, reply) => {
    const body = request.body as any
    const user = request.user as JwtPayload
    const [item] = await db.insert(announcements).values({ ...body, createdBy: user.sub }).returning()
    return reply.status(201).send({ item })
  })

  // ─── POSTS (CMS) ───
  app.get('/posts', { preHandler: [requireAdmin] }, async (request, reply) => {
    const items = await db.query.posts.findMany({ orderBy: [desc(posts.createdAt)] })
    return reply.send({ items })
  })

  app.post('/posts', { preHandler: [requireAdmin] }, async (request, reply) => {
    const body = request.body as any
    const user = request.user as JwtPayload
    const [item] = await db.insert(posts).values({ ...body, authorId: user.sub }).returning()
    return reply.status(201).send({ item })
  })

  // ─── AMTPS MEMBERS ───
  app.get('/amtps', { preHandler: [requireAdmin] }, async (request, reply) => {
    const members = await db.query.amtpsMembers.findMany({ orderBy: [asc(amtpsMembers.displayOrder)] })
    return reply.send({ members })
  })

  app.post('/amtps', { preHandler: [requireAdmin] }, async (request, reply) => {
    const body = request.body as any
    const [member] = await db.insert(amtpsMembers).values(body).returning()
    return reply.status(201).send({ member })
  })

  app.put('/amtps/:id', { preHandler: [requireAdmin] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = request.body as any
    const [updated] = await db.update(amtpsMembers).set({ ...body, updatedAt: new Date() }).where(eq(amtpsMembers.id, id)).returning()
    return reply.send({ member: updated })
  })

  app.delete('/amtps/:id', { preHandler: [requireAdmin] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    await db.delete(amtpsMembers).where(eq(amtpsMembers.id, id))
    return reply.send({ success: true })
  })

  // ─── STARTUPS ───
  app.get('/startups', { preHandler: [requireAdmin] }, async (request, reply) => {
    const items = await db.query.startups.findMany({ orderBy: [asc(startups.displayOrder)] })
    return reply.send({ items })
  })

  app.post('/startups', { preHandler: [requireAdmin] }, async (request, reply) => {
    const body = request.body as any
    const [item] = await db.insert(startups).values(body).returning()
    return reply.status(201).send({ item })
  })

  app.put('/startups/:id', { preHandler: [requireAdmin] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = request.body as any
    const [updated] = await db.update(startups).set({ ...body, updatedAt: new Date() }).where(eq(startups.id, id)).returning()
    return reply.send({ item: updated })
  })

  app.delete('/startups/:id', { preHandler: [requireAdmin] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    await db.delete(startups).where(eq(startups.id, id))
    return reply.send({ success: true })
  })

  // ─── FACULTY FORMS ───
  app.get('/faculty-forms', { preHandler: [requireAdmin] }, async (request, reply) => {
    const forms = await db.query.facultyForms.findMany({ orderBy: [desc(facultyForms.createdAt)] })
    return reply.send({ forms })
  })

  app.post('/faculty-forms', { preHandler: [requireAdmin] }, async (request, reply) => {
    const body = request.body as any
    const user = request.user as JwtPayload
    const [form] = await db.insert(facultyForms).values({ ...body, createdBy: user.sub }).returning()
    return reply.status(201).send({ form })
  })

  // ─── CERTIFICATES ───
  app.get('/certificates', { preHandler: [requireAdmin] }, async (request, reply) => {
    const certs = await db.query.certificates.findMany({ orderBy: [desc(certificates.issuedAt)] })
    return reply.send({ certificates: certs })
  })

  // ─── REGISTRATION ROLES ───
  app.get('/registration-roles', { preHandler: [requireAdmin] }, async (request, reply) => {
    const roles = await db.query.registrationRoles.findMany()
    return reply.send({ roles })
  })

  // ─── ATTENDANCE RECORDS ───
  app.get('/attendance', { preHandler: [requireAdmin] }, async (request, reply) => {
    const { eventId } = request.query as any
    const conditions = eventId ? [eq(attendance.eventId, eventId)] : undefined
    const records = await db.query.attendance.findMany({
      where: conditions ? and(...conditions) : undefined,
      orderBy: [desc(attendance.markedAt)],
    })
    return reply.send({ attendance: records })
  })

  // ─── BULK OPERATIONS ───
  app.post('/members/bulk-delete', { preHandler: [requireSuperAdmin] }, async (request, reply) => {
    const user = request.user as JwtPayload
    const body = z.object({ emails: z.array(z.string().email()) }).parse(request.body)

    let deleted = 0
    for (const email of body.emails) {
      const profile = await db.query.profiles.findFirst({ where: eq(profiles.email, email) })
      if (profile && profile.role !== 'super_admin' && profile.role !== 'main_admin') {
        await db.delete(profiles).where(eq(profiles.id, profile.id))
        deleted++
      }
    }

    await logAdminEvent({ actorId: user.sub, action: 'bulk_delete_members', entityType: 'profiles', details: { count: deleted }, ip: request.ip })
    return reply.send({ deleted })
  })
}
