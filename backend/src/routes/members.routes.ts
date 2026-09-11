import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authenticate, type JwtPayload } from '../middleware/auth.js'
import { getLeaderboard, getMemberRank, getPointsStats } from '../services/points.service.js'
import { getProfile, getPublicMember } from '../services/auth.service.js'
import { cacheGet } from '../redis/index.js'
import { NotFoundError } from '../utils/errors.js'

export default async function membersRoutes(app: FastifyInstance) {
  // ─── LEADERBOARD ───
  app.get('/leaderboard', async (request, reply) => {
    const { academic_year, department, year, team, period } = request.query as any
    const leaderboard = await getLeaderboard({
      academicYear: academic_year,
      department,
      year,
      team,
      period,
    })
    return reply.send({ leaderboard })
  })

  // ─── MEMBER RANK ───
  app.get('/:id/rank', async (request, reply) => {
    const { id } = request.params as { id: string }
    const rank = await getMemberRank(id)
    return reply.send({ rank })
  })

  // ─── PUBLIC MEMBER PROFILE ───
  app.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const member = await getPublicMember(id)
    if (!member) throw new NotFoundError('Member')
    return reply.send({ member })
  })

  // ─── MY PROFILE ───
  app.get('/me/profile', { preHandler: [authenticate] }, async (request, reply) => {
    const user = request.user as JwtPayload
    const profile = await getProfile(user.sub)
    if (!profile) throw new NotFoundError('Profile')
    return reply.send({ profile })
  })

  // ─── UPDATE PROFILE ───
  app.put('/me/profile', { preHandler: [authenticate] }, async (request, reply) => {
    const user = request.user as JwtPayload
    const body = z.object({
      fullName: z.string().optional(),
      phone: z.string().optional(),
      department: z.string().optional(),
      yearOfBirth: z.string().optional(),
      academicYear: z.string().optional(),
      team: z.string().optional(),
      bio: z.string().optional(),
      domain: z.string().optional(),
      skills: z.array(z.string()).optional(),
      socialLinks: z.record(z.string()).optional(),
      avatarUrl: z.string().optional(),
    }).parse(request.body)

    const { updateProfile } = await import('../services/auth.service.js')
    const updated = await updateProfile(user.sub, body as any)
    return reply.send({ profile: updated })
  })

  // ─── POINTS STATS ───
  app.get('/stats/points', async (request, reply) => {
    const stats = await getPointsStats()
    return reply.send({ stats })
  })
}
