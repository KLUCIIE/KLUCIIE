import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import multipart from '@fastify/multipart'
import { uploadFile, getFile, deleteFile, listFiles, ensureBucket } from '../services/storage.service.js'
import { authenticate, type JwtPayload } from '../middleware/auth.js'
import { ForbiddenError, BadRequestError, NotFoundError } from '../utils/errors.js'
import { config } from '../config/index.js'

// Buckets that anonymous users may upload to (public signup/recruit)
const PUBLIC_WRITE_BUCKETS = new Set(['media', 'avatars', 'branding'])

export default async function storageRoutes(app: FastifyInstance) {
  await app.register(multipart, {
    limits: { fileSize: 50 * 1024 * 1024, files: 4 },
  })

  // ─── Public static file serving: GET /storage/:bucket/* ───
  app.get<{ Params: { bucket: string; splat: string } }>('/storage/*', async (request, reply) => {
    const raw = (request.params as any)['*'] as string
    const slash = raw.indexOf('/')
    if (slash <= 0) return reply.callNotFound()
    const bucket = raw.slice(0, slash)
    const name = raw.slice(slash + 1)
    const file = await getFile(bucket, name)
    if (!file) return reply.callNotFound()
    reply.type(file.contentType)
    return reply.send(file.data)
  })

  // ─── Upload: POST /storage/:bucket/:name (multipart `file` field) ───
  app.post<{ Params: { bucket: string; splat: string } }>(
    '/storage/:bucket/*',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const user = request.user as JwtPayload
      const bucket = request.params.bucket
      const name = (request.params as any)['*'] as string

      if (!PUBLIC_WRITE_BUCKETS.has(bucket) && !isAdmin(user.role)) {
        throw new ForbiddenError('Upload permission denied')
      }

      const query = request.query as { upsert?: string }
      const data = await request.file()
      if (!data) throw new BadRequestError('No file uploaded')

      const buffer = await data.toBuffer()
      const stored = await uploadFile(bucket, name || data.filename, buffer, data.mimetype, query.upsert === 'true')
      return reply.status(201).send({ path: stored.path, publicUrl: stored.publicUrl, name: stored.name, size: stored.size })
    },
  )

  // ─── List: GET /storage/api/list/:bucket[?folder=] ───
  app.get<{ Params: { bucket: string } }>('/storage/api/list/:bucket', { preHandler: [authenticate] }, async (request, reply) => {
    const user = request.user as JwtPayload
    const { folder } = request.query as { folder?: string }
    if (!isAdmin(user.role)) throw new ForbiddenError('Permission denied')
    const files = await listFiles(request.params.bucket, folder)
    return reply.send({ files })
  })

  // ─── Delete: DELETE /storage/:bucket/* ───
  app.delete<{ Params: { bucket: string; splat: string } }>(
    '/storage/:bucket/*',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const user = request.user as JwtPayload
      const bucket = request.params.bucket
      const name = (request.params as any)['*'] as string
      const bucketAdmin = !PUBLIC_WRITE_BUCKETS.has(bucket)
      if (bucketAdmin && !isAdmin(user.role)) throw new ForbiddenError('Permission denied')
      const ok = await deleteFile(bucket, name)
      return reply.send({ success: ok })
    },
  )
}

function isAdmin(role: string) {
  return ['super_admin', 'main_admin', 'event_admin', 'member_admin', 'content_admin',
    'gallery_admin', 'reports_admin', 'attendance_coordinator', 'mail_admin'].includes(role)
}