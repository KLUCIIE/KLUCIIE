import { useEffect, useState, type FormEvent } from 'react'
import { Eye, EyeOff, Github, Info, LogIn, Save, ShieldCheck, UserPlus } from 'lucide-react'
import { Button, Field, PageHeader, Spinner, TextInput, Toggle } from '@/components/ui'
import { useAuth } from '@/hooks/useAuth'
import { getOAuthAdminSettings, supabase } from '@/lib/supabase'
import type { OAuthMode } from '@/lib/types'
import { cn, errorMessage } from '@/lib/utils'

const MODE_OPTIONS: { value: OAuthMode; label: string; hint: string }[] = [
  {
    value: 'register',
    label: 'Email / password only',
    hint: 'No external provider buttons on either page. Register & login both use email/password.',
  },
  {
    value: 'microsoft',
    label: 'Email / password + Microsoft',
    hint: 'Email/password register form PLUS a "Continue with Microsoft" button below. Login page gets the button when the Login OAuth toggle below is on.',
  },
  {
    value: 'github',
    label: 'Email / password + GitHub',
    hint: 'Email/password register form PLUS a "Continue with GitHub" button below. Login page gets the button when the Login OAuth toggle below is on.',
  },
  {
    value: 'both',
    label: 'Email / password + Microsoft + GitHub',
    hint: 'Email/password register form PLUS both "Continue with Microsoft" and "Continue with GitHub" buttons.',
  },
  {
    value: 'microsoft+github-only',
    label: 'Microsoft + GitHub only (register page)',
    hint: 'Register page shows ONLY the Microsoft and GitHub buttons — the email/password form is hidden entirely. Never shown on the login page.',
  },
  {
    value: 'microsoft-only',
    label: 'Microsoft only (register page)',
    hint: 'Register page shows ONLY the Microsoft button (no email/password form). Never shown on the login page.',
  },
  {
    value: 'github-only',
    label: 'GitHub only (register page)',
    hint: 'Register page shows ONLY the GitHub button (no email/password form). Never shown on the login page.',
  },
]

export default function OAuthAdmin() {
  const { profile, isSuperAdmin } = useAuth()
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [enabled, setEnabled] = useState(false)
  const [loginEnabled, setLoginEnabled] = useState(false)
  const [loginMicrosoft, setLoginMicrosoft] = useState(false)
  const [loginGithub, setLoginGithub] = useState(false)
  const [mode, setMode] = useState<OAuthMode>('register')
  const [tenant, setTenant] = useState('')
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [showSecret, setShowSecret] = useState(false)
  const [ghClientId, setGhClientId] = useState('')
  const [ghClientSecret, setGhClientSecret] = useState('')
  const [showGhSecret, setShowGhSecret] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    let active = true
    getOAuthAdminSettings()
      .then(({ data, error: err }) => {
        if (!active) return
        if (err) {
          setError(errorMessage(err))
        } else if (data) {
          setEnabled(data.enabled)
          setLoginEnabled(data.login_enabled ?? false)
          setLoginMicrosoft(data.login_microsoft ?? false)
          setLoginGithub(data.login_github ?? false)
          setMode(data.mode ?? 'register')
          setTenant(data.ms_tenant_id ?? '')
          setClientId(data.ms_client_id ?? '')
          setClientSecret(data.ms_client_secret ?? '')
          setGhClientId(data.gh_client_id ?? '')
          setGhClientSecret(data.gh_client_secret ?? '')
        }
      })
      .finally(() => setLoading(false))
    return () => {
      active = false
    }
  }, [])

  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (!isSuperAdmin) return
    setBusy(true)
    setError('')
    setSaved(false)
    const { error: err } = await supabase
      .from('oauth_settings')
      .upsert(
        {
          id: 1,
          enabled,
          login_enabled: loginEnabled,
          login_microsoft: loginMicrosoft,
          login_github: loginGithub,
          mode,
          ms_tenant_id: tenant.trim() || null,
          ms_client_id: clientId.trim() || null,
          ms_client_secret: clientSecret.trim() || null,
          gh_client_id: ghClientId.trim() || null,
          gh_client_secret: ghClientSecret.trim() || null,
          updated_by: profile?.id ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'id' },
      )
    setBusy(false)
    if (err) {
      setError(errorMessage(err))
      return
    }
    await supabase.rpc('log_admin_event', {
      p_action: 'OAuth Settings Updated',
      p_entity_type: 'settings',
      p_entity_id: 'oauth',
      p_details: { enabled, login_enabled: loginEnabled, login_microsoft: loginMicrosoft, login_github: loginGithub, mode },
    })
    setSaved(true)
  }
const microsoftVisible = mode === 'microsoft' || mode === 'both' || mode === 'microsoft-only' || mode === 'microsoft+github-only'

  const githubVisible = mode === 'github' || mode === 'both' || mode === 'github-only' || mode === 'microsoft+github-only'

  const credentialsConfigured = !!tenant && !!clientId && !!clientSecret && (mode === 'microsoft' || mode === 'both' || mode === 'microsoft-only' || mode === 'microsoft+github-only')
  return (
    <div>
      <PageHeader
        title="OAuth & sign-in providers"
        subtitle="Two independent controls: the provider credentials are entered once in the Register OAuth section, and the Login OAuth toggle reuses them on the login page."
      />

      {loading ? (
        <div className="flex justify-center py-12">
          <Spinner className="h-7 w-7" />
        </div>
      ) : (
        <form onSubmit={save} className="max-w-4xl space-y-6">
          {/* ─── Register page OAuth (hosts the credentials) ─── */}
          <section className="card space-y-4 border-violet-200 p-6 dark:border-violet-900">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 text-base font-bold text-slate-900">
                <UserPlus size={18} className="text-violet-600" /> Register page OAuth
              </h2>
              <span className="rounded-full bg-violet-100 px-2.5 py-0.5 text-[11px] font-semibold text-violet-700">
                Credentials live here
              </span>
            </div>
            <p className="text-xs text-slate-500">
              Turning this on shows the chosen provider button(s) on the register page and unlocks them for the login
              page below. The Microsoft / GitHub secrets are entered here only — the login section reuses them.
            </p>

            <Toggle checked={enabled} onChange={setEnabled} label="Enable OAuth providers on the register page" />

            <div>
              <p className="mb-2 text-sm font-semibold text-slate-700">Provider</p>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {MODE_OPTIONS.map((opt) => (
                  <label
                    key={opt.value}
                    className={cn(
                      'flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition',
                      mode === opt.value
                        ? 'border-violet-400 bg-violet-50'
                        : 'border-slate-200 hover:border-slate-300',
                    )}
                  >
                    <input
                      type="radio"
                      name="oauth-mode"
                      className="mt-0.5 accent-violet-600"
                      checked={mode === opt.value}
                      onChange={() => setMode(opt.value)}
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-bold text-slate-900">{opt.label}</span>
                      <span className="block text-xs text-slate-500">{opt.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>

            {microsoftVisible && (
              <div className="space-y-4 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                  <ShieldCheck size={16} /> Microsoft OAuth secrets
                </h3>
                <div className="flex items-start gap-2 rounded-xl bg-violet-50 px-4 py-3 text-sm text-violet-800">
                  <Info size={16} className="mt-0.5 shrink-0" />
                  <div>
                    <p className="font-semibold">How to set up Azure AD / Microsoft Entra</p>
                    <p className="mt-0.5 text-violet-700/90">
                      Create an app registration in the Azure portal, add the exact redirect URI as a web platform, and
                      paste the tenant ID and application (client) ID and secret below.
                    </p>
                  </div>
                </div>
                <Field label="Tenant ID (Directory ID)">
                  <TextInput value={tenant} onChange={(e) => setTenant(e.target.value)} placeholder="00000000-0000-0000-0000-000000000000" />
                </Field>
                <Field label="Client ID (Application ID)">
                  <TextInput value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="00000000-0000-0000-0000-000000000000" />
                </Field>
                <Field label="Client secret">
                  <div className="relative">
                    <TextInput
                      type={showSecret ? 'text' : 'password'}
                      value={clientSecret}
                      onChange={(e) => setClientSecret(e.target.value)}
                      placeholder="Paste the client secret value"
                      className="pr-10"
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-600"
                      onClick={() => setShowSecret((v) => !v)}
                      title={showSecret ? 'Hide secret' : 'Show secret'}
                    >
                      {showSecret ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </Field>
              </div>
            )}

            {githubVisible && (
              <div className="space-y-4 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                  <Github size={16} /> GitHub OAuth secrets
                </h3>
                <div className="flex items-start gap-2 rounded-xl bg-slate-100 px-4 py-3 text-sm text-slate-700">
                  <Info size={16} className="mt-0.5 shrink-0" />
                  <div>
                    <p className="font-semibold">How to set up GitHub OAuth</p>
                    <p className="mt-0.5 text-slate-500">
                      Create a GitHub App (or OAuth app), set the callback URL, and paste the client ID and secret below.
                    </p>
                  </div>
                </div>
                <Field label="Client ID">
                  <TextInput value={ghClientId} onChange={(e) => setGhClientId(e.target.value)} placeholder="Iv1.xxxxxxxxxxxxxxxx" />
                </Field>
                <Field label="Client secret">
                  <div className="relative">
                    <TextInput
                      type={showGhSecret ? 'text' : 'password'}
                      value={ghClientSecret}
                      onChange={(e) => setGhClientSecret(e.target.value)}
                      placeholder="Paste the GitHub client secret"
                      className="pr-10"
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-600"
                      onClick={() => setShowGhSecret((v) => !v)}
                      title={showGhSecret ? 'Hide secret' : 'Show secret'}
                    >
                      {showGhSecret ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </Field>
              </div>
            )}
          </section>

          {/* ─── Login page OAuth (reuses the credentials above) ─── */}
          <section className="card space-y-4 border-emerald-200 p-6 dark:border-emerald-900">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 text-base font-bold text-slate-900">
                <LogIn size={18} className="text-emerald-600" /> Login page OAuth
              </h2>
              <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700">
                Shares the same credentials
              </span>
            </div>
            <p className="text-xs text-slate-500">
              Shows the OAuth buttons below the email/password form on the login page. Pick which provider buttons to
              show — the Microsoft / GitHub secrets are the ones entered in the Register page OAuth section above,
              nothing is re-entered here.
            </p>

            <Toggle
              checked={loginEnabled}
              onChange={setLoginEnabled}
              label="Enable OAuth buttons on the login page"
            />

            {loginEnabled && (
              <div className="grid gap-3 sm:grid-cols-2">
                <label
                  className={cn(
                    'flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition',
                    loginMicrosoft
                      ? 'border-violet-400 bg-violet-50'
                      : 'border-slate-200 hover:border-slate-300',
                  )}
                >
                  <input
                    type="checkbox"
                    className="mt-0.5 accent-violet-600"
                    checked={loginMicrosoft}
                    onChange={(e) => setLoginMicrosoft(e.target.checked)}
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-bold text-slate-900">Microsoft</span>
                    <span className="block text-xs text-slate-500">Show "Continue with Microsoft" on the login page.</span>
                  </span>
                </label>
                <label
                  className={cn(
                    'flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition',
                    loginGithub
                      ? 'border-slate-800 bg-slate-900'
                      : 'border-slate-200 hover:border-slate-300',
                  )}
                >
                  <input
                    type="checkbox"
                    className="mt-0.5 accent-slate-900"
                    checked={loginGithub}
                    onChange={(e) => setLoginGithub(e.target.checked)}
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-bold text-white">GitHub</span>
                    <span className="block text-xs text-slate-300">Show "Continue with GitHub" on the login page.</span>
                  </span>
                </label>
              </div>
            )}

            {enabled && loginEnabled && loginMicrosoft && !credentialsConfigured && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                Microsoft credentials are not fully entered in the Register page OAuth section yet — the Microsoft button
                won't appear on the login page until they are.
              </p>
            )}
            {enabled && loginEnabled && loginGithub && !(!!ghClientId && !!ghClientSecret) && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                GitHub credentials are not fully entered in the Register page OAuth section yet — the GitHub button won't
                appear on the login page until they are.
              </p>
            )}
            {!enabled && loginEnabled && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                OAuth is disabled in the Register page OAuth section above — no buttons will appear on the login page
                until it is enabled.
              </p>
            )}
          </section>

          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          {saved && <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">OAuth settings saved.</p>}

          <Button type="submit" disabled={busy}>
            {busy ? <Spinner className="border-white/40 border-t-white" /> : <Save size={16} />} Save OAuth settings
          </Button>
        </form>
      )}
    </div>
  )
}