const postgres = require('postgres')
const url = 'postgresql://neondb_owner:npg_vVZbuEW68tUd@ep-raspy-resonance-a5leyoxu-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require'
const sql = postgres(url, { ssl: { rejectUnauthorized: false }, prepare: false })

async function main() {
  const tables = await sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' ORDER BY table_name
  `
  console.log('TABLES:', tables.map((t) => t.table_name).join(', '))

  const cols = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'admin_audit_logs' ORDER BY ordinal_position
  `
  console.log('admin_audit_logs columns:', cols.map((c) => c.column_name).join(', '))

  const profile = await sql`SELECT id, email, role, status, custom_fields FROM profiles WHERE email = 'superadmin@klciie.com'`
  console.log('PROFILE:', JSON.stringify(profile))

  await sql.end()
}

main().catch((e) => { console.error('ERROR:', e.message); process.exit(1) })