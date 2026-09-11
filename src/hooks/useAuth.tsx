import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { supabase, type Factor, type User } from '@/lib/supabase'
import type { Profile, Role } from '@/lib/types'
import { isAdminRole } from '@/lib/types'
import { errorMessage } from '@/lib/utils'

type Aal = 'aal1' | 'aal2'

export interface MfaState {
  aal: Aal
  verifiedTotpFactors: Factor[]
  hasVerifiedFactor: boolean
}

export interface SignInResult {
  error: string | null
  mfaSetupRequired: boolean
  mfaVerifyRequired: boolean
  allowed: boolean
  isAdmin: boolean
  role?: Role | null
}

interface AuthContextValue {
  user: User | null
  profile: Profile | null
  mfa: MfaState | null
  loading: boolean
  isAdmin: boolean
  isSuperAdmin: boolean
  adminMfaVerified: boolean
  markAdminMfaVerified: () => void
  resetAdminMfa: () => void
  refreshProfile: () => Promise<Profile | null>
  refreshMfaState: () => Promise<MfaState>
  signIn: (email: string, password: string) => Promise<SignInResult>
  signUp: (
    fullName: string,
    email: string,
    password: string,
    meta?: { phone?: string; department?: string; year_of_study?: string } & Record<string, string>,
  ) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
}

const ADMIN_MFA_KEY = 'ciie_admin_mfa_verified'

function readAdminMfaVerified(): boolean {
  try {
    return sessionStorage.getItem(ADMIN_MFA_KEY) === '1'
  } catch {
    return false
  }
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [mfa, setMfa] = useState<MfaState | null>(null)
  const [adminMfaVerified, setAdminMfaVerified] = useState<boolean>(readAdminMfaVerified)
  const [loading, setLoading] = useState(true)
  const initialized = useRef(false)

  const markAdminMfaVerified = useCallback(() => {
    setAdminMfaVerified(true)
    try {
      sessionStorage.setItem(ADMIN_MFA_KEY, '1')
    } catch {
      // ignore storage errors
    }
  }, [])

  const resetAdminMfa = useCallback(() => {
    setAdminMfaVerified(false)
    try {
      sessionStorage.removeItem(ADMIN_MFA_KEY)
    } catch {
      // ignore storage errors
    }
  }, [])

  const loadProfile = useCallback(async (): Promise<Profile | null> => {
    const { data: sessionData } = await supabase.auth.getSession()
    const uid = sessionData.session?.user.id
    if (!uid) {
      setProfile(null)
      return null
    }

    const fetchRow = async (): Promise<{ data: Profile | null; error: { message: string } | null }> => {
      const res = await supabase.from('profiles').select('*').eq('id', uid).maybeSingle()
      return { data: (res.data as Profile) ?? null, error: res.error ? { message: res.error.message } : null }
    }

    let { data, error } = await fetchRow()

    // Self-heal: an auth account can exist without a profiles row (created
    // before the on_auth_user_created trigger was applied, or the row was
    // lost). ensure_my_profile() recreates it idempotently from auth metadata.
    if (!error && !data) {
      const { error: rpcError } = await supabase.rpc('ensure_my_profile')
      if (!rpcError) {
        const retry = await fetchRow()
        data = retry.data
        error = retry.error
      }
    }

    if (error) {
      setProfile(null)
      return null
    }
    if (!data) {
      // A locally cached session can outlive its auth user (account deleted
      // server-side): GET /auth/v1/user answers 403 and ensure_my_profile()
      // cannot recreate the row. Validate against the server and drop the
      // dead session instead of looping forever.
      const { data: userData, error: userError } = await supabase.auth.getUser()
      if (userError || !userData?.user) {
        setProfile(null)
        setMfa(null)
        setUser(null)
        resetAdminMfa()
        await supabase.auth.signOut().catch(() => {})
        return null
      }
      setProfile(null)
      return null
    }
    setProfile(data)
    return data
  }, [resetAdminMfa])

  const fetchMfaState = useCallback(async (): Promise<MfaState> => {
    let aal: Aal = 'aal1'
    let verifiedTotpFactors: Factor[] = []
    try {
      const { data: aalData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
      aal = (aalData?.currentLevel as Aal | undefined) ?? 'aal1'
      const { data: factors } = await supabase.auth.mfa.listFactors()
      verifiedTotpFactors = (factors?.totp ?? []).filter((f) => f.status === 'verified')
    } catch {
      // keep defaults
    }
    return { aal, verifiedTotpFactors, hasVerifiedFactor: verifiedTotpFactors.length > 0 }
  }, [])

  const refreshMfaState = useCallback(async (): Promise<MfaState> => {
    const state = await fetchMfaState()
    setMfa(state)
    return state
  }, [fetchMfaState])

  const refreshProfile = useCallback(async (): Promise<Profile | null> => {
    const prof = await loadProfile()
    await refreshMfaState()
    return prof
  }, [loadProfile, refreshMfaState])

  useEffect(() => {
    if (initialized.current) return
    initialized.current = true

    const boot = async () => {
      const { data: sessionData } = await supabase.auth.getSession()
      const sessionUser = sessionData.session?.user ?? null
      setUser(sessionUser)

      if (!sessionUser) {
        setLoading(false)
        return
      }

      await loadProfile()
      await refreshMfaState()
      setLoading(false)
    }

    boot()
  }, [loadProfile, refreshMfaState])

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, session) => {
      setUser(session?.user ?? null)
      if (session?.user) {
        await loadProfile()
        await refreshMfaState()
      } else {
        setProfile(null)
        setMfa(null)
        resetAdminMfa()
      }
    })
    return () => {
      sub.subscription.unsubscribe()
    }
  }, [loadProfile, refreshMfaState, resetAdminMfa])

  const signIn = useCallback(
    async (email: string, password: string): Promise<SignInResult> => {
      const base: SignInResult = {
        error: null,
        mfaSetupRequired: false,
        mfaVerifyRequired: false,
        allowed: false,
        isAdmin: false,
      }

      const { data, error } = await supabase.auth.signInWithPassword({ email, password })
      if (error || !data.user) {
        await supabase.rpc('log_failed_admin_login', { p_email: email })
        return { ...base, error: errorMessage(error) }
      }

      setUser(data.user)
      await supabase.rpc('record_login', { p_user_id: data.user.id, p_success: true })

      const prof = await loadProfile()
      const mfaState = await refreshMfaState()
      const admin = !!prof && isAdminRole(prof.role)
      const superAdmin = prof?.role === 'super_admin'

      if (!admin) {
        return { ...base, allowed: true, isAdmin: admin, role: prof?.role ?? null }
      }
      if (superAdmin) {
        const mfaConfigured = prof!.mfa_enabled || mfaState.hasVerifiedFactor
        if (mfaConfigured && (prof!.mfa_setup_required || !mfaState.hasVerifiedFactor)) {
          return { ...base, mfaSetupRequired: true, isAdmin: true }
        }
        if (mfaConfigured && mfaState.aal !== 'aal2') {
          return { ...base, mfaVerifyRequired: true, isAdmin: true }
        }
      }
      return { ...base, allowed: true, isAdmin: true }
    },
    [loadProfile, refreshMfaState],
  )

  const signUp = useCallback(
    async (
      fullName: string,
      email: string,
      password: string,
      meta?: { phone?: string; department?: string; year_of_study?: string } & Record<string, string>,
    ) => {
      const data: Record<string, string> = {
        full_name: fullName,
        phone: meta?.phone ?? '',
        department: meta?.department ?? '',
        year_of_study: meta?.year_of_study ?? '',
      }
      if (meta) {
        for (const [k, v] of Object.entries(meta)) {
          if (['phone', 'department', 'year_of_study'].includes(k)) continue
          data[k] = v
        }
      }
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data,
        },
      })
      if (error) return { error: errorMessage(error) }
      return { error: null }
    },
    [],
  )

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    setUser(null)
    setProfile(null)
    setMfa(null)
    resetAdminMfa()
  }, [resetAdminMfa])

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      profile,
      mfa,
      loading,
      isAdmin: !!profile && isAdminRole(profile.role),
      isSuperAdmin: profile?.role === 'super_admin' || profile?.role === 'main_admin',
      adminMfaVerified,
      markAdminMfaVerified,
      resetAdminMfa,
      refreshProfile,
      refreshMfaState,
      signIn,
      signUp,
      signOut,
    }),
    [
      user,
      profile,
      mfa,
      loading,
      adminMfaVerified,
      markAdminMfaVerified,
      resetAdminMfa,
      refreshProfile,
      refreshMfaState,
      signIn,
      signUp,
      signOut,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
