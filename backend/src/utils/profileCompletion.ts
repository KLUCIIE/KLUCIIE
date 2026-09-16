export interface RequiredFieldDef {
  key: string
  label: string
  type: string
}

export type RegisterFieldLike = {
  key?: string
  label?: string
  type?: string
  required?: boolean
  options?: string[]
}

export const BASE_REQUIRED_FIELDS: RequiredFieldDef[] = [
  { key: 'full_name', label: 'Full name', type: 'text' },
  { key: 'student_id', label: 'Student ID (10 digits)', type: 'text' },
  { key: 'phone', label: 'Phone number', type: 'text' },
  { key: 'department', label: 'Department / Branch', type: 'text' },
]

const RESERVED_KEYS = new Set(['full_name', 'student_id', 'phone', 'department'])

const COLUMN_MAP: Record<string, string> = {
  full_name: 'fullName',
  student_id: 'studentId',
  phone: 'phone',
  department: 'department',
}

export function requiredProfileFields(
  registerFields: RegisterFieldLike[],
): RequiredFieldDef[] {
  const extras = (registerFields ?? [])
    .filter((f) => f?.required && f?.key?.trim() && !RESERVED_KEYS.has(f.key))
    .map((f) => ({
      key: f.key!,
      label: f.label && f.label.trim() ? f.label : f.key!,
      type: f.type ?? 'text',
    }))
  return [...BASE_REQUIRED_FIELDS, ...extras]
}

export function profileFieldFilled(profile: any, key: string): boolean {
  if (!profile) return false
  const col = COLUMN_MAP[key] ?? key
  const v = String(profile[col] ?? profile.customFields?.[key] ?? '').trim()
  if (!v) return false
  if (key === 'student_id') return /^\d{10}$/.test(v)
  if (key === 'phone') return v.replace(/[^0-9]/g, '').length >= 10
  return true
}

export function missingProfileFields(
  profile: any,
  registerFields: RegisterFieldLike[],
): RequiredFieldDef[] {
  return requiredProfileFields(registerFields).filter(
    (f) => !profileFieldFilled(profile, f.key),
  )
}

export function isMsOauthProfile(profile: any): boolean {
  const cf = profile?.customFields ?? {}
  return cf?.ms_oauth === true || cf?.ms_oauth === 'true' || cf?.ms_oauth === '1'
}