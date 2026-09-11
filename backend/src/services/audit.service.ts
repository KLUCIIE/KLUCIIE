import { db } from '../db/index.js'
import { adminAuditLogs } from '../db/schema.js'

export async function logAdminEvent(params: {
  actorId: string
  action: string
  entityType?: string
  entityId?: string
  details?: Record<string, any>
  ip?: string
}) {
  await db.insert(adminAuditLogs).values({
    actorId: params.actorId,
    action: params.action,
    entityType: params.entityType || null,
    entityId: params.entityId || null,
    details: params.details || null,
    ip: params.ip || null,
  })
}

export async function getAuditLogs(limit = 100) {
  return db.query.adminAuditLogs.findMany({
    orderBy: [adminAuditLogs.createdAt],
    limit,
  })
}
