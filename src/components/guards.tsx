import type { ReactNode } from 'react'
import { useEffect, useRef } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { useSettings } from '@/hooks/useSettings'
import { missingCompletionFields } from '@/lib/profileCompletion'
import { isAdminRole } from '@/lib/types'
import { PageLoader } from '@/components/ui'

/**
 * The in-console page where a super admin sets up their own MFA
 * (see src/pages/admin/RegisterMfa.tsx). Visiting it must not trigger an
 * MFA redirect, otherwise super admins without MFA would hit a loop.
 */
export const SELF_MFA_PAGE = '/admin/register-mfa'

/**
 * Returns the MFA route a super admin must visit before the Admin Console,
 * or null when they are clear to proceed. MFA is enforced for every super
 * admin: accounts without MFA are sent to the in-console Register MFA page
 * so they can enroll, accounts with a pending setup flag go through the
 * full-screen setup flow, and configured accounts must re-verify each time
 * they enter the Admin Console (`adminMfaVerified` is reset when they
 * navigate away), not just once per session.
 */
export function useMfaRedirect(): string | null {
  const { profile, mfa, adminMfaVerified } = useAuth()
  if (!profile || profile.role !== 'super_admin') return null
  if (profile.mfa_setup_required && !mfa?.hasVerifiedFactor) return '/auth/mfa-setup'
  if (!mfa) return null
  if (!mfa.hasVerifiedFactor) return SELF_MFA_PAGE
  if (mfa.aal !== 'aal2') return '/auth/mfa-verify'
  if (!adminMfaVerified) return '/auth/mfa-verify'
  return null
}

function isOnSelfMfaPage(pathname: string): boolean {
  return pathname === SELF_MFA_PAGE
}

/**
 * Renders nothing. Watches route changes and clears the admin MFA
 * verification flag whenever the user leaves the Admin Console, so the
 * next time they open it they are asked to verify again.
 */
export function MfaResetWatcher() {
  const location = useLocation()
  const { resetAdminMfa } = useAuth()
  const prevPath = useRef(location.pathname)

  useEffect(() => {
    const prev = prevPath.current
    prevPath.current = location.pathname
    if (prev.startsWith('/admin') && !location.pathname.startsWith('/admin')) {
      resetAdminMfa()
    }
  }, [location.pathname, resetAdminMfa])

  return null
}

export function RequireAuth({ children }: { children?: ReactNode }) {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) return <PageLoader />
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />
  return <>{children ?? <Outlet />}</>
}

export function RequireAdmin({ children }: { children?: ReactNode }) {
  const { user, profile, loading } = useAuth()
  const location = useLocation()
  const mfaPath = useMfaRedirect()
  if (loading) return <PageLoader />
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />
  if (!profile || !isAdminRole(profile.role)) return <Navigate to="/dashboard" replace />
  if (mfaPath && !isOnSelfMfaPage(location.pathname)) return <Navigate to={mfaPath} replace />
  return <>{children ?? <Outlet />}</>
}

export function RequireSuperAdmin({ children }: { children?: ReactNode }) {
  const { user, profile, loading } = useAuth()
  const location = useLocation()
  const mfaPath = useMfaRedirect()
  if (loading) return <PageLoader />
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />
  if (!profile || (profile.role !== 'super_admin' && profile.role !== 'main_admin')) return <Navigate to="/dashboard" replace />
  if (mfaPath && !isOnSelfMfaPage(location.pathname)) return <Navigate to={mfaPath} replace />
  return <>{children ?? <Outlet />}</>
}

export function RequireCiiieMember({ children }: { children?: ReactNode }) {
  const { user, profile, loading } = useAuth()
  const location = useLocation()
  if (loading) return <PageLoader />
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />
  if (!profile || profile.role !== 'member_ciie') return <Navigate to="/dashboard" replace />
  return <>{children ?? <Outlet />}</>
}

export function RequireFaculty({ children }: { children?: ReactNode }) {
  const { user, profile, loading } = useAuth()
  const location = useLocation()
  if (loading) return <PageLoader />
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />
  if (!profile || profile.role !== 'faculty') return <Navigate to="/dashboard" replace />
  return <>{children ?? <Outlet />}</>
}

/**
 * Gates the member area for Microsoft-registered accounts until they have
 * filled in every mandatory detail (Student ID 10 digits, phone, department,
 * plus required admin fields). Admins and normally-registered members are
 * never affected. Skips redirect the moment the profile is complete, so it
 * re-checks on every navigation even if the user opened a new tab.
 */
export function RequireProfileComplete({ children }: { children?: ReactNode }) {
  const { user, profile, loading } = useAuth()
  const settings = useSettings()
  const location = useLocation()
  if (loading) return <PageLoader />
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />
  const missing = missingCompletionFields(profile, settings.register_fields)
  if (missing.length > 0) {
    const from = location.pathname + location.search
    return <Navigate to="/complete-profile" state={{ from }} replace />
  }
  return <>{children ?? <Outlet />}</>
}
