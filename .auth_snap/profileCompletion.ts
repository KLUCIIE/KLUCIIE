import type { CustomFieldDef, Profile } from '@/lib/types'

const RESERVED_KEYS = new Set(['full_name', 'student_id', 'phone', 'department'])

export function isMsOauthProfile(profile: Profile | null | undefined): boolean {
  const cf = profile?.custom_fields ?? {}
  const flag = String(cf.ms_oauth ?? '')
  return flag === 'true' || flag === '1'
}

function fieldFilled(profile: Profile, key: string): boolean {
  const v = String(profile[key as keyof Profile] ?? profile.custom_fields?.[key] ?? '').trim()
  if (!v) return false
  if (key === 'student_id') return /^\d{10}$/.test(v)
  if (key === 'phone') return v.replace(/[^0-9]/g, '').length >= 10
  return true
}

/**
 * Fields a Microsoft-registered user must still fill in before they can use
 * the dashboard or register for events. Empty unless the account was created
 * through Microsoft OAuth.
 */
export function missingCompletionFields(
  profile: Profile | null | undefined,
  registerFields: CustomFieldDef[],
): CustomFieldDef[] {
  if (!profile || !isMsOauthProfile(profile)) return []

  const base: CustomFieldDef[] = [
    { key: 'full_name', label: 'Full name', type: 'text', required: true },
    { key: 'student_id', label: 'Student ID', type: 'text', required: true },
    { key: 'phone', label: 'Phone number', type: 'text', required: true },
    { key: 'department', label: 'Department / Branch', type: 'text', required: true },
  ]
  const extras = (registerFields ?? []).filter(
    (f) => f.required && f.key?.trim() && !RESERVED_KEYS.has(f.key),
  )

  const missing: CustomFieldDef[] = []
  for (const f of [...base, ...extras]) {
    if (f.key === 'full_name' || f.key === 'student_id' || f.key === 'phone' || f.key === 'department') {
      if (!fieldFilled(profile, f.key)) missing.push(f)
    } else if (!String(profile.custom_fields?.[f.key] ?? '').trim()) {
      missing.push(f)
    }
  }
  return missing
}