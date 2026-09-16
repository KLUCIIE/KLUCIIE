import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import * as schema from './src/db/schema.js'
import { eq } from 'drizzle-orm'

const url = 'postgresql://neondb_owner:npg_vVZbuEW68tUd@ep-raspy-resonance-a5leyoxu-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require'
const dbUrl = url.replace(/&channel_binding=require/g, '')
const client = postgres(dbUrl, { max: 10, prepare: false, ssl: { rejectUnauthorized: false } })
const db = drizzle(client, { schema })

try {
  const profile = await db.query.profiles.findFirst({ where: eq(schema.profiles.email, 'superadmin@klciie.com') })
  console.log('PROFILE FOUND:', !!profile)
  console.log('customFields:', profile?.customFields)
  const storedHash = ((profile?.customFields ?? {}) as any)?.password_hash
  console.log('storedHash:', storedHash)

  const { verifyPassword } = await import('./src/auth/passwords.js')
  const ok = await verifyPassword('SuperAdmin@2026', storedHash)
  console.log('PASSWORD OK:', ok)

  await db.update(schema.profiles).set({ lastLoginAt: new Date(), updatedAt: new Date() }).where(eq(schema.profiles.id, profile.id))
  console.log('recordLogin OK')
} catch (e: any) {
  console.error('THREW:', e.message)
  console.error(e)
} finally {
  await client.end()
}