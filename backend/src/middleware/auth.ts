import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { db } from '../db/index.js'
import { profiles } from '../db/schema.js'
import { eq } from 'drizzle-orm'
import { UnauthorizedError, ForbiddenError } from '../utils/errors.js'

export type UserRole = 'user' | 'member' | 'member_ciie' | 'faculty' | 'super_admin' | 'main_admin' | 'event_admin' | 'member_admin' | 'content_admin' | 'gallery_admin' | 'reports_admin' | 'attendance_coordinator' | 'mail_admin'

export interface JwtPayload {
  sub: string
  role: UserRole
  aal?: string
  iat: number
  exp: number
}

export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  try {
    const token = request.headers.authorization?.replace('Bearer ', '')
    if (!token) throw new UnauthorizedError('No token provided')
    const decoded = request.server.jwt.verify<JwtPayload>(token)
    request.user = decoded
  } catch {
    reply.status(401).send({ error: 'Unauthorized', message: 'Invalid or expired token' })
  }
}

/** Like `authenticate` but tolerates missing/invalid tokens (public reads). */
export async function authenticateOptional(request: FastifyRequest, reply: FastifyReply) {
  const token = request.headers.authorization?.replace('Bearer ', '')
  if (!token) return
  try {
    request.user = request.server.jwt.verify<JwtPayload>(token)
  } catch {
    // ignore invalid token; treat as anonymous
  }
}

const ADMIN_ROLES: UserRole[] = [
  'super_admin', 'main_admin', 'event_admin', 'member_admin',
  'content_admin', 'gallery_admin', 'reports_admin',
  'attendance_coordinator', 'mail_admin',
]

export async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  await authenticate(request, reply)
  if (reply.sent) return
  const user = request.user as JwtPayload
  if (!ADMIN_ROLES.includes(user.role)) {
    reply.status(403).send({ error: 'Forbidden', message: 'Admin access required' })
  }
}

export async function requireSuperAdmin(request: FastifyRequest, reply: FastifyReply) {
  await authenticate(request, reply)
  if (reply.sent) return
  const user = request.user as JwtPayload
  if (user.role !== 'super_admin' && user.role !== 'main_admin') {
    reply.status(403).send({ error: 'Forbidden', message: 'Super admin access required' })
  }
}

export async function requireCiiieMember(request: FastifyRequest, reply: FastifyReply) {
  await authenticate(request, reply)
  if (reply.sent) return
  const user = request.user as JwtPayload
  if (user.role !== 'member_ciie' && !ADMIN_ROLES.includes(user.role)) {
    reply.status(403).send({ error: 'Forbidden', message: 'CIIE member access required' })
  }
}

export async function requireFaculty(request: FastifyRequest, reply: FastifyReply) {
  await authenticate(request, reply)
  if (reply.sent) return
  const user = request.user as JwtPayload
  if (user.role !== 'faculty' && !ADMIN_ROLES.includes(user.role)) {
    reply.status(403).send({ error: 'Forbidden', message: 'Faculty access required' })
  }
}
