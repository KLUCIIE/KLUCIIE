import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { AlertTriangle, ShieldX, UserPlus } from 'lucide-react'
import { Button, Modal, Spinner } from '@/components/ui'
import { useAuth } from '@/hooks/useAuth'
import { apiOrigin, supabase } from '@/lib/supabase'
import { errorMessage } from '@/lib/utils'

const OAUTH_ERRORS: Record<string, string> = {
  domain_not_allowed:
    'Your email domain is not allowed on this platform. External sign-in is only available for registered domains.',
  no_email: 'The provider did not return an email address for your account.',
  disabled: 'External sign-in has been disabled.',
  not_configured: 'External sign-in is not configured. Ask an admin to set it up.',
  token_exchange_failed: 'The provider could not complete the sign-in. Please try again.',
  userinfo_failed: 'The provider could not load your profile. Please try again.',
  invalid_state: 'This sign-in link is invalid or has expired. Please try again.',
  access_denied: 'You cancelled the external sign-in.',
  missing_code: 'The provider did not return a code. Please try again.',
}

function oauthErrorMessage(reason: string): string {
  return OAUTH_ERRORS[reason] ?? `External sign-in failed (${reason}).`
}

function normalizeDomain(d: string): string {
  return d.trim().toLowerCase().replace(/^@/, '')
}

/** Same rule as the backend: a domain is allowed if it equals an allowed
 *  domain or is a subdomain of it. */
function emailDomainAllowed(email: string, allowedDomains: string[]): boolean {
  const domain = email.split('@').pop()?.toLowerCase() ?? ''
  if (!domain) return false
  const allowed = allowedDomains.map(normalizeDomain).filter(Boolean)
  return allowed.length === 0 || allowed.some((d) => domain === d || domain.endsWith('.' + d))
}

function emailLabel(email: string): string {
  return `@${email.split('@').pop() ?? email}`
}

export default function OAuthCallback() {
  const navigate = useNavigate()
  const location = useLocation()
  const { refreshProfile } = useAuth()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(true)
  const [signupTarget, setSignupTarget] = useState<string | null>(null)
  const [domainBlock, setDomainBlock] = useState<{ email?: string; allowed: string[] } | null>(null)
  const [provider, setProvider] = useState<'github' | 'microsoft'>('microsoft')
  const handled = useRef(false)

  useEffect(() => {
    if (handled.current) return
    handled.current = true

    const qs = new URLSearchParams(location.search)
    const token = qs.get('token')
    const err = qs.get('error')
    const from = qs.get('from') === 'register' ? 'register' : 'login'
    setProvider((qs.get('provider') ?? '').toLowerCase() === 'github' ? 'github' : 'microsoft')

    if (err) {
      if (err === 'domain_not_allowed') {
        void (async () => {
          let allowed: string[] = []
          try {
            const { data: ps } = await supabase
              .from('platform_settings')
              .select('signup_allowed_domains')
              .eq('id', 1)
              .maybeSingle()
            allowed = ((ps as { signup_allowed_domains?: string[] | null } | null)?.signup_allowed_domains ?? []).map(
              normalizeDomain,
            )
          } catch { /* ignore */ }
          setDomainBlock({ email: '', allowed: allowed.map((d) => `@${d}`) })
          setBusy(false)
        })()
        return
      }
      setError(oauthErrorMessage(err))
      setBusy(false)
      return
    }
    if (!token) {
      setError('Invalid external sign-in response.')
      setBusy(false)
      return
    }

    void (async () => {
      try {
        const res = await fetch(`${apiOrigin}/api/oauth/${provider}/exchange`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        })
        const data = (await res.json().catch(() => null)) as
          | {
              action?: string
              message?: string
              accessToken?: string
              refreshToken?: string
              user?: Record<string, unknown>
              email?: string
              fullName?: string
            }
          | null
          | undefined

        if (!res.ok) {
          const message = (data as { message?: string } | undefined)?.message ?? 'Sign in failed'
          if ((data as { message?: string } | undefined)?.message?.toLowerCase().includes('already exists')) {
            navigate('/login', { replace: true, state: { info: message } })
          } else {
            setError(message)
          }
          setBusy(false)
          return
        }

        if (data?.action === 'signup') {
          // Enforce the allowed-domains rule up front so unknown-domain signups
          // never reach the registration form (and can't silently proceed).
          if (data.email) {
            let allowed: string[] = []
            let restricted = false
            try {
              const { data: ps } = await supabase
                .from('platform_settings')
                .select('signup_domain_restriction, signup_allowed_domains')
                .eq('id', 1)
                .maybeSingle()
              const row = ps as { signup_domain_restriction?: boolean; signup_allowed_domains?: string[] | null } | null
              restricted = !!row?.signup_domain_restriction
              allowed = (row?.signup_allowed_domains ?? []).map(normalizeDomain)
            } catch {
              /* default to no restriction on fetch failure */
            }
            if (restricted && allowed.length > 0 && !emailDomainAllowed(data.email, allowed)) {
              setDomainBlock({ email: data.email, allowed: allowed.map((d) => `@${d}`) })
              setBusy(false)
              return
            }
          }

          const params = new URLSearchParams({ [`${provider}_token`]: token })
          if (data.email) params.set(`${provider}_email`, data.email)
          if (data.fullName) params.set(`${provider}_name`, data.fullName)
          setBusy(false)
          if (from === 'register') {
            navigate(`/register/user?${params.toString()}`, { replace: true })
          } else {
            setSignupTarget(`/register/user?${params.toString()}`)
          }
          return
        }

        if (data?.action === 'login' && data.accessToken && data.user) {
          await supabase.auth.setOAuthSession({
            accessToken: data.accessToken,
            refreshToken: data.refreshToken ?? '',
            user: data.user,
          })
          const prof = await refreshProfile()
          if (!prof) {
            setError('Signed in, but your profile could not be loaded.')
            setBusy(false)
            return
          }
          const superAdmin = prof.role === 'super_admin'
          if (superAdmin) {
            const { data: factors } = await supabase.auth.mfa.listFactors()
            const hasFactor = (factors?.totp ?? []).some((f) => f.status === 'verified')
            const mfaConfigured = prof.mfa_enabled || hasFactor
            if (mfaConfigured && (prof.mfa_setup_required || !hasFactor)) {
              navigate('/auth/mfa-setup', { replace: true })
              return
            }
            if (mfaConfigured) {
              navigate('/auth/mfa-verify', { replace: true })
              return
            }
          }
          navigate(prof.role === 'faculty' ? '/faculty' : '/dashboard', { replace: true })
          return
        }

        setError('Unexpected sign-in response.')
        setBusy(false)
      } catch (err) {
        setError(errorMessage(err))
        setBusy(false)
      }
    })()
  }, [location.search, navigate, refreshProfile])

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="card w-full max-w-sm p-8 text-center">
        {busy ? (
          <>
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-100 text-primary-600">
              <Spinner className="h-6 w-6" />
            </div>
            <h1 className="text-lg font-bold text-slate-900 dark:text-slate-100">Completing sign-in…</h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Just a moment.</p>
          </>
        ) : (
          <>
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-100 text-amber-600">
              <AlertTriangle size={24} />
            </div>
            <h1 className="text-lg font-bold text-slate-900 dark:text-slate-100">Sign-in issue</h1>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{error}</p>
            <Link to="/login" className="btn-primary mt-6 inline-block">
              Back to login
            </Link>
          </>
        )}
      </div>

      <Modal
        open={signupTarget !== null}
        onClose={() => navigate('/login', { replace: true })}
        title="No account found"
        footer={
          <>
            <Button variant="secondary" onClick={() => navigate('/login', { replace: true })}>
              Back to login
            </Button>
            <Button onClick={() => signupTarget && navigate(signupTarget, { replace: true })}>
              <UserPlus className="mr-2 h-4 w-4" />
              Go to user registration page
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600 dark:text-slate-300">
          This email isn't registered yet. To get started, first create your account from the user
          registration page — your details from Step 1 will be carried over.
        </p>
      </Modal>

      <Modal
        open={domainBlock !== null}
        onClose={() => navigate('/login', { replace: true })}
        title="Email domain not allowed"
        footer={
          <Button onClick={() => navigate('/login', { replace: true })}>Back to login</Button>
        }
      >
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-600">
            <ShieldX size={20} />
          </div>
          <div className="text-sm text-slate-600 dark:text-slate-300">
            <p>This domain is not allowed. Only sign-in with an email from the following domains is permitted:</p>
            {domainBlock && domainBlock.allowed.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {domainBlock.allowed.map((d) => (
                  <span
                    key={d}
                    className="rounded-lg bg-primary-50 px-3 py-1 text-sm font-semibold text-primary-700 dark:bg-primary-900/30 dark:text-primary-300"
                  >
                    {d}
                  </span>
                ))}
              </div>
            )}
            {domainBlock?.email ? (
              <p className="mt-3">
                The email on the {provider === 'github' ? 'GitHub' : 'Microsoft'} account you signed
                in with uses <span className="font-semibold">{emailLabel(domainBlock.email)}</span>,
                which isn't on the allowed list. Please try again with an account that uses an
                email from one of the allowed domains above.
              </p>
            ) : (
              <p className="mt-3">
                Please try again with a {provider === 'github' ? 'GitHub' : 'Microsoft'} account that
                uses an email from one of the allowed domains above.
              </p>
            )}
          </div>
        </div>
      </Modal>
    </div>
  )
}
