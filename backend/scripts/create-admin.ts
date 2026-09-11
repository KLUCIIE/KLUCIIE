import postgres from 'postgres'
import { genSaltSync, hashSync } from 'bcrypt'

const sql = postgres('postgresql://postgres:postgres@localhost:5432/kl_ciie')
const adminId = '47b8f0c2-aaaa-4a7e-8f3f-7f3f7f3f7f3f'
const exists = await sql.unsafe('SELECT 1 FROM profiles WHERE id = $1', [adminId])
if (!exists.length) {
  const passHash = hashSync('AdminPass123!', genSaltSync(10))
  const customFields = { password_hash: passHash }
  await sql.unsafe(
    `INSERT INTO profiles (id, email, full_name, role, status, mfa_enabled, custom_fields, ciie_id, is_listed_member)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, false)`,
    [adminId, 'admin@kluniversity.in', 'Admin User', 'main_admin', 'active', false, JSON.stringify(customFields), 'CIIE2026A0001'],
  )
  console.log('admin test user created')
} else {
  console.log('admin test user already exists')
}
await sql.end()