export type AdminRole =
  | 'super_admin'
  | 'main_admin'
  | 'event_admin'
  | 'member_admin'
  | 'content_admin'
  | 'gallery_admin'
  | 'reports_admin'
  | 'attendance_coordinator'
  | 'mail_admin'

export type Role = 'user' | 'member' | 'member_ciie' | 'faculty' | AdminRole

export interface Profile {
  id: string
  email: string | null
  full_name: string | null
  ciie_id: string | null
  student_id: string | null
  role: Role
  department: string | null
  year_of_study: string | null
  academic_year: string | null
  team: string | null
  bio: string | null
  domain: string | null
  is_listed_member: boolean
  skills: string[]
  social_links: Record<string, string>
  avatar_url: string | null
  phone: string | null
  status: 'pending' | 'recruit' | 'active' | 'disabled'
  interview_batch: 1 | 2 | null
  mfa_enabled: boolean
  mfa_setup_required: boolean
  pre_temp_role: Role | null
  temp_role_expires_at: string | null
  last_login_at: string | null
  created_at: string
  updated_at: string
  custom_fields?: Record<string, string>
}

/** An AMTPS wing (sub-group) defined by a super admin in Settings. */
export interface AmtpsWing {
  id: string
  name: string
  display_order: number
}

/** An AMTPS display card added by a super admin (no login account). */
export interface AmtpsMember {
  id: string
  full_name: string
  email: string | null
  student_id: string | null
  department: string | null
  year_of_study: string | null
  position: string | null
  domain: string | null
  about?: string | null
  avatar_url: string | null
  telegram: string | null
  github: string | null
  linkedin: string | null
  contact_email: string | null
  display_order?: number
  wing?: string | null
  created_at: string
  updated_at: string
}

/** A startup showcase card added by super admin / mail admin. */
export interface Startup {
  id: string
  name: string
  website_url: string | null
  logo_url: string | null
  banner_url: string | null
  contact_email: string | null
  location: string | null
  social_links: Record<string, string>
  display_order: number
  created_at: string
  updated_at: string
}

/** A registration form field definition (admin-editable, all mandatory). */
export interface CustomFieldDef {
  key: string
  label: string
  type: 'text' | 'number' | 'select' | 'textarea'
  required: boolean
  options?: string[]
}

export type FacultyFormStatus = 'draft' | 'published' | 'closed'

export interface FacultyForm {
  id: string
  title: string
  description: string | null
  fields: CustomFieldDef[]
  status: FacultyFormStatus
  allow_multiple: boolean
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface FacultyFormSubmission {
  id: string
  form_id: string
  member_id: string
  responses: Record<string, string>
  submitted_at: string
  updated_at: string
}

export interface RegistrationRole {
  id: string
  role: string
  slug: string
  label: string
  secret: string
  signing_secret: string
  enabled: boolean
  requires_keys: boolean
  fields: CustomFieldDef[]
  created_at?: string
  updated_at?: string
}

/** An admin-managed Gmail SMTP account used for registration OTP emails. */
export interface SmtpSetting {
  id?: string
  email: string
  password: string
  from_name: string
  host: string
  port: number
  is_active: boolean
  position: number
  created_at?: string
  updated_at?: string
}

export interface PlatformSettings {
  id: number
  allow_public_signup: boolean
  signup_domain_restriction: boolean
  signup_allowed_domains: string[]
  interview_day_1: string | null
  interview_day_2: string | null
  facebook_url: string | null
  instagram_url: string | null
  linkedin_url: string | null
  twitter_url: string | null
  youtube_url: string | null
  contact_email: string | null
  contact_phone: string | null
  office_address: string | null
  signup_fields: CustomFieldDef[]
  register_fields: CustomFieldDef[]
  signup_email_otp: boolean
  allow_password_reset: boolean
  stop_dynamic_qr: boolean
  use_attendance_realtime: boolean
  signup_deadline: string | null
  amtps_mode: boolean
  amtps_wings: AmtpsWing[]
  updated_by: string | null
  updated_at?: string
}

export interface PrivacySettings {
  member_id: string
  show_on_leaderboard: boolean
  show_public_profile: boolean
  show_points: boolean
  show_events: boolean
  show_contact: boolean
  show_avatar: boolean
  updated_at?: string
}

export interface Event {
  id: string
  title: string
  slug: string | null
  description: string | null
  category: string
  banner_url: string | null
  start_date: string
  start_time: string | null
  end_date: string | null
  end_time: string | null
  venue: string | null
  mode: 'offline' | 'online' | 'hybrid'
  registration_deadline: string | null
  seats: number
  status: 'draft' | 'published' | 'completed' | 'cancelled'
  audience: 'members' | 'faculty'
  registration_enabled: boolean
  show_team_public: boolean
  coordinator_note: string | null
  attendance_rounds: number
  form_fields: unknown[]
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface RoundWindow {
  round: number
  starts_at: string
  ends_at: string
}

export interface EventRole {
  id: string
  name: string
  description: string | null
  category: string
  display_order: number
  is_active: boolean
  award_points: boolean
  default_points: number
  created_at?: string
}

export interface EventTeamMember {
  id: string
  event_id: string
  member_id: string
  role_id: string
  is_public: boolean
  contact_visible: boolean
  hours_worked: number
  notes: string | null
  created_by: string | null
  created_at?: string
  member?: Pick<Profile, 'id' | 'full_name' | 'avatar_url' | 'ciie_id'> | null
  role?: Pick<EventRole, 'id' | 'name' | 'category'> | null
}

export interface PointRule {
  id: string
  name: string
  activity_type: string
  points: number
  is_automatic: boolean
  is_active: boolean
  category: string | null
  description: string | null
  created_by: string | null
  created_at?: string
  updated_at?: string
}

export interface PointsTransaction {
  id: string
  member_id: string
  event_id: string | null
  activity_type: string
  points: number
  description: string | null
  awarded_by: string | null
  is_automatic: boolean
  reference_type: string | null
  reference_id: string | null
  created_at: string
  event?: Pick<Event, 'id' | 'title' | 'description' | 'start_date'> | null
  awarded_by_profile?: Pick<Profile, 'id' | 'full_name'> | null
}

export interface MemberStats {
  member_id: string
  full_name: string | null
  ciie_id: string | null
  department: string | null
  year_of_study: string | null
  team: string | null
  avatar_url: string | null
  total_points: number
  events_attended: number
  events_worked: number
  volunteer_activities: number
  achievements: number
  certificates: number
}

export interface LeaderboardRow {
  rank: number
  member_id: string
  full_name: string
  ciie_id: string
  department: string | null
  year_of_study: string | null
  team: string | null
  avatar_url: string | null
  total_points: number
  events_attended: number
  events_worked: number
}

export interface MemberAchievement {
  id: string
  member_id: string
  title: string
  description: string | null
  category: string
  achieved_on: string | null
  created_by: string | null
  created_at?: string
}

export interface EventRegistration {
  id: string
  event_id: string
  member_id: string | null
  attendee_name: string
  email: string | null
  phone: string | null
  department: string | null
  year_of_study: string | null
  college: string | null
  registration_code: string
  form_data: Record<string, unknown>
  status: 'pending' | 'confirmed' | 'cancelled'
  created_at: string
  event?: Pick<Event, 'id' | 'title' | 'start_date'> | null
}

export interface Attendance {
  id: string
  event_id: string
  registration_id: string | null
  member_id: string | null
  round: number
  status: 'present' | 'absent'
  method: 'qr' | 'member_qr' | 'manual'
  marked_by: string | null
  marked_at: string
}

export interface Certificate {
  id: string
  event_id: string | null
  member_id: string
  registration_id: string | null
  certificate_code: string
  title: string | null
  issued_by: string | null
  issued_at: string
}

export interface GalleryItem {
  id: string
  event_id: string | null
  title: string | null
  photo_date: string | null
  media_url: string
  media_type: 'image' | 'video'
  uploaded_by: string | null
  created_at?: string
}

export interface Announcement {
  id: string
  title: string
  body: string | null
  event_id: string | null
  audience: 'all' | 'members' | 'admins'
  pinned: boolean
  created_by: string | null
  created_at?: string
  expires_at: string | null
}

export interface Post {
  id: string
  title: string
  slug: string | null
  excerpt: string | null
  content: string | null
  cover_image: string | null
  published: boolean
  author_id: string | null
  created_at?: string
  updated_at?: string
}

export interface AuditLog {
  id: number
  actor_id: string | null
  action: string
  entity_type: string | null
  entity_id: string | null
  details: Record<string, unknown> | null
  ip: string | null
  created_at: string
  actor?: Pick<Profile, 'id' | 'full_name' | 'email'> | null
}

export interface BrandingSettings {
  id: number
  ciie_logo_url: string | null
  dark_logo_url: string | null
  light_logo_url: string | null
  favicon_url: string | null
  certificate_logo_url: string | null
  qr_attendance_logo_url: string | null
  primary_color: string
  institution_name: string
  ciie_name: string
  updated_by: string | null
  updated_at?: string
}

export interface Duty {
  id: string
  title: string
  description: string | null
  duty_date: string | null
  location: string | null
  created_by: string | null
  created_at: string
}

export interface DutyAssignment {
  id: string
  duty_id: string
  member_id: string
  status: 'assigned' | 'in_progress' | 'completed' | 'absent'
  created_at: string
  duty?: Pick<Duty, 'id' | 'title' | 'description' | 'duty_date' | 'location'> | null
  member?: Pick<Profile, 'id' | 'full_name' | 'ciie_id'> | null
}

export interface DutyFile {
  id: string
  duty_id: string
  name: string
  path: string
  size: number | null
  content_type: string | null
  uploaded_by: string | null
  created_at: string
}

export type RecruitStage = 'gd' | 'interview' | 'final' | 'selected' | 'rejected'

export interface RecruitFormTemplate {
  id: string
  kind: 'gd' | 'interview'
  title: string
  description: string | null
  fields: CustomFieldDef[]
  is_active: boolean
  created_by: string | null
  created_at: string
  updated_at?: string
}

export interface RecruitInterviewEvaluation {
  evaluator_id: string | null
  evaluator_name: string | null
  evaluator_ciie_id: string | null
  responses: Record<string, unknown> | null
  remarks: string | null
  submitted_at: string | null
}

export interface RecruitApplicationRow {
  application_id: string
  member_id: string | null
  stage: RecruitStage
  full_name: string | null
  ciie_id: string | null
  student_id: string | null
  email: string | null
  phone: string | null
  department: string | null
  year_of_study: string | null
  interview_batch: number | null
  gd_form_id: string | null
  gd_form_title: string | null
  gd_form_fields: CustomFieldDef[] | null
  interview_form_id: string | null
  interview_form_title: string | null
  interview_form_fields: CustomFieldDef[] | null
  gd_submitted_at: string | null
  interview_submitted_at: string | null
  final_decision: 'selected' | 'rejected' | null
  final_message: string | null
  decided_by: string | null
  decided_at: string | null
  gd_evaluator: string | null
  gd_remarks: string | null
  gd_responses: Record<string, unknown> | null
  interview_evaluator: string | null
  interview_remarks: string | null
  interview_responses: Record<string, unknown> | null
  interview_evaluations: RecruitInterviewEvaluation[] | null
  created_at: string
}

export interface RecruitRejectRequest {
  id: string
  requested_by: string | null
  reason: string | null
  status: 'pending' | 'approved' | 'denied' | 'used'
  decided_by: string | null
  decided_at: string | null
  used_at: string | null
  created_at: string
  requester?: Pick<Profile, 'id' | 'full_name' | 'email' | 'ciie_id'> | null
}

export const ADMIN_ROLES: AdminRole[] = [
  'super_admin',
  'main_admin',
  'event_admin',
  'member_admin',
  'content_admin',
  'gallery_admin',
  'reports_admin',
  'attendance_coordinator',
  'mail_admin',
]

export const ROLE_LABELS: Record<Role, string> = {
  user: 'User',
  member: 'Member',
  member_ciie: 'CIIE Member',
  faculty: 'Faculty',
  super_admin: 'Super Admin',
  main_admin: 'Main Admin',
  event_admin: 'Event Admin',
  member_admin: 'Member Admin',
  content_admin: 'Content Admin',
  gallery_admin: 'Gallery Admin',
  reports_admin: 'Reports Admin',
  attendance_coordinator: 'Attendance Coordinator',
  mail_admin: 'Mail Admin',
}

export function isAdminRole(role: string | null | undefined): role is AdminRole {
  return !!role && (ADMIN_ROLES as string[]).includes(role)
}

export const SUPER_ADMIN_ROLES: AdminRole[] = ['super_admin', 'main_admin']

export function isSuperAdminRole(role: string | null | undefined): boolean {
  return !!role && (SUPER_ADMIN_ROLES as string[]).includes(role)
}
