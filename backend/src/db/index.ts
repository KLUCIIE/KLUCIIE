import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { config } from '../config/index.js'
import * as schema from './schema.js'

const client = postgres(config.DATABASE_URL, {
  max: 100,
  idle_timeout: 30,
  connect_timeout: 5,
  prepare: false,
})

export const db = drizzle(client, { schema })
export { client as pgClient }
