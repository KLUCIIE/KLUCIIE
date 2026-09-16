import { useState } from 'react'
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import {
  Award,
  BarChart3,
  Camera,
  ClipboardCheck,
  ClipboardList,
  ContactRound,
  FileInput,
  FileSpreadsheet,
  FileText,
  Fingerprint,
  GraduationCap,
  Images,
  Inbox,
  KeyRound,
  LayoutDashboard,
  Link2,
  ListChecks,
  LogOut,
  Mail,
  Megaphone,
  Menu,
  Newspaper,
  Palette,
  RadioTower,
  Rocket,
  ScrollText,
  Settings,
  Shield,
  ShieldAlert,
  Ticket,
  Trash2,
  Trophy,
  UserCheck,
  UserCog,
  UserPlus,
  Users,
  X,
  Zap,
} from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { ROLE_LABELS } from '@/lib/types'
import { cn, initials } from '@/lib/utils'

export default function AdminLayout() {
  const { profile, isSuperAdmin, signOut } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const isMailAdmin = profile?.role === 'mail_admin'
  const isOnlySuperAdmin = profile?.role === 'super_admin'

  const navGroups = [
    {
      label: 'General',
      items: [
        { to: '/admin', label: 'Dashboard', icon: LayoutDashboard, end: true },
        { to: '/admin/events', label: 'Events', icon: Ticket },
        { to: '/admin/faculty-events', label: 'Faculty Events', icon: GraduationCap },
        { to: '/admin/roles', label: 'Event Roles', icon: Settings },
        { to: '/admin/point-rules', label: 'Point Rules', icon: Trophy },
        ...(isSuperAdmin ? [{ to: '/admin/points', label: 'Points & Awards', icon: Award }] : []),
      ],
    },
    {
      label: 'People',
      items: [
        { to: '/admin/members', label: 'Members', icon: Users },
        ...(isSuperAdmin ? [{ to: '/admin/members/add', label: 'Add Member', icon: UserPlus }] : []),
        ...(isSuperAdmin ? [{ to: '/admin/members/bulk-add', label: 'Bulk Add Members', icon: FileSpreadsheet }] : []),
        ...(isSuperAdmin ? [{ to: '/admin/members/bulk-delete', label: 'Bulk Delete Members', icon: Trash2 }] : []),
        ...(isSuperAdmin ? [{ to: '/admin/amtps', label: 'AMTPS', icon: ContactRound }] : []),
        { to: '/admin/recruits', label: 'Recruits', icon: UserCheck },
        ...(isOnlySuperAdmin ? [{ to: '/admin/admins', label: 'Admins & MFA', icon: Shield }] : []),
        ...(isOnlySuperAdmin ? [{ to: '/admin/user-roles', label: 'User Roles', icon: UserCog }] : []),
      ],
    },
    {
      label: 'Recruitment',
      items: [
        { to: '/admin/live-registrations', label: 'Live Registrations', icon: RadioTower },
        { to: '/admin/recruit-forms', label: 'Recruit Forms', icon: ClipboardList },
        { to: '/admin/reject-permissions', label: 'Reject Permissions', icon: ShieldAlert },
      ],
    },
    {
      label: 'Operations',
      items: [
        { to: '/admin/startups', label: 'Startups', icon: Rocket },
        { to: '/admin/attendance', label: 'Attendance', icon: Camera },
        { to: '/admin/attendance-records', label: 'Attendance Records', icon: ClipboardCheck },
        { to: '/admin/duties', label: 'Duties', icon: ClipboardList },
        { to: '/admin/certificates', label: 'Certificates', icon: FileText },
        { to: '/admin/gallery', label: 'Gallery', icon: Images },
        { to: '/admin/gallery-links', label: 'Gallery Links', icon: Link2 },
        { to: '/admin/announcements', label: 'Announcements', icon: Megaphone },
        { to: '/admin/content', label: 'Content (CMS)', icon: Newspaper },
        { to: '/admin/forms-submitted', label: 'Forms Submitted', icon: ListChecks },
        { to: '/admin/faculty-forms', label: 'Forms for Faculty', icon: FileInput },
        { to: '/admin/faculty-forms/submissions', label: 'Faculty Forms Submitted', icon: Inbox },
      ],
    },
    ...(isSuperAdmin
      ? [
          {
            label: 'Admin Controls',
            items: [
              { to: '/admin/events', label: 'Register Users', icon: UserPlus },
              { to: '/admin/force-register', label: 'Force Register', icon: Zap },
              { to: '/admin/attendance-records', label: 'Manual Attendance', icon: ClipboardCheck },
              { to: '/admin/members', label: 'All Users', icon: Users },
            ],
          },
        ]
      : []),
    {
      label: 'System',
      items: [
        { to: '/admin/reports', label: 'Reports', icon: BarChart3 },
        { to: '/admin/branding', label: 'Branding', icon: Palette },
        ...(!isMailAdmin ? [{ to: '/admin/settings', label: 'Settings', icon: Settings }] : []),
        ...(isSuperAdmin ? [{ to: '/admin/smtp', label: 'Email', icon: Mail }] : []),
        ...(isSuperAdmin ? [{ to: '/admin/send-mail', label: 'Send Email', icon: Mail }] : []),
        ...(isSuperAdmin ? [{ to: '/admin/oauth', label: 'Login OAuth', icon: Fingerprint }] : []),
        ...(isSuperAdmin ? [{ to: '/admin/registration-keys', label: 'Registration Keys', icon: KeyRound }] : []),
        { to: '/admin/audit-logs', label: 'Audit Logs', icon: ScrollText },
      ],
    },
  ]

  const sidebar = (
    <div className="flex h-full flex-col bg-slate-900 text-slate-300">
      <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
        <Link to="/admin" className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-600 text-white">
            <Shield size={18} />
          </span>
          <span>
            <span className="block text-sm font-black text-white">CIIE Admin</span>
            <span className="block text-[10px] uppercase tracking-widest text-slate-500">Console</span>
          </span>
        </Link>
        <button className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 lg:hidden" onClick={() => setOpen(false)}>
          <X size={18} />
        </button>
      </div>

      <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
        {navGroups.map((group) => (
          <div key={group.label}>
            <p className="mb-1 px-2 text-[10px] font-bold uppercase tracking-widest text-slate-600">{group.label}</p>
            {group.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                onClick={() => setOpen(false)}
                className={({ isActive }) =>
                  cn(
                    'mb-0.5 flex items-center gap-3 rounded-lg px-2 py-2 text-sm font-medium text-slate-400 transition hover:bg-slate-800 hover:text-white',
                    isActive && 'bg-primary-600 text-white hover:bg-primary-600',
                  )
                }
              >
                <item.icon size={16} />
                {item.label}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      <div className="border-t border-slate-800 p-4">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary-600 text-xs font-bold text-white">
            {initials(profile?.full_name)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-white">{profile?.full_name}</p>
            <p className="truncate text-[10px] text-slate-500">{profile ? ROLE_LABELS[profile.role] : ''}</p>
          </div>
          <button
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
            onClick={async () => {
              await signOut()
              navigate('/login')
            }}
            title="Sign out"
          >
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-slate-950">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 lg:block">{sidebar}</aside>

      {/* Mobile sidebar */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/60" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64">{sidebar}</aside>
        </div>
      )}

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-slate-200 bg-white/90 px-4 backdrop-blur lg:px-8 dark:border-slate-700 dark:bg-slate-900/90">
          <button className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden dark:text-slate-400 dark:hover:bg-slate-800" onClick={() => setOpen(true)}>
            <Menu size={20} />
          </button>
          <Link to="/" className="text-sm font-medium text-slate-500 hover:text-primary-600 dark:text-slate-400 dark:hover:text-primary-400">
            ← View public site
          </Link>
          <span className="text-xs text-slate-400 dark:text-slate-500">Admin console · MFA protected</span>
        </header>
        <main className="px-4 py-6 lg:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
