import { db } from '../db/index.js'
import { profiles, memberQrCodes, memberPrivacySettings } from '../db/schema.js'
import { eq, sql } from 'drizzle-orm'
import { hashPassword } from '../auth/passwords.js'
import { generateQrCode, generateCiieId } from '../utils/codes.js'
import { cacheGet, cacheSet, cacheDel } from '../redis/index.js'

const PROFILE_CACHE_TTL = 120

export async function getProfile(userId: string) {
  const cached = await cacheGet<any>(`profile:${userId}`)
  if (cached) return cached

  const profile = await db.query.profiles.findFirst({
    where: eq(profiles.id, userId),
  })

  if (profile) {
    await cacheSet(`profile:${userId}`, profile, PROFILE_CACHE_TTL)
  }

  return profile
}

export async function getProfileByEmail(email: string) {
  return db.query.profiles.findFirst({
    where: eq(profiles.email, email),
  })
}

/**
 * Reads the profile straight from the database, bypassing the in-memory
 * `profile:<id>` cache. Security-sensitive flows (MFA secret checks) must use
 * this so a stale cache entry can never validate/reject against an old secret.
 */
export async function getProfileFresh(userId: string) {
  return db.query.profiles.findFirst({
    where: eq(profiles.id, userId),
  })
}

export async function createProfile(data: {
  id: string
  email: string
  fullName?: string
  role?: string
  studentId?: string
  phone?: string
  department?: string
  yearOfBirth?: string
  status?: 'pending' | 'recruit' | 'active' | 'disabled'
}) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const ciieId = await generateNextCiieId()
    try {
      const [profile] = await db
        .insert(profiles)
        .values({
          id: data.id,
          email: data.email,
          fullName: data.fullName || null,
          role: (data.role as any) || 'member',
          studentId: data.studentId || null,
          phone: data.phone || null,
          department: data.department || null,
          yearOfBirth: data.yearOfBirth || null,
          ciieId,
          status: data.status || 'active',
        })
        .returning()

      await db.insert(memberQrCodes).values({
        memberId: data.id,
        code: generateQrCode(),
      })

      await db.insert(memberPrivacySettings).values({
        memberId: data.id,
      })

      return profile
    } catch (err: any) {
      if (err?.code !== '23505' || !String(err?.constraint ?? '').includes('ciie_id')) throw err
    }
  }
  throw new Error('Could not allocate a unique CIIE ID')
}

export async function updateProfile(userId: string, data: Partial<typeof profiles.$inferInsert>) {
  const [updated] = await db
    .update(profiles)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(profiles.id, userId))
    .returning()

  await cacheDel(`profile:${userId}`)
  return updated
}

export async function recordLogin(userId: string) {
  await db
    .update(profiles)
    .set({ lastLoginAt: new Date(), updatedAt: new Date() })
    .where(eq(profiles.id, userId))

  await cacheDel(`profile:${userId}`)
}

async function generateNextCiieId(): Promise<string> {
  const year = new Date().getFullYear()
  const result = await db.execute(sql`
    SELECT ciie_id FROM profiles
    WHERE ciie_id ~ ${`^CIIE${year}[0-9]{5}$`}
    ORDER BY ciie_id DESC LIMIT 1
  `)
  const list: any[] = Array.isArray(result) ? result : ((result as any).rows ?? [])
  const last = (list[0] as { ciie_id?: string } | undefined)?.ciie_id
  const match = last ? last.match(/(\d{5})$/) : null
  const seq = match ? parseInt(match[1], 10) + 1 : 1
  return generateCiieId(year, seq)
}

export async function getPublicMember(memberId: string) {
  return db.query.profiles.findFirst({
    where: eq(profiles.id, memberId),
    columns: {
      id: true,
      fullName: true,
      ciieId: true,
      department: true,
      yearOfBirth: true,
      academicYear: true,
      team: true,
      bio: true,
      domain: true,
      skills: true,
      socialLinks: true,
      avatarUrl: true,
      role: true,
    },
  })
}
