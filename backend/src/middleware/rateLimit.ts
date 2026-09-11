import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { incrWithExpiry, cacheGet } from '../redis/index.js'
import { TooManyRequestsError } from '../utils/errors.js'

interface RateLimitConfig {
  max: number
  windowSeconds: number
  keyPrefix: string
}

const DEFAULT_CONFIG: RateLimitConfig = {
  max: 100,
  windowSeconds: 60,
  keyPrefix: 'rl',
}

export function rateLimitMiddleware(config: Partial<RateLimitConfig> = {}) {
  const { max, windowSeconds, keyPrefix } = { ...DEFAULT_CONFIG, ...config }

  return async (request: FastifyRequest, reply: FastifyReply) => {
    const ip = request.ip || request.socket.remoteAddress || 'unknown'
    const key = `${keyPrefix}:${ip}`

    const count = await incrWithExpiry(key, windowSeconds)
    if (count > max) {
      reply.status(429).send({
        error: 'Too Many Requests',
        message: `Rate limit exceeded. Try again in ${windowSeconds} seconds.`,
        retryAfter: windowSeconds,
      })
    }

    reply.header('X-RateLimit-Limit', max)
    reply.header('X-RateLimit-Remaining', Math.max(0, max - count))
  }
}

export const authRateLimit = rateLimitMiddleware({ max: 10, windowSeconds: 60, keyPrefix: 'rl:auth' })
export const apiRateLimit = rateLimitMiddleware({ max: 100, windowSeconds: 60, keyPrefix: 'rl:api' })
export const emailRateLimit = rateLimitMiddleware({ max: 5, windowSeconds: 120, keyPrefix: 'rl:email' })
export const adminRateLimit = rateLimitMiddleware({ max: 200, windowSeconds: 60, keyPrefix: 'rl:admin' })
