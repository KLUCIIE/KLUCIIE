import Fastify from 'fastify'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import jwt from '@fastify/jwt'
import websocket from '@fastify/websocket'
import { config } from './config/index.js'
import { redis } from './redis/index.js'
import authRoutes from './routes/auth.routes.js'
import eventRoutes from './routes/events.routes.js'
import membersRoutes from './routes/members.routes.js'
import adminRoutes from './routes/admin.routes.js'
import dbRoutes from './routes/db.routes.js'
import rpcRoutes from './routes/rpc.routes.js'
import storageRoutes from './routes/storage.routes.js'
import functionsRoutes from './routes/functions.routes.js'
import realtimeRoutes from './websocket/index.js'
import { AppError } from './utils/errors.js'

const app = Fastify({
  logger: {
    level: config.NODE_ENV === 'development' ? 'info' : 'warn',
    transport: config.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
  },
  trustProxy: true,
  bodyLimit: 10 * 1024 * 1024,
})

// ─── Plugins ───
await app.register(cors, {
  origin: config.CORS_ORIGIN.split(','),
  credentials: true,
})

await app.register(rateLimit, {
  max: 200,
  timeWindow: '1 minute',
  redis,
})

await app.register(jwt, {
  secret: config.JWT_SECRET,
  sign: { expiresIn: config.JWT_ACCESS_EXPIRY },
})

await app.register(websocket)

// ─── Global Error Handler ───
app.setErrorHandler((error: any, request: any, reply: any) => {
  if (error instanceof AppError) {
    return reply.status(error.statusCode).send({
      error: error.name,
      message: error.message,
      code: error.code,
    })
  }

  if (error.validation) {
    return reply.status(400).send({
      error: 'ValidationError',
      message: error.message,
      details: error.validation,
    })
  }

  app.log.error(error)
  return reply.status(500).send({
    error: 'InternalServerError',
    message: config.NODE_ENV === 'development' ? error.message : 'Something went wrong',
  })
})

// ─── Health Check ───
app.get('/health', async () => ({
  status: 'ok',
  timestamp: new Date().toISOString(),
  uptime: process.uptime(),
}))

// ─── API Routes ───
await app.register(authRoutes, { prefix: '/api/auth' })
await app.register(eventRoutes, { prefix: '/api/events' })
await app.register(membersRoutes, { prefix: '/api/members' })
await app.register(adminRoutes, { prefix: '/api/admin' })
await app.register(dbRoutes, { prefix: '/api/db' })
await app.register(rpcRoutes, { prefix: '/api/rpc' })
await app.register(storageRoutes)
await app.register(functionsRoutes, { prefix: '/api/functions' })
await app.register(realtimeRoutes, { prefix: '/ws' })

// ─── Start Server ───
async function start() {
  try {
    await app.listen({ port: config.PORT, host: config.HOST })
    console.log(`[Server] Running on http://${config.HOST}:${config.PORT}`)
    console.log(`[Server] Environment: ${config.NODE_ENV}`)
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }
}

process.on('SIGTERM', async () => {
  await app.close()
  process.exit(0)
})

process.on('SIGINT', async () => {
  await app.close()
  process.exit(0)
})

start()
