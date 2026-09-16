import { useEffect, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { ShieldCheck } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useOAuth } from '@/hooks/useOAuth'
import { useSettings } from '@/hooks/useSettings'
import { Button, Field, Spinner, TextInput } from '@/components/ui'
import { OAuthDomainNotice } from '@/components/OAuthDomainNotice'
import { apiOrigin } from '@/lib/supabase'
import { errorMessage } from '@/lib/utils'

export default function Login() {
  const { signIn } = useAuth()
  const settings = useSettings()
  const { allow_password_reset: allowReset, signup_domain_restriction: domainRestriction, signup_allowed_domains: allowedDomains } = settings
  const oauth = useOAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [busy, setBusy] = useState(false)
  const [oauthStarting, setOauthStarting] = useState<'microsoft' | 'github' | null>(null)
  const [domainNotice, setDomainNotice] = useState<'microsoft' | 'github' | null>(null)

  useEffect(() => {
    const onShow = () => setOauthStarting(null)
    window.addEventListener('pageshow', onShow)
    return () => window.removeEventListener('pageshow', onShow)
  }, [])

  useEffect(() => {
    if (!oauthStarting) return
    const t = setTimeout(() => setOauthStarting(null), 5000)
    return () => clearTimeout(t)
  }, [oauthStarting])

  useEffect(() => {
    const info = (location.state as { info?: string } | null)?.info
    if (info) setError(info)
    if (info) window.history.replaceState({}, '')
  }, [location.state])

  const startMicrosoft = () => {
    if (domainRestriction && !!allowedDomains?.length) {
      setDomainNotice('microsoft')
      return
    }
    setOauthStarting('microsoft')
    window.location.href = `${apiOrigin}/api/oauth/microsoft/authorize`
  }
  const startGitHub = () => {
    if (domainRestriction && !!allowedDomains?.length) {
      setDomainNotice('github')
      return
    }
    setOauthStarting('github')
    window.location.href = `${apiOrigin}/api/oauth/github/authorize`
  }

  const [ghToken] = useSearchParams()
  const ghTokenValue = ghToken.get('gh_token')

  const msEnabled = oauth.enabled && oauth.login_enabled && oauth.login_microsoft && oauth.microsoft_configured
  const ghEnabled = oauth.enabled && oauth.login_enabled && oauth.login_github && oauth.github_configured

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    setSuccess('')
    try {
      const res = await signIn(email.trim(), password)
      if (res.error) {
        setError(res.error)
        return
      }
      const from = (location.state as { from?: string } | null)?.from
      if (res.mfaSetupRequired) {
        setSuccess('Logged in successfully — setting up security…')
        setTimeout(() => navigate('/auth/mfa-setup', { replace: true }), 600)
      } else if (res.mfaVerifyRequired) {
        setSuccess('Logged in successfully — verifying security code…')
        setTimeout(() => navigate('/auth/mfa-verify', { replace: true }), 600)
      } else if (res.isAdmin) {
        setSuccess('Logged in successfully — opening the admin console…')
        setTimeout(() => navigate(from?.startsWith('/admin') ? from : '/admin', { replace: true }), 600)
      } else {
        const home = res.role === 'faculty' ? '/faculty' : '/dashboard'
        setSuccess('Logged in successfully — opening your dashboard…')
        setTimeout(() => navigate(from ?? home, { replace: true }), 600)
      }
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card p-8">
      <div className="mb-6 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-100 text-primary-600">
          <ShieldCheck size={24} />
        </div>
        <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">Welcome back</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Log in to your CIIE account</p>
      </div>

      <form onSubmit={submit} className="space-y-4">
        <Field label="Email">
          <TextInput
            type="email"
            required
            autoComplete="email"
            placeholder="you@kluniversity.in"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field label="Password">
          <TextInput
            type="password"
            required
            autoComplete="current-password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <div className="flex justify-end">
          {allowReset && (
            <Link to="/reset-password" className="text-xs font-medium text-primary-600 hover:underline">
              Forgot password?
            </Link>
          )}
        </div>

        {success && <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">{success}</p>}
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        <Button type="submit" disabled={busy} className="w-full">
          {busy ? <Spinner className="border-white/40 border-t-white" /> : 'Log in'}
        </Button>
      </form>

      {(msEnabled || (ghEnabled && !ghTokenValue)) && (
        <div className="mt-6 space-y-3">
          <div className="flex items-center gap-3 text-xs text-slate-400">
            <span className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
            or continue with
            <span className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {msEnabled && (
              <button
                type="button"
                onClick={startMicrosoft}
                disabled={oauthStarting !== null}
                className="flex w-full cursor-default items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-default disabled:opacity-80 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 hover:dark:bg-slate-700"
              >
                {oauthStarting === 'microsoft' ? (
                  <>
                    <Spinner className="h-4 w-4" />
                    <span className="animate-pulse">Redirecting to Microsoft…</span>
                  </>
                ) : (
                  <>
                    <svg viewBox="0 0 23 23" className="h-4 w-4" aria-hidden>
                      <path fill="#f35325" d="M1 1h10v10H1z" />
                      <path fill="#81bc06" d="M12 1h10v10H12z" />
                      <path fill="#05a6f0" d="M1 12h10v10H1z" />
                      <path fill="#ffba08" d="M12 12h10v10H12z" />
                    </svg>
                    Continue with Microsoft
                  </>
                )}
              </button>
            )}
            {ghEnabled && !ghTokenValue && (
              <button
                type="button"
                onClick={startGitHub}
                disabled={oauthStarting !== null}
                className="flex w-full cursor-default items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-default disabled:opacity-80 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 hover:dark:bg-slate-700"
              >
                {oauthStarting === 'github' ? (
                  <>
                    <Spinner className="h-4 w-4 border-white/40 border-t-white" />
                    <span className="animate-pulse">Redirecting to GitHub…</span>
                  </>
                ) : (
                  <>
                    <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden>
                      <path
                        fill="currentColor"
                        d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.7-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"
                      />
                    </svg>
                    Continue with GitHub
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      )}

      <p className="mt-6 text-center text-sm text-slate-500 dark:text-slate-400">
        No account?{' '}
        <Link to="/register/user" className="font-semibold text-primary-600 hover:underline">
          Register / Sign up
        </Link>
      </p>

      <OAuthDomainNotice
        open={domainNotice !== null}
        provider={domainNotice ?? 'github'}
        settings={settings}
        onClose={() => setDomainNotice(null)}
        onConfirm={() => {
          const provider = domainNotice
          setDomainNotice(null)
          setOauthStarting(provider)
          window.location.href = `${apiOrigin}/api/oauth/${provider}/authorize`
        }}
      />
    </div>
  )
}
