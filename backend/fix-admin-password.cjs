const postgres = require('postgres')

const url = 'postgresql://neondb_owner:npg_vVZbuEW68tUd@ep-raspy-resonance-a5leyoxu-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require'
const sql = postgres(url, { ssl: { rejectUnauthorized: false }, prepare: false })

const bcrypt = require('bcrypt')
const passwordHash = '$2b$10$UkmB2rQmDKSPH0AV6jZObexamKf2dIWGO9xYtiLHbChtef5fIa7tG'

async function main() {
  const customFields = JSON.stringify({ password_hash: passwordHash })
  const res = await sql`
    UPDATE profiles SET custom_fields = ${customFields}::jsonb, updated_at = NOW()
    WHERE email = 'superadmin@klciie.com'
    RETURNING id, email, role, status
  `
  console.log('UPDATED:', JSON.stringify(res))

  const check = await sql`SELECT custom_fields FROM profiles WHERE email = 'superadmin@klciie.com'`
  const stored = JSON.parse(check[0].custom_fields).password_hash
  console.log('stored hash now:', stored)
  console.log('bcrypt compare:', await bcrypt.compare('SuperAdmin@2026', stored))

  await sql.end()
}

main().catch((e) => { console.error('ERROR:', e.message); process.exit(1) })