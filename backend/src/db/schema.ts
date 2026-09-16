import { pgTable, text, integer, boolean, uuid, jsonb, timestamp, smallint, bigint, numeric, unique, check, pgEnum, customType, uniqueIndex } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

// ─── ENUMS ───
export const roleEnum = text('role', {
  enum: ['user', 'member', 'member_ciie', 'faculty', 'super_admin', 'main_admin', 'event_admin', 'member_admin', 'content_admin', 'gallery_admin', 'reports_admin', 'attendance_coordinator', 'mail_admin'],
})

export const statusEnum = text('status', {
  enum: ['pending', 'recruit', 'active', 'disabled'],
})

export const eventStatusEnum = text('status', {
  enum: ['draft', 'published', 'completed', 'cancelled'],
})

// ─── PROFILES ───
export const profiles = pgTable('profiles', {
  id: uuid('id').primaryKey(),
  email: text('email'),
  fullName: text('full_name'),
  ciieId: text('ciie_id').unique(),
  studentId: text('student_id'),
  role: roleEnum.notNull().default('member'),
  department: text('department'),
  yearOfBirth: text('year_of_study'),
  academicYear: text('academic_year'),
  team: text('team'),
  bio: text('bio'),
  domain: text('domain'),
  isListedMember: boolean('is_listed_member').notNull().default(false),
  skills: text('skills').array().notNull().default(sql`'{}'::text[]`),
  socialLinks: jsonb('social_links').notNull().default(sql`'{}'::jsonb`),
  avatarUrl: text('avatar_url'),
  phone: text('phone'),
  status: statusEnum.notNull().default('pending'),
  interviewBatch: smallint('interview_batch'),
  mfaEnabled: boolean('mfa_enabled').notNull().default(false),
  mfaSetupRequired: boolean('mfa_setup_required').notNull().default(false),
  customFields: jsonb('custom_fields').notNull().default(sql`'{}'::jsonb`),
  preTempRole: text('pre_temp_role'),
  tempRoleExpiresAt: timestamp('temp_role_expires_at', { withTimezone: true }),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// ─── MEMBER PRIVACY SETTINGS ───
export const memberPrivacySettings = pgTable('member_privacy_settings', {
  memberId: uuid('member_id').primaryKey().references(() => profiles.id, { onDelete: 'cascade' }),
  showOnLeaderboard: boolean('show_on_leaderboard').notNull().default(true),
  showPublicProfile: boolean('show_public_profile').notNull().default(true),
  showPoints: boolean('show_points').notNull().default(true),
  showEvents: boolean('show_events').notNull().default(true),
  showContact: boolean('show_contact').notNull().default(false),
  showAvatar: boolean('show_avatar').notNull().default(true),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// ─── EVENTS ───
export const events = pgTable('events', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  slug: text('slug').unique(),
  description: text('description'),
  category: text('category').notNull().default('Workshop'),
  bannerUrl: text('banner_url'),
  startDate: timestamp('start_date', { mode: 'date' }).notNull(),
  startTime: text('start_time'),
  endDate: timestamp('end_date', { mode: 'date' }),
  endTime: text('end_time'),
  venue: text('venue'),
  mode: text('mode', { enum: ['offline', 'online', 'hybrid'] }).notNull().default('offline'),
  registrationDeadline: timestamp('registration_deadline', { withTimezone: true }),
  seats: integer('seats').notNull().default(100),
  status: eventStatusEnum.notNull().default('draft'),
  registrationEnabled: boolean('registration_enabled').notNull().default(true),
  attendanceRounds: integer('attendance_rounds').notNull().default(1),
  showTeamPublic: boolean('show_team_public').notNull().default(true),
  coordinatorNote: text('coordinator_note'),
  formFields: jsonb('form_fields').notNull().default(sql`'[]'::jsonb`),
  audience: text('audience').notNull().default('all'),
  createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// ─── EVENT ROLES ───
export const eventRoles = pgTable('event_roles', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  description: text('description'),
  category: text('category', { enum: ['coordinator', 'volunteer', 'speaker', 'organizer', 'support', 'other'] }).notNull().default('other'),
  displayOrder: integer('display_order').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
  awardPoints: boolean('award_points').notNull().default(false),
  defaultPoints: integer('default_points').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// ─── EVENT TEAM MEMBERS ───
export const eventTeamMembers = pgTable('event_team_members', {
  id: uuid('id').primaryKey().defaultRandom(),
  eventId: uuid('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
  memberId: uuid('member_id').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
  roleId: uuid('role_id').notNull().references(() => eventRoles.id, { onDelete: 'cascade' }),
  isPublic: boolean('is_public').notNull().default(true),
  contactVisible: boolean('contact_visible').notNull().default(false),
  hoursWorked: numeric('hours_worked').notNull().default('0'),
  notes: text('notes'),
  createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique('event_team_members_event_member_role_key').on(t.eventId, t.memberId, t.roleId),
])

// ─── EVENT REGISTRATIONS ───
export const eventRegistrations = pgTable('event_registrations', {
  id: uuid('id').primaryKey().defaultRandom(),
  eventId: uuid('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
  memberId: uuid('member_id').references(() => profiles.id, { onDelete: 'set null' }),
  attendeeName: text('attendee_name').notNull(),
  email: text('email'),
  phone: text('phone'),
  department: text('department'),
  yearOfBirth: text('year_of_study'),
  studentId: text('student_id'),
  college: text('college'),
  registrationCode: text('registration_code').notNull().unique(),
  formData: jsonb('form_data').notNull().default(sql`'{}'::jsonb`),
  status: text('status', { enum: ['pending', 'confirmed', 'cancelled'] }).notNull().default('confirmed'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// ─── ATTENDANCE ───
export const attendance = pgTable('attendance', {
  id: uuid('id').primaryKey().defaultRandom(),
  eventId: uuid('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
  registrationId: uuid('registration_id').references(() => eventRegistrations.id, { onDelete: 'cascade' }),
  memberId: uuid('member_id').references(() => profiles.id, { onDelete: 'cascade' }),
  status: text('status', { enum: ['present', 'absent'] }).notNull(),
  method: text('method', { enum: ['qr', 'member_qr', 'manual'] }).notNull().default('qr'),
  round: integer('round').default(1),
  markedBy: uuid('marked_by').references(() => profiles.id, { onDelete: 'set null' }),
  markedAt: timestamp('marked_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique('attendance_event_member_key').on(t.eventId, t.memberId),
])

// ─── POINT RULES ───
export const pointRules = pgTable('point_rules', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  activityType: text('activity_type').notNull().unique(),
  points: integer('points').notNull(),
  isAutomatic: boolean('is_automatic').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
  category: text('category'),
  description: text('description'),
  createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// ─── MEMBER POINTS TRANSACTIONS ───
export const memberPointsTransactions = pgTable('member_points_transactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  memberId: uuid('member_id').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
  eventId: uuid('event_id').references(() => events.id, { onDelete: 'set null' }),
  activityType: text('activity_type').notNull(),
  points: integer('points').notNull(),
  description: text('description'),
  awardedBy: uuid('awarded_by').references(() => profiles.id, { onDelete: 'set null' }),
  isAutomatic: boolean('is_automatic').notNull().default(false),
  referenceType: text('reference_type'),
  referenceId: uuid('reference_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// ─── MEMBER ACHIEVEMENTS ───
export const memberAchievements = pgTable('member_achievements', {
  id: uuid('id').primaryKey().defaultRandom(),
  memberId: uuid('member_id').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  description: text('description'),
  category: text('category').notNull().default('Achievement'),
  achievedOn: timestamp('achieved_on', { mode: 'date' }),
  createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// ─── CERTIFICATES ───
export const certificates = pgTable('certificates', {
  id: uuid('id').primaryKey().defaultRandom(),
  eventId: uuid('event_id').references(() => events.id, { onDelete: 'cascade' }),
  memberId: uuid('member_id').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
  registrationId: uuid('registration_id').references(() => eventRegistrations.id, { onDelete: 'set null' }),
  certificateCode: text('certificate_code').notNull().unique(),
  title: text('title'),
  issuedBy: uuid('issued_by').references(() => profiles.id, { onDelete: 'set null' }),
  issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique('certificates_event_member_key').on(t.eventId, t.memberId),
])

// ─── GALLERY ITEMS ───
export const galleryItems = pgTable('gallery_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  eventId: uuid('event_id').references(() => events.id, { onDelete: 'cascade' }),
  title: text('title'),
  mediaUrl: text('media_url').notNull(),
  mediaType: text('media_type', { enum: ['image', 'video'] }).notNull().default('image'),
  photoDate: timestamp('photo_date', { mode: 'date' }),
  uploadedBy: uuid('uploaded_by').references(() => profiles.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// ─── ANNOUNCEMENTS ───
export const announcements = pgTable('announcements', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  body: text('body'),
  eventId: uuid('event_id').references(() => events.id, { onDelete: 'cascade' }),
  audience: text('audience', { enum: ['all', 'members', 'admins'] }).notNull().default('all'),
  pinned: boolean('pinned').notNull().default(false),
  createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
})

// ─── POSTS ───
export const posts = pgTable('posts', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  slug: text('slug').unique(),
  excerpt: text('excerpt'),
  content: text('content'),
  coverImage: text('cover_image'),
  published: boolean('published').notNull().default(false),
  authorId: uuid('author_id').references(() => profiles.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// ─── ADMIN AUDIT LOGS ───
export const adminAuditLogs = pgTable('admin_audit_logs', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  actorId: uuid('actor_id').references(() => profiles.id, { onDelete: 'set null' }),
  action: text('action').notNull(),
  entityType: text('entity_type'),
  entityId: text('entity_id'),
  details: jsonb('details'),
  ip: text('ip'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// ─── ADMIN RECOVERY CODES ───
export const adminRecoveryCodes = pgTable('admin_recovery_codes', {
  id: uuid('id').primaryKey().defaultRandom(),
  adminId: uuid('admin_id').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
  codeHash: text('code_hash').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  usedIp: text('used_ip'),
})

// ─── BRANDING SETTINGS (singleton) ───
export const brandingSettings = pgTable('branding_settings', {
  id: integer('id').primaryKey().default(1),
  ciieLogoUrl: text('ciie_logo_url'),
  darkLogoUrl: text('dark_logo_url'),
  lightLogoUrl: text('light_logo_url'),
  faviconUrl: text('favicon_url'),
  certificateLogoUrl: text('certificate_logo_url'),
  qrAttendanceLogoUrl: text('qr_attendance_logo_url'),
  primaryColor: text('primary_color').notNull().default('#7c3aed'),
  institutionName: text('institution_name').notNull().default('Koneru Lakshmaiah Education Foundation'),
  ciieName: text('ciie_name').notNull().default('CIIE — Centre for Innovation, Incubation & Entrepreneurship'),
  updatedBy: uuid('updated_by').references(() => profiles.id, { onDelete: 'set null' }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// ─── PLATFORM SETTINGS (singleton) ───
export const platformSettings = pgTable('platform_settings', {
  id: integer('id').primaryKey().default(1),
  allowPublicSignup: boolean('allow_public_signup').notNull().default(true),
  signupDomainRestriction: boolean('signup_domain_restriction').notNull().default(true),
  signupAllowedDomains: text('signup_allowed_domains').array().notNull().default(sql`'{kluniversity.in}'::text[]`),
  signupFields: jsonb('signup_fields').notNull().default(sql`'[]'::jsonb`),
  registerFields: jsonb('register_fields').notNull().default(sql`'[]'::jsonb`),
  signupEmailOtp: boolean('signup_email_otp').notNull().default(true),
  interviewDay1: timestamp('interview_day_1', { mode: 'date' }),
  interviewDay2: timestamp('interview_day_2', { mode: 'date' }),
  facebookUrl: text('facebook_url'),
  instagramUrl: text('instagram_url'),
  linkedinUrl: text('linkedin_url'),
  twitterUrl: text('twitter_url'),
  youtubeUrl: text('youtube_url'),
  contactEmail: text('contact_email'),
  contactPhone: text('contact_phone'),
  officeAddress: text('office_address'),
  amtpsMode: boolean('amtps_mode').notNull().default(true),
  allowPasswordReset: boolean('allow_password_reset').notNull().default(true),
  stopDynamicQr: boolean('stop_dynamic_qr').notNull().default(false),
  useAttendanceRealtime: boolean('use_attendance_realtime').notNull().default(true),
  signupDeadline: timestamp('signup_deadline', { withTimezone: true }),
  amtpsWings: jsonb('amtps_wings').notNull().default(sql`'[]'::jsonb`),
  updatedBy: uuid('updated_by').references(() => profiles.id, { onDelete: 'set null' }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// ─── OAUTH / SIGN-IN METHOD SETTINGS (singleton) ───
export const oauthSettings = pgTable('oauth_settings', {
  id: integer('id').primaryKey().default(1),
  enabled: boolean('enabled').notNull().default(false),
  loginEnabled: boolean('login_enabled').notNull().default(false),
  loginMicrosoft: boolean('login_microsoft').notNull().default(false),
  loginGithub: boolean('login_github').notNull().default(false),
  mode: text('mode').notNull().default('register'),
  msTenantId: text('ms_tenant_id'),
  msClientId: text('ms_client_id'),
  msClientSecret: text('ms_client_secret'),
  ghClientId: text('gh_client_id'),
  ghClientSecret: text('gh_client_secret'),
  updatedBy: uuid('updated_by').references(() => profiles.id, { onDelete: 'set null' }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// ─── MEMBER QR CODES ───
export const memberQrCodes = pgTable('member_qr_codes', {
  id: uuid('id').primaryKey().defaultRandom(),
  memberId: uuid('member_id').notNull().unique().references(() => profiles.id, { onDelete: 'cascade' }),
  code: text('code').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// ─── SMTP SETTINGS ───
export const smtpSettings = pgTable('smtp_settings', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull(),
  password: text('password').notNull(),
  fromName: text('from_name').notNull().default('KL CIIE'),
  host: text('host').notNull().default('smtp.gmail.com'),
  port: integer('port').notNull().default(465),
  isActive: boolean('is_active').notNull().default(true),
  position: integer('position').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// ─── EMAIL OTP CODES ───
export const emailOtpCodes = pgTable('email_otp_codes', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull(),
  purpose: text('purpose').notNull(),
  codeHash: text('code_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  attempts: integer('attempts').notNull().default(0),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// ─── JOIN APPLICATIONS ───
export const joinApplications = pgTable('join_applications', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull(),
  fullName: text('full_name').notNull(),
  studentId: text('student_id'),
  phone: text('phone'),
  department: text('department'),
  yearOfBirth: text('year_of_study'),
  fields: jsonb('fields').notNull().default(sql`'{}'::jsonb`),
  status: text('status', { enum: ['pending', 'submitted', 'expired'] }).notNull().default('pending'),
  codeHash: text('code_hash'),
  codeExpiresAt: timestamp('code_expires_at', { withTimezone: true }),
  codeAttempts: integer('code_attempts').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
})

// ─── RECRUIT APPLICATIONS ───
export const recruitApplications = pgTable('recruit_applications', {
  id: uuid('id').primaryKey().defaultRandom(),
  memberId: uuid('member_id').references(() => profiles.id, { onDelete: 'cascade' }),
  email: text('email'),
  fullName: text('full_name'),
  studentId: text('student_id'),
  phone: text('phone'),
  department: text('department'),
  yearOfBirth: text('year_of_study'),
  interviewBatch: smallint('interview_batch'),
  joinFields: jsonb('join_fields').notNull().default(sql`'{}'::jsonb`),
  stage: text('stage', { enum: ['gd', 'interview', 'final', 'selected', 'rejected'] }).notNull().default('gd'),
  gdFormId: uuid('gd_form_id').references(() => recruitFormTemplates.id, { onDelete: 'set null' }),
  interviewFormId: uuid('interview_form_id').references(() => recruitFormTemplates.id, { onDelete: 'set null' }),
  gdSubmittedAt: timestamp('gd_submitted_at', { withTimezone: true }),
  interviewSubmittedAt: timestamp('interview_submitted_at', { withTimezone: true }),
  finalDecision: text('final_decision', { enum: ['selected', 'rejected'] }),
  finalMessage: text('final_message'),
  decidedBy: uuid('decided_by').references(() => profiles.id, { onDelete: 'set null' }),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// ─── RECRUIT FORM TEMPLATES ───
export const recruitFormTemplates = pgTable('recruit_form_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  kind: text('kind', { enum: ['gd', 'interview'] }).notNull(),
  title: text('title').notNull(),
  description: text('description'),
  fields: jsonb('fields').notNull().default(sql`'[]'::jsonb`),
  isActive: boolean('is_active').notNull().default(true),
  createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// ─── RECRUIT EVALUATIONS ───
export const recruitEvaluations = pgTable('recruit_evaluations', {
  id: uuid('id').primaryKey().defaultRandom(),
  applicationId: uuid('application_id').notNull().references(() => recruitApplications.id, { onDelete: 'cascade' }),
  kind: text('kind', { enum: ['gd', 'interview'] }).notNull(),
  evaluatorId: uuid('evaluator_id').notNull().references(() => profiles.id, { onDelete: 'set null' }),
  responses: jsonb('responses').notNull().default(sql`'{}'::jsonb`),
  remarks: text('remarks'),
  submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique('recruit_evaluations_app_kind_evaluator_unique').on(t.applicationId, t.kind, t.evaluatorId),
])

// ─── RECRUIT REJECT REQUESTS ───
export const recruitRejectRequests = pgTable('recruit_reject_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  requestedBy: uuid('requested_by').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
  reason: text('reason'),
  status: text('status', { enum: ['pending', 'approved', 'denied', 'used'] }).notNull().default('pending'),
  decidedBy: uuid('decided_by').references(() => profiles.id, { onDelete: 'set null' }),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// ─── RECRUIT EMAILS ───
export const recruitEmails = pgTable('recruit_emails', {
  id: uuid('id').primaryKey().defaultRandom(),
  applicationId: uuid('application_id').references(() => recruitApplications.id, { onDelete: 'set null' }),
  toEmail: text('to_email').notNull(),
  subject: text('subject').notNull(),
  body: text('body'),
  status: text('status', { enum: ['sent', 'failed'] }).notNull().default('sent'),
  error: text('error'),
  sentBy: uuid('sent_by').references(() => profiles.id, { onDelete: 'set null' }),
  sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
})

// ─── AMTPS MEMBERS ───
export const amtpsMembers = pgTable('amtps_members', {
  id: uuid('id').primaryKey().defaultRandom(),
  fullName: text('full_name').notNull().default(''),
  email: text('email'),
  studentId: text('student_id'),
  department: text('department'),
  yearOfBirth: text('year_of_study'),
  position: text('position'),
  domain: text('domain'),
  about: text('about'),
  avatarUrl: text('avatar_url'),
  telegram: text('telegram'),
  github: text('github'),
  linkedin: text('linkedin'),
  contactEmail: text('contact_email'),
  displayOrder: integer('display_order').notNull().default(0),
  wing: text('wing'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// ─── STARTUPS ───
export const startups = pgTable('startups', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().default(''),
  websiteUrl: text('website_url'),
  logoUrl: text('logo_url'),
  bannerUrl: text('banner_url'),
  contactEmail: text('contact_email'),
  location: text('location'),
  socialLinks: jsonb('social_links').notNull().default(sql`'{}'::jsonb`),
  displayOrder: integer('display_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// ─── FACULTY FORMS ───
export const facultyForms = pgTable('faculty_forms', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  description: text('description'),
  fields: jsonb('fields').notNull().default(sql`'[]'::jsonb`),
  status: text('status', { enum: ['draft', 'published', 'closed'] }).notNull().default('published'),
  createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// ─── FACULTY FORM SUBMISSIONS ───
export const facultyFormSubmissions = pgTable('faculty_form_submissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  formId: uuid('form_id').notNull().references(() => facultyForms.id, { onDelete: 'cascade' }),
  memberId: uuid('member_id').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
  responses: jsonb('responses').notNull().default(sql`'{}'::jsonb`),
  submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique('faculty_form_submissions_form_member_key').on(t.formId, t.memberId),
])

// ─── REGISTRATION ROLES ───
export const registrationRoles = pgTable('registration_roles', {
  id: uuid('id').primaryKey().defaultRandom(),
  role: text('role').notNull().unique(),
  slug: text('slug').notNull().unique(),
  label: text('label').notNull(),
  secret: text('secret').notNull(),
  signingSecret: text('signing_secret').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  requiresKeys: boolean('requires_keys').notNull().default(true),
  fields: jsonb('fields').notNull().default(sql`'[]'::jsonb`),
  allowedDomains: text('allowed_domains').array().notNull().default(sql`'{}'::text[]`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// ─── EMAIL VERIFICATION THROTTLE ───
export const emailVerificationThrottle = pgTable('email_verification_throttle', {
  email: text('email').primaryKey(),
  resendCount: integer('resend_count').notNull().default(0),
  lastSentAt: timestamp('last_sent_at', { withTimezone: true }),
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
})

// ─── EVENT ROUND WINDOWS ───
export const eventRoundWindows = pgTable('event_round_windows', {
  id: uuid('id').primaryKey().defaultRandom(),
  eventId: uuid('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
  round: integer('round').notNull(),
  startsAt: timestamp('starts_at', { withTimezone: true }),
  endsAt: timestamp('ends_at', { withTimezone: true }),
  qrPayload: text('qr_payload'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// ─── DUTIES ───
export const duties = pgTable('duties', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  description: text('description'),
  eventId: uuid('event_id').references(() => events.id, { onDelete: 'set null' }),
  assignedTo: uuid('assigned_to').references(() => profiles.id, { onDelete: 'set null' }),
  status: text('status', { enum: ['pending', 'in_progress', 'completed'] }).notNull().default('pending'),
  createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// ─── DUTY ASSIGNMENTS ───
export const dutyAssignments = pgTable('duty_assignments', {
  id: uuid('id').primaryKey().defaultRandom(),
  dutyId: uuid('duty_id').notNull().references(() => duties.id, { onDelete: 'cascade' }),
  memberId: uuid('member_id').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique('duty_assignments_duty_member_key').on(t.dutyId, t.memberId),
])

// ─── DUTY FILES ───
export const dutyFiles = pgTable('duty_files', {
  id: uuid('id').primaryKey().defaultRandom(),
  dutyId: uuid('duty_id').notNull().references(() => duties.id, { onDelete: 'cascade' }),
  memberId: uuid('member_id').references(() => profiles.id, { onDelete: 'set null' }),
  fileKey: text('file_key'),
  fileName: text('file_name'),
  fileUrl: text('file_url'),
  fileType: text('file_type'),
  sizeBytes: bigint('size_bytes', { mode: 'number' }),
  uploadedBy: uuid('uploaded_by').references(() => profiles.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// ─── POST AUTHORS ───
export const postAuthors = pgTable('post_authors', {
  id: uuid('id').primaryKey().defaultRandom(),
  postId: uuid('post_id').notNull().references(() => posts.id, { onDelete: 'cascade' }),
  authorId: uuid('author_id').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique('post_authors_post_author_key').on(t.postId, t.authorId),
])

// ─── SMTP ROTATION STATE ───
export const smtpRotationState = pgTable('smtp_rotation_state', {
  id: integer('id').primaryKey().default(1),
  nextIndex: integer('next_index').notNull().default(0),
})

// ─── STORED FILES (Postgres-backed uploads) ───
// Uploaded media (banners, avatars, gallery images, branding) is persisted here
// so files survive ephemeral disk resets (e.g. Render free tiers). The on-disk
// copy under STORAGE_ROOT is only a cache.
const pgBytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' })

export const storedFiles = pgTable(
  'stored_files',
  {
    bucket: text('bucket').notNull(),
    name: text('name').notNull(),
    data: pgBytea('data').notNull(),
    contentType: text('content_type').notNull().default('application/octet-stream'),
    size: bigint('size', { mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('stored_files_bucket_name_key').on(t.bucket, t.name)],
)
