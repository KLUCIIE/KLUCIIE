import { defineConfig } from 'drizzle-kit'

const rawUrl = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/kl_ciie'
const dbUrl = rawUrl.replace(/&channel_binding=require/g, '')

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: dbUrl,
  },
})
