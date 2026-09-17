import { Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from '@/hooks/useAuth'
import { BrandingProvider } from '@/hooks/useBranding'
import { SettingsProvider } from '@/hooks/useSettings'
import { ThemeProvider } from '@/hooks/useTheme'
import { RequireAdmin, RequireAuth, RequireCiiieMember, RequireFaculty, RequireProfileComplete, RequireSuperAdmin, MfaResetWatcher } from '@/components/guards'
import { AuthLayout, PublicLayout } from '@/components/Layouts'
import OfflineIndicator from '@/components/OfflineIndicator'
import RouteErrorBoundary from '@/components/RouteErrorBoundary'
import { PageLoader } from '@/components/ui'
import { lazyPage } from '@/lib/lazyPage'

const Home = lazyPage(() => import('@/pages/Home'))
const About = lazyPage(() => import('@/pages/About'))
const Contact = lazyPage(() => import('@/pages/Contact'))
const UpcomingEvents = lazyPage(() => import('@/pages/UpcomingEvents'))
const EventsList = lazyPage(() => import('@/pages/EventsList'))
const Gallery = lazyPage(() => import('@/pages/Gallery'))
const EventDetail = lazyPage(() => import('@/pages/EventDetail'))
const EventRegister = lazyPage(() => import('@/pages/EventRegister'))
const CompleteProfile = lazyPage(() => import('@/pages/CompleteProfile'))
const RegisterSuccess = lazyPage(() => import('@/pages/RegisterSuccess'))
const Leaderboard = lazyPage(() => import('@/pages/Leaderboard'))
const MembersList = lazyPage(() => import('@/pages/MembersList'))
const MemberPublic = lazyPage(() => import('@/pages/MemberPublic'))
const AmtpsPage = lazyPage(() => import('@/pages/AmtpsPage'))
const AmtpsMemberPage = lazyPage(() => import('@/pages/AmtpsMemberPage'))
const StartupsPage = lazyPage(() => import('@/pages/StartupsPage'))
const PostsList = lazyPage(() => import('@/pages/PostsList'))
const PostDetail = lazyPage(() => import('@/pages/PostDetail'))
const Login = lazyPage(() => import('@/pages/Login'))
const Signup = lazyPage(() => import('@/pages/Signup'))
const Register = lazyPage(() => import('@/pages/Register'))
const RoleRegister = lazyPage(() => import('@/pages/RoleRegister'))
const RoleRegisterSuccess = lazyPage(() => import('@/pages/RoleRegisterSuccess'))
const VerifyApplication = lazyPage(() => import('@/pages/VerifyApplication'))
const ResetPassword = lazyPage(() => import('@/pages/ResetPassword'))
const NotFound = lazyPage(() => import('@/pages/NotFound'))

const MfaSetup = lazyPage(() => import('@/pages/auth/MfaSetup'))
const MfaVerify = lazyPage(() => import('@/pages/auth/MfaVerify'))

const MemberLayout = lazyPage(() => import('@/pages/member/MemberLayout'))
const MemberDashboard = lazyPage(() => import('@/pages/member/Dashboard'))
const MyEvents = lazyPage(() => import('@/pages/member/MyEvents'))
const MyPoints = lazyPage(() => import('@/pages/member/MyPoints'))
const ProfileEdit = lazyPage(() => import('@/pages/member/ProfileEdit'))
const MemberQrPage = lazyPage(() => import('@/pages/member/MemberQr'))
const MemberDuties = lazyPage(() => import('@/pages/member/Duties'))
const MemberScanQr = lazyPage(() => import('@/pages/member/ScanQr'))
const RecruitSuccess = lazyPage(() => import('@/pages/RecruitSuccess'))
const RecruitLayout = lazyPage(() => import('@/pages/member/recruit/RecruitLayout'))
const RecruitGd = lazyPage(() => import('@/pages/member/recruit/RecruitGd'))
const RecruitInterview = lazyPage(() => import('@/pages/member/recruit/RecruitInterview'))
const RecruitFinalSelection = lazyPage(() => import('@/pages/member/recruit/RecruitFinalSelection'))
const FacultyLayout = lazyPage(() => import('@/pages/faculty/FacultyLayout'))
const FacultyEvents = lazyPage(() => import('@/pages/faculty/FacultyEvents'))
const FacultyForms = lazyPage(() => import('@/pages/faculty/FacultyForms'))

const AdminLayout = lazyPage(() => import('@/pages/admin/AdminLayout'))
const AdminDashboard = lazyPage(() => import('@/pages/admin/Dashboard'))
const EventsAdmin = lazyPage(() => import('@/pages/admin/events/EventsAdmin'))
const EventEdit = lazyPage(() => import('@/pages/admin/events/EventEdit'))
const EventDetailAdmin = lazyPage(() => import('@/pages/admin/events/EventDetailAdmin'))
const EventTeam = lazyPage(() => import('@/pages/admin/events/EventTeam'))
const EventRoles = lazyPage(() => import('@/pages/admin/EventRoles'))
const PointRules = lazyPage(() => import('@/pages/admin/PointRules'))
const PointsAdmin = lazyPage(() => import('@/pages/admin/Points'))
const MembersAdmin = lazyPage(() => import('@/pages/admin/MembersAdmin'))
const MembersAdd = lazyPage(() => import('@/pages/admin/MembersAdd'))
const BulkAddMembers = lazyPage(() => import('@/pages/admin/BulkAddMembers'))
const BulkDeleteMembers = lazyPage(() => import('@/pages/admin/BulkDeleteMembers'))
const ForceRegister = lazyPage(() => import('@/pages/admin/ForceRegister'))
const AmtpsAdmin = lazyPage(() => import('@/pages/admin/AmtpsAdmin'))
const MemberDetailAdmin = lazyPage(() => import('@/pages/admin/MemberDetailAdmin'))
const AttendanceScanner = lazyPage(() => import('@/pages/admin/AttendanceScanner'))
const AttendanceAdmin = lazyPage(() => import('@/pages/admin/AttendanceAdmin'))
const CertificatesAdmin = lazyPage(() => import('@/pages/admin/Certificates'))
const GalleryAdmin = lazyPage(() => import('@/pages/admin/Gallery'))
const GalleryLinksAdmin = lazyPage(() => import('@/pages/admin/GalleryLinks'))
const AnnouncementsAdmin = lazyPage(() => import('@/pages/admin/Announcements'))
const ContentAdmin = lazyPage(() => import('@/pages/admin/Content'))
const ReportsAdmin = lazyPage(() => import('@/pages/admin/Reports'))
const FormsSubmittedAdmin = lazyPage(() => import('@/pages/admin/FormsSubmitted'))
const AttendanceSubmittedAdmin = lazyPage(() => import('@/pages/admin/AttendanceSubmitted'))
const BrandingAdmin = lazyPage(() => import('@/pages/admin/Branding'))
const AuditLogsAdmin = lazyPage(() => import('@/pages/admin/AuditLogs'))
const AdminsAdmin = lazyPage(() => import('@/pages/admin/Admins'))
const RegisterMfaAdmin = lazyPage(() => import('@/pages/admin/RegisterMfa'))
const UserRolesAdmin = lazyPage(() => import('@/pages/admin/UserRoles'))
const RecruitsAdmin = lazyPage(() => import('@/pages/admin/Recruits'))
const SettingsAdmin = lazyPage(() => import('@/pages/admin/Settings'))
const RegistrationKeysAdmin = lazyPage(() => import('@/pages/admin/RegistrationKeys'))
const DutiesAdmin = lazyPage(() => import('@/pages/admin/Duties'))
const LiveRegistrationsAdmin = lazyPage(() => import('@/pages/admin/recruit/LiveRegistrations'))
const RecruitFormsAdmin = lazyPage(() => import('@/pages/admin/recruit/RecruitForms'))
const RejectPermissionsAdmin = lazyPage(() => import('@/pages/admin/recruit/RejectPermissions'))
const SmtpSettingsAdmin = lazyPage(() => import('@/pages/admin/recruit/SmtpSettings'))
const SendMailAdmin = lazyPage(() => import('@/pages/admin/SendMail'))
const StartupsAdmin = lazyPage(() => import('@/pages/admin/StartupsAdmin'))
const FacultyEventsAdmin = lazyPage(() => import('@/pages/admin/FacultyEventsAdmin'))
const FacultyFormsAdmin = lazyPage(() => import('@/pages/admin/faculty/FacultyFormsAdmin'))
const FacultyFormEdit = lazyPage(() => import('@/pages/admin/faculty/FacultyFormEdit'))
const FacultyFormSubmissions = lazyPage(() => import('@/pages/admin/faculty/FacultyFormSubmissions'))

const OAuthCallback = lazyPage(() => import('@/pages/oauth/Callback'))
const OAuthAdmin = lazyPage(() => import('@/pages/admin/OAuth'))

export default function App() {
  return (
    <BrandingProvider>
      <SettingsProvider>
        <ThemeProvider>
        <AuthProvider>
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <OfflineIndicator />
          <MfaResetWatcher />
          <RouteErrorBoundary>
          <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route element={<PublicLayout />}>
              <Route path="/" element={<Home />} />
              <Route path="/about" element={<About />} />
              <Route path="/contact" element={<Contact />} />
              <Route path="/upcoming-events" element={<UpcomingEvents />} />
              <Route path="/events" element={<EventsList />} />
              <Route path="/events/:id" element={<EventDetail />} />
              <Route path="/events/:id/register" element={<RequireAuth><RequireProfileComplete><EventRegister /></RequireProfileComplete></RequireAuth>} />
              <Route path="/register/success/:registrationId" element={<RegisterSuccess />} />
              <Route path="/members" element={<MembersList />} />
              <Route path="/members/:id" element={<MemberPublic />} />
              <Route path="/amtps" element={<AmtpsPage />} />
              <Route path="/amtps/:id" element={<AmtpsMemberPage />} />
              <Route path="/posts" element={<PostsList />} />
              <Route path="/posts/:slug" element={<PostDetail />} />
              <Route path="/gallery" element={<Gallery />} />
              <Route path="/startups" element={<StartupsPage />} />

              <Route element={<RequireAuth />}>
                <Route path="/dashboard" element={<RequireProfileComplete><MemberLayout /></RequireProfileComplete>}>
                  <Route index element={<MemberDashboard />} />
                  <Route path="events" element={<MyEvents />} />
                  <Route path="points" element={<MyPoints />} />
                  <Route path="leaderboard" element={<Leaderboard />} />
                  <Route path="duties" element={<RequireCiiieMember><MemberDuties /></RequireCiiieMember>} />
                  <Route path="scan-qr" element={<RequireCiiieMember><MemberScanQr /></RequireCiiieMember>} />
                  <Route path="profile" element={<ProfileEdit />} />
                  <Route path="qr" element={<MemberQrPage />} />
                </Route>
                <Route path="/recruit" element={<RequireCiiieMember><RecruitLayout /></RequireCiiieMember>}>
                  <Route path="gd" element={<RecruitGd />} />
                  <Route path="interview" element={<RecruitInterview />} />
                  <Route path="final" element={<RecruitFinalSelection />} />
                </Route>
                <Route path="/leaderboard" element={<Navigate to="/dashboard/leaderboard" replace />} />
                <Route path="/recruit/success" element={<RecruitSuccess />} />
                <Route path="/faculty" element={<RequireFaculty><FacultyLayout /></RequireFaculty>}>
                  <Route index element={<FacultyEvents />} />
                  <Route path="forms" element={<FacultyForms />} />
                  <Route path="qr" element={<MemberQrPage />} />
                  <Route path="profile" element={<ProfileEdit />} />
                </Route>
                <Route path="/complete-profile" element={<CompleteProfile />} />
              </Route>
            </Route>

            <Route element={<AuthLayout />}>
              <Route path="/login" element={<Login />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/signup" element={<Signup />} />
              <Route path="/register" element={<Register />} />
              <Route path="/register/:slug" element={<RoleRegister />} />
              <Route path="/register-faculty" element={<RoleRegister slug="faculty" hideStudentId />} />
              <Route path="/register/role/success" element={<RoleRegisterSuccess />} />
              <Route path="/verify-application" element={<VerifyApplication />} />
              <Route path="/oauth/callback" element={<OAuthCallback />} />
            </Route>

            <Route path="/auth/mfa-setup" element={<MfaSetup />} />
            <Route path="/auth/mfa-verify" element={<MfaVerify />} />

            <Route element={<RequireAdmin />}>
              <Route path="/admin" element={<AdminLayout />}>
                <Route index element={<AdminDashboard />} />
                <Route path="events" element={<EventsAdmin />} />
                <Route path="events/new" element={<EventEdit />} />
                <Route path="events/:id" element={<EventDetailAdmin />} />
                <Route path="events/:id/edit" element={<EventEdit />} />
                <Route path="faculty-events" element={<FacultyEventsAdmin />} />
                <Route path="faculty-events/new" element={<EventEdit audience="faculty" />} />
                <Route path="faculty-events/:id/edit" element={<EventEdit audience="faculty" />} />
                <Route path="faculty-forms" element={<FacultyFormsAdmin />} />
                <Route path="faculty-forms/new" element={<FacultyFormEdit />} />
                <Route path="faculty-forms/submissions" element={<FacultyFormSubmissions />} />
                <Route path="faculty-forms/:id/edit" element={<FacultyFormEdit />} />
                <Route path="events/:id/team" element={<EventTeam />} />
                <Route path="roles" element={<EventRoles />} />
                <Route path="point-rules" element={<PointRules />} />
                <Route path="points" element={<RequireSuperAdmin><PointsAdmin /></RequireSuperAdmin>} />
                <Route path="members" element={<MembersAdmin />} />
                <Route path="members/add" element={<MembersAdd />} />
                <Route path="members/bulk-add" element={<RequireSuperAdmin><BulkAddMembers /></RequireSuperAdmin>} />
                <Route path="members/bulk-delete" element={<RequireSuperAdmin><BulkDeleteMembers /></RequireSuperAdmin>} />
                <Route path="force-register" element={<RequireSuperAdmin><ForceRegister /></RequireSuperAdmin>} />
                <Route path="amtps" element={<RequireSuperAdmin><AmtpsAdmin /></RequireSuperAdmin>} />
                <Route path="members/:id" element={<MemberDetailAdmin />} />
                <Route path="recruits" element={<RecruitsAdmin />} />
                <Route path="attendance" element={<AttendanceAdmin />} />
                <Route path="attendance/:eventId" element={<AttendanceScanner />} />
                <Route path="duties" element={<DutiesAdmin />} />
                <Route path="certificates" element={<CertificatesAdmin />} />
                <Route path="gallery" element={<GalleryAdmin />} />
                <Route path="gallery-links" element={<GalleryLinksAdmin />} />
                <Route path="announcements" element={<AnnouncementsAdmin />} />
                <Route path="content" element={<ContentAdmin />} />
                <Route path="reports" element={<ReportsAdmin />} />
                <Route path="forms-submitted" element={<FormsSubmittedAdmin />} />
                <Route path="attendance-records" element={<AttendanceSubmittedAdmin />} />
                <Route path="branding" element={<BrandingAdmin />} />
                <Route path="settings" element={<SettingsAdmin />} />
                <Route path="registration-keys" element={<RegistrationKeysAdmin />} />
                <Route path="oauth" element={<RequireSuperAdmin><OAuthAdmin /></RequireSuperAdmin>} />
                <Route path="live-registrations" element={<LiveRegistrationsAdmin />} />
                <Route path="recruit-forms" element={<RecruitFormsAdmin />} />
                <Route path="reject-permissions" element={<RejectPermissionsAdmin />} />
                <Route path="smtp" element={<RequireSuperAdmin><SmtpSettingsAdmin /></RequireSuperAdmin>} />
                <Route path="send-mail" element={<RequireSuperAdmin><SendMailAdmin /></RequireSuperAdmin>} />
                <Route path="audit-logs" element={<AuditLogsAdmin />} />
                <Route path="startups" element={<StartupsAdmin />} />
                <Route path="admins" element={<AdminsAdmin />} />
                <Route path="register-mfa" element={<RequireSuperAdmin><RegisterMfaAdmin /></RequireSuperAdmin>} />
                <Route path="user-roles" element={<RequireSuperAdmin><UserRolesAdmin /></RequireSuperAdmin>} />
              </Route>
            </Route>

            <Route path="*" element={<NotFound />} />
          </Routes>
          </Suspense>
          </RouteErrorBoundary>
        </BrowserRouter>
        </AuthProvider>
        </ThemeProvider>
      </SettingsProvider>
    </BrandingProvider>
  )
}
