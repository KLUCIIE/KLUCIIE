import { db } from '../db/index.js'
import { events, eventRegistrations, eventTeamMembers, eventRoles } from '../db/schema.js'
import { eq, and, gte, lte, desc, asc, sql } from 'drizzle-orm'
import { cacheGet, cacheSet, cacheDel, cacheDelPattern } from '../redis/index.js'
import { NotFoundError, BadRequestError } from '../utils/errors.js'
import { generateRegistrationCode } from '../utils/codes.js'

const EVENT_CACHE_TTL = 60

export async function listEvents(status: 'draft' | 'published' | 'completed' | 'cancelled' = 'published', upcomingOnly = false) {
  const cacheKey = `events:${status}:${upcomingOnly}`
  const cached = await cacheGet<any[]>(cacheKey)
  if (cached) return cached

  let query = db
    .select()
    .from(events)
    .where(eq(events.status, status))
    .orderBy(asc(events.startDate))

  const results = await query
  await cacheSet(cacheKey, results, EVENT_CACHE_TTL)
  return results
}

export async function getEvent(idOrSlug: string) {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrSlug)

  const event = await db.query.events.findFirst({
    where: isUuid ? eq(events.id, idOrSlug) : eq(events.slug, idOrSlug),
  })

  return event || null
}

export async function createEvent(data: typeof events.$inferInsert) {
  const [event] = await db.insert(events).values(data).returning()
  await cacheDelPattern('events:*')
  return event
}

export async function updateEvent(id: string, data: Partial<typeof events.$inferInsert>) {
  const [updated] = await db
    .update(events)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(events.id, id))
    .returning()

  if (!updated) throw new NotFoundError('Event')
  await cacheDelPattern('events:*')
  return updated
}

export async function deleteEvent(id: string) {
  await db.delete(events).where(eq(events.id, id))
  await cacheDelPattern('events:*')
}

export async function getEventCounts() {
  const cached = await cacheGet<Record<string, number>>('event:counts')
  if (cached) return cached

  const results = await db
    .select({
      eventId: eventRegistrations.eventId,
      registrations: sql<number>`count(*)::int`,
    })
    .from(eventRegistrations)
    .where(eq(eventRegistrations.status, 'confirmed'))
    .groupBy(eventRegistrations.eventId)

  const map: Record<string, number> = {}
  for (const row of results) {
    map[row.eventId] = row.registrations
  }

  await cacheSet('event:counts', map, 30)
  return map
}

export async function createRegistration(data: Omit<typeof eventRegistrations.$inferInsert, 'registrationCode'>) {
  const code = generateRegistrationCode()
  const [reg] = await db
    .insert(eventRegistrations)
    .values({ ...data, registrationCode: code })
    .returning()

  await cacheDel(`event:counts`)
  return reg
}

export async function getRegistration(id: string) {
  return db.query.eventRegistrations.findFirst({
    where: eq(eventRegistrations.id, id),
  })
}

export async function getRegistrationsByEvent(eventId: string) {
  return db.query.eventRegistrations.findMany({
    where: eq(eventRegistrations.eventId, eventId),
  })
}
