import type { FastifyInstance, FastifyRequest } from 'fastify'
import { runSelect, runInsert, runUpdate, runDelete, type DataFilter, type DataSelectInput } from '../services/data.service.js'
import { authenticate, authenticateOptional, type JwtPayload } from '../middleware/auth.js'
import { ForbiddenError, UnauthorizedError } from '../utils/errors.js'

// Public-read tables (open to anonymous as in the original site)
const PUBLIC_READ = new Set([
  'events', 'event_roles', 'event_team_members', 'gallery_items', 'posts',
  'amtps_members', 'startups', 'branding_settings', 'platform_settings',
  'announcements', 'point_rules',
])

// Tables where ANY authenticated user may read
const AUTH_READ = new Set([
  'profiles', 'member_privacy_settings', 'member_points_transactions',
  'member_achievements', 'event_registrations', 'attendance', 'certificates',
  'recruit_applications', 'recruit_form_templates', 'recruit_evaluations',
  'recruit_reject_requests', 'recruit_emails', 'faculty_forms',
  'faculty_form_submissions', 'member_qr_codes',
  'duties', 'duty_files', 'duty_assignments',
  'event_round_windows',
])

// Admin-only reads (sensitive: role secrets, mailing creds, OTP codes, audit logs).
// Mirrors the original RLS which never exposed these to plain members.
const ADMIN_READ = new Set([
  'registration_roles', 'admin_recovery_codes', 'smtp_settings',
  'email_otp_codes', 'admin_audit_logs', 'oauth_settings',
])

// Tables where writes require an admin role (mirrors RLS UPDATE/DELETE policy)
const ADMIN_WRITE = new Set([
  'profiles', 'points', 'point_rules', 'member_points_transactions',
  'event_registrations', 'attendance', 'certificates',
  'recruit_applications', 'recruit_evaluations', 'recruit_reject_requests',
  'recruit_emails', 'admin_audit_logs', 'smtp_settings',
  'registration_roles', 'admin_recovery_codes', 'amtps_members', 'startups',
  'faculty_forms', 'faculty_form_submissions', 'event_round_windows',
  'duties', 'duty_files', 'duty_assignments', 'post_authors',
  // public-read content that must NOT be writable by plain members
  'events', 'event_roles', 'event_team_members', 'gallery_items', 'posts',
  'announcements', 'branding_settings', 'platform_settings',
  // member may write only their OWN row (see canSelfWriteOwnedRow)
  'member_privacy_settings',
])

const SUPER_ADMIN_WRITE = new Set([
  'smtp_settings', 'registration_roles', 'admin_recovery_codes', 'oauth_settings',
])

function isAdminRole(role: string) {
  return ['super_admin', 'main_admin', 'event_admin', 'member_admin',
    'content_admin', 'gallery_admin', 'reports_admin', 'attendance_coordinator',
    'mail_admin'].includes(role)
}

function isSuperAdmin(role: string) {
  return role === 'super_admin' || role === 'main_admin'
}

function currentUser(request: FastifyRequest): JwtPayload | null {
  const u = request.user as JwtPayload | undefined
  return u ?? null
}

const PROTECTED_PROFILE_COLUMNS = new Set(['role', 'status', 'is_listed_member', 'ciie_id', 'student_id', 'deleted_at'])

function canWriteProfiles(user: JwtPayload, body: { values: Record<string, unknown>; filters?: DataFilter[] }): boolean {
  if (isAdminRole(user.role)) return true
  // Members may only update their OWN profile row, and may not touch
  // role/status/identifiers (mirrors the original RLS self-update policy).
  const ownRow = (body.filters ?? []).some((f) => f.op === 'eq' && f.column === 'id' && f.value === user.sub)
  if (!ownRow) return false
  for (const key of Object.keys(body.values ?? {})) {
    if (PROTECTED_PROFILE_COLUMNS.has(key)) return false
  }
  return true
}

// Owned tables: a plain member may write only the row that belongs to them.
function canSelfWriteOwnedRow(table: string, user: JwtPayload, body: { values?: Record<string, unknown>; filters?: DataFilter[] }): boolean {
  if (isAdminRole(user.role)) return true
  if (table === 'member_privacy_settings') {
    const values = body.values ?? {}
    const ownByValues = values.member_id === user.sub
    const ownByFilter = (body.filters ?? []).some((f) => f.op === 'eq' && f.column === 'member_id' && f.value === user.sub)
    return ownByValues || ownByFilter
  }
  return false
}

export default async function dbRoutes(app: FastifyInstance) {
  // ─── SELECT ───
  app.post<{ Body: DataSelectInput }>('/select', { preHandler: [authenticateOptional] }, async (request, reply) => {
    const body = request.body
    if (!body?.table) throw new UnauthorizedError('Table required')
    const user = currentUser(request)

    // Permission gate
    const isView = body.table.startsWith('v_')
    if (!isView && !PUBLIC_READ.has(body.table) && !AUTH_READ.has(body.table) && !ADMIN_READ.has(body.table)) {
      throw new ForbiddenError(`Access to "${body.table}" denied`)
    }
    if (ADMIN_READ.has(body.table) && (!user || !isAdminRole(user.role))) {
      throw new ForbiddenError('Admin role required')
    }
    if ((AUTH_READ.has(body.table) || isView) && !user) {
      throw new UnauthorizedError('Authentication required')
    }

    const rows = await runSelect(body)
    return reply.send({ data: rows })
  })

  // ─── INSERT ───
  app.post<{ Body: { table: string; values: Record<string, unknown>; onConflict?: string } }>('/insert', { preHandler: [authenticate] }, async (request, reply) => {
    const body = request.body
    if (!body?.table) throw new UnauthorizedError('Table required')
    const user = currentUser(request)
    if (!user) throw new UnauthorizedError('Authentication required')
    if (!PUBLIC_READ.has(body.table) && !AUTH_READ.has(body.table) && !ADMIN_READ.has(body.table)) {
      throw new ForbiddenError(`Access to "${body.table}" denied`)
    }
    // Strictly admin-only writes are still blocked for members
    if (SUPER_ADMIN_WRITE.has(body.table) && !isSuperAdmin(user.role)) {
      throw new ForbiddenError('Super admin role required')
    }
    if (ADMIN_WRITE.has(body.table) && !isAdminRole(user.role) && !canSelfWriteOwnedRow(body.table, user, { values: body.values })) {
      throw new ForbiddenError('Admin role required')
    }
    const rows = await runInsert({ table: body.table, values: body.values, onConflict: body.onConflict })
    return reply.status(201).send({ data: rows })
  })

  // ─── UPDATE ───
  app.post<{ Body: { table: string; values: Record<string, unknown>; filters?: DataFilter[] } }>('/update', { preHandler: [authenticate] }, async (request, reply) => {
    const body = request.body
    if (!body?.table) throw new UnauthorizedError('Table required')
    const user = currentUser(request)
    if (!user) throw new UnauthorizedError('Authentication required')
    if (!PUBLIC_READ.has(body.table) && !AUTH_READ.has(body.table) && !ADMIN_READ.has(body.table)) {
      throw new ForbiddenError(`Access to "${body.table}" denied`)
    }
    if (body.table === 'profiles' && !canWriteProfiles(user, body)) {
      throw new ForbiddenError('Members may only update their own profile fields')
    }
    if (ADMIN_WRITE.has(body.table) && body.table !== 'profiles' && !canSelfWriteOwnedRow(body.table, user, body)) {
      throw new ForbiddenError('Admin role required')
    }
    if (SUPER_ADMIN_WRITE.has(body.table) && !isSuperAdmin(user.role)) {
      throw new ForbiddenError('Super admin role required')
    }
    const rows = await runUpdate({ table: body.table, values: body.values, filters: body.filters })
    return reply.send({ data: rows })
  })

  // ─── DELETE ───
  app.post<{ Body: { table: string; filters?: DataFilter[] } }>('/delete', { preHandler: [authenticate] }, async (request, reply) => {
    const body = request.body
    if (!body?.table) throw new UnauthorizedError('Table required')
    const user = currentUser(request)
    if (!user) throw new UnauthorizedError('Authentication required')
    if (!PUBLIC_READ.has(body.table) && !AUTH_READ.has(body.table) && !ADMIN_READ.has(body.table)) {
      throw new ForbiddenError(`Access to "${body.table}" denied`)
    }
    if (ADMIN_WRITE.has(body.table) && !isAdminRole(user.role) && !canSelfWriteOwnedRow(body.table, user, body)) {
      throw new ForbiddenError('Admin role required')
    }
    if (SUPER_ADMIN_WRITE.has(body.table) && !isSuperAdmin(user.role)) {
      throw new ForbiddenError('Super admin role required')
    }
    const rows = await runDelete({ table: body.table, filters: body.filters })
    return reply.send({ data: rows })
  })
}
