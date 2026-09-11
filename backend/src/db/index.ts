import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { config } from '../config/index.js'
import * as schema from './schema.js'

const databaseUrl = config.DATABASE_URL.replace(/&channel_binding=require/g, '')

const client = postgres(databaseUrl, {
  max: 100,
  idle_timeout: 30,
  connect_timeout: 5,
  prepare: false,
  ssl: databaseUrl.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined,
})

export const db = drizzle(client, { schema })
export { client as pgClient }
