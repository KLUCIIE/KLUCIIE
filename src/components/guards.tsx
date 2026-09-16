import type { ReactNode } from 'react'
import { useEffect, useRef } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { useSettings } from '@/hooks/useSettings'
import { missingCompletionFields } from '@/lib/profileCompletion'
import { isAdminRole } from '@/lib/types'
import { PageLoader } from '@/components/ui'

/**
 * Returns the MFA route a super admin must visit before the Admin Console,
 * or null when they are clear to proceed. MFA is only enforced for super
 * admin accounts that actually have MFA configured (mfa_enabled or a
 * verified factor); accounts without MFA sign in with just email + password.
 *
 * A super admin must re-verify MFA each time they enter the Admin Console
 * (`adminMfaVerified` is reset when they navigate away), not just once
 * per session.
 */
export function useMfaRedirect(): string | null {
  const { profile, mfa, adminMfaVerified } = useAuth()
  if (!profile || profile.role !== 'super_admin') return null
  const mfaConfigured = profile.mfa_enabled || !!mfa?.hasVerifiedFactor
  if (!mfaConfigured) return null
  if (profile.mfa_setup_required && !mfa?.hasVerifiedFactor) return '/auth/mfa-setup'
  if (!mfa) return null
  if (!mfa.hasVerifiedFactor) return '/auth/mfa-setup'
  if (mfa.aal !== 'aal2') return '/auth/mfa-verify'
  if (!adminMfaVerified) return '/auth/mfa-verify'
  return null
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
  if (mfaPath) return <Navigate to={mfaPath} replace />
  return <>{children ?? <Outlet />}</>
}

export function RequireSuperAdmin({ children }: { children?: ReactNode }) {
  const { user, profile, loading } = useAuth()
  const location = useLocation()
  const mfaPath = useMfaRedirect()
  if (loading) return <PageLoader />
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />
  if (!profile || (profile.role !== 'super_admin' && profile.role !== 'main_admin')) return <Navigate to="/dashboard" replace />
  if (mfaPath) return <Navigate to={mfaPath} replace />
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
