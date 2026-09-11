import type { FastifyInstance } from 'fastify'
import { db } from '../db/index.js'
import {
  events, eventTeamMembers, eventRoles, profiles,
  attendance, eventRoundWindows, memberQrCodes,
} from '../db/schema.js'
import { eq, and } from 'drizzle-orm'

export default async function realtimeRoutes(app: FastifyInstance) {
  app.get('/attendance/:eventId', { websocket: true }, (socket, request) => {
    const { eventId } = request.params as { eventId: string }

    const interval = setInterval(async () => {
      try {
        const records = await db.query.attendance.findMany({
          where: eq(attendance.eventId, eventId),
        })
        socket.send(JSON.stringify({ type: 'attendance_update', data: records }))
      } catch (err) {
        console.error('[WS] Attendance fetch error:', err)
      }
    }, 5000)

    socket.on('close', () => {
      clearInterval(interval)
    })

    socket.on('message', async (raw: string | Buffer) => {
      try {
        const msg = JSON.parse(raw.toString())
        if (msg.type === 'ping') {
          socket.send(JSON.stringify({ type: 'pong' }))
        }
      } catch {}
    })
  })
}
