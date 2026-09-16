import dotenv from 'dotenv'
import { z } from 'zod'

dotenv.config()

const envSchema = z.object({
  DATABASE_URL: z.string().default('postgresql://postgres:postgres@localhost:5432/kl_ciie'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  JWT_SECRET: z.string().min(16).default('change-this-to-a-secure-random-string-at-least-16-chars'),
  JWT_ACCESS_EXPIRY: z.string().default('15m'),
  JWT_REFRESH_EXPIRY: z.string().default('7d'),
  PORT: z.coerce.number().default(3001),
  HOST: z.string().default('0.0.0.0'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  // Brevo HTTP API (works on platforms that block SMTP ports, e.g. Render free
  // tier). When BREVO_API_KEY is set, ALL mail goes through Brevo instead of SMTP.
  BREVO_API_KEY: z.string().optional(),
  BREVO_SENDER_EMAIL: z.string().optional(),
  BREVO_SENDER_NAME: z.string().optional(),
  // Gmail API via OAuth (HTTPS-only, works everywhere SMTP ports are blocked).
  // When GMAIL_CLIENT_ID/SECRET + GMAIL_REFRESH_TOKEN are set, ALL mail goes
  // through the Gmail API instead of SMTP (takes precedence over SMTP pool).
  GMAIL_CLIENT_ID: z.string().optional(),
  GMAIL_CLIENT_SECRET: z.string().optional(),
  GMAIL_REFRESH_TOKEN: z.string().optional(),
  GMAIL_SENDER: z.string().optional(),
  GMAIL_FROM_NAME: z.string().default('KL CIIE'),
  STORAGE_ROOT: z.string().optional(),
  STORAGE_PUBLIC_URL: z.string().optional(),
  // OAuth redirect targets. FRONTEND_URL is where the SPA lives and where the
  // browser is sent after the provider callback. OAUTH_CALLBACK_BASE_URL is the
  // public base URL of THIS backend, used to build the callback URLs GitHub /
  // Azure must call back on — default derives from FRONTEND_URL for the classic
  // setup where the frontend proxies /api to the backend (e.g. Vite dev).
  // OAUTH_REDIRECT_URI is an exact Microsoft redirect target override.
  FRONTEND_URL: z.string().default('http://localhost:5173'),
  OAUTH_CALLBACK_BASE_URL: z.string().optional(),
  OAUTH_REDIRECT_URI: z.string().optional(),
})

export const config = envSchema.parse(process.env)
