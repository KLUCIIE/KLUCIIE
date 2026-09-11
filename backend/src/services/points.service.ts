import { db } from '../db/index.js'
import { memberPointsTransactions, profiles, events, pointRules } from '../db/schema.js'
import { eq, sql, desc, and } from 'drizzle-orm'
import { cacheGet, cacheSet, cacheDel } from '../redis/index.js'
import { BadRequestError, NotFoundError } from '../utils/errors.js'

export async function getLeaderboard(filters: {
  academicYear?: string
  department?: string
  year?: string
  team?: string
  period?: 'all' | 'current'
} = {}) {
  const cacheKey = `leaderboard:${JSON.stringify(filters)}`
  const cached = await cacheGet<any[]>(cacheKey)
  if (cached) return cached

  const conditions = [sql`p.status = 'active'`]

  if (filters.academicYear) {
    conditions.push(sql`p.academic_year = ${filters.academicYear}`)
  }
  if (filters.department) {
    conditions.push(sql`p.department = ${filters.department}`)
  }
  if (filters.year) {
    conditions.push(sql`p.year_of_study = ${filters.year}`)
  }
  if (filters.team) {
    conditions.push(sql`p.team = ${filters.team}`)
  }

  const whereClause = conditions.length > 0 ? sql`${sql.join(conditions, sql` AND `)}` : sql`true`

  const result = await db.execute(sql`
    SELECT
      p.id as member_id,
      p.full_name,
      p.department,
      p.year_of_study,
      p.team,
      p.avatar_url,
      p.ciie_id,
      COALESCE(SUM(t.points), 0)::int as total_points,
      ROW_NUMBER() OVER (ORDER BY COALESCE(SUM(t.points), 0) DESC) as rank
    FROM profiles p
    LEFT JOIN member_points_transactions t ON t.member_id = p.id
    ${filters.period === 'current' ? sql`AND t.created_at >= date_trunc('year', CURRENT_DATE)` : sql``}
    WHERE ${whereClause}
    GROUP BY p.id, p.full_name, p.department, p.year_of_study, p.team, p.avatar_url, p.ciie_id
    HAVING COALESCE(SUM(t.points), 0) > 0
    ORDER BY total_points DESC
    LIMIT 100
  `)

  const rows = (result as any).rows || result
  await cacheSet(cacheKey, rows, 30)
  return rows
}

export async function getMemberRank(memberId: string) {
  const result = await db.execute(sql`
    SELECT
      COALESCE(SUM(t.points), 0)::int as total_points,
      ROW_NUMBER() OVER (ORDER BY COALESCE(SUM(t.points), 0) DESC) as rank
    FROM profiles p
    LEFT JOIN member_points_transactions t ON t.member_id = p.id
    WHERE p.id = ${memberId}
    GROUP BY p.id
  `)

  const rows = (result as any).rows || result
  return rows[0] || { total_points: 0, rank: 0 }
}

export async function awardPoints(params: {
  memberId: string
  points: number
  activityType: string
  description?: string
  eventId?: string
  referenceType?: string
  referenceId?: string
  awardedBy?: string
}) {
  if (params.points <= 0) throw new BadRequestError('Points must be positive')

  const [tx] = await db
    .insert(memberPointsTransactions)
    .values({
      memberId: params.memberId,
      points: params.points,
      activityType: params.activityType,
      description: params.description || null,
      eventId: params.eventId || null,
      referenceType: params.referenceType || null,
      referenceId: params.referenceId || null,
      awardedBy: params.awardedBy || null,
      isAutomatic: false,
    })
    .returning()

  await cacheDel('leaderboard:*')
  return tx
}

export async function getPointsStats() {
  const result = await db.execute(sql`
    SELECT
      COUNT(DISTINCT member_id)::int as total_members_with_points,
      COALESCE(SUM(points), 0)::int as total_points_awarded,
      COUNT(*)::int as total_transactions
    FROM member_points_transactions
  `)

  const rows = (result as any).rows || result
  return rows[0] || { total_members_with_points: 0, total_points_awarded: 0, total_transactions: 0 }
}

export async function getPointRules() {
  return db.query.pointRules.findMany({
    orderBy: [desc(pointRules.createdAt)],
  })
}
