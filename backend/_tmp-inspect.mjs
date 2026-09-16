import { config as dotenvConfig } from 'dotenv'
import postgres from 'postgres'
dotenvConfig({ path: new URL('.env', import.meta.url) })
const sql = postgres(process.env.DATABASE_URL)
try {
  const roles = await sql`select slug, role, label, fields from registration_roles order by slug`
  console.log('ROLES', JSON.stringify(roles, null, 1))
  const ps = await sql`select register_fields, signup_allowed_domains, signup_domain_restriction from platform_settings where id = 1`
  console.log('PLATFORM', JSON.stringify(ps, null, 1))
  const pro = await sql`select role, count(*)::int from profiles group by role order by role`
  console.log('ROLE COUNTS', JSON.stringify(pro))
} finally { await sql.end() }
