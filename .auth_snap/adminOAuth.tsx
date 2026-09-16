import { useEffect, useState, type FormEvent } from 'react'
import { useEffect, useState, type FormEvent } from 'react'
import { AlertTriangle, Eye, EyeOff, Github, Info, KeyRound, Save, ShieldCheck } from 'lucide-react'
import { Button, Field, PageHeader, Spinner, TextInput, Toggle } from '@/components/ui'
import { useAuth } from '@/hooks/useAuth'
import { getOAuthAdminSettings, supabase } from '@/lib/supabase'
import type { OAuthMode } from '@/lib/types'
import { cn, errorMessage } from '@/lib/utils'

const MODE_OPTIONS: { value: OAuthMode; label: string; hint: string }[] = [
  {
    value: 'register',
    label: 'Register page only',
    hint: 'Login & registration use the existing email flow (Gmail SMTP OTP). No OAuth providers.',
  },
  {
    value: 'microsoft',
    label: 'Microsoft OAuth only',
    hint: 'Sign-in is only available with a Microsoft work/school account. Password login is hidden.',
  },
  {
    value: 'github',
    label: 'GitHub OAuth only',
    hint: 'Sign-in is only available with a GitHub account. Password login is hidden.',
  },
  {
    value: 'both',
    label: 'All methods',
    hint: 'Show the register page email flow plus "Continue with Microsoft" and "Continue with GitHub" on the login & user registration pages.',
  },
]

export default function OAuthAdmin() {
  const { profile, isSuperAdmin } = useAuth()
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [enabled, setEnabled] = useState(false)
  const [mode, setMode] = useState<OAuthMode>('register')
  const [tenant, setTenant] = useState('')
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [showSecret, setShowSecret] = useState(false)
  const [redirectUri, setRedirectUri] = useState('')
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
          setMode(data.mode ?? 'register')
          setTenant(data.ms_tenant_id ?? '')
          setClientId(data.ms_client_id ?? '')
          setClientSecret(data.ms_client_secret ?? '')
          setRedirectUri(data.redirect_uri ?? '')
        }
        setLoading(false)
      })
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
          mode,
          ms_tenant_id: tenant.trim() || null,
          ms_client_id: clientId.trim() || null,
          ms_client_secret: clientSecret.trim() || null,
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
      p_details: { enabled, mode },
    })
    setSaved(true)
  }

  const microsoftVisible = mode !== 'register'

  return (
    <div>
      <PageHeader title="OAuth & Sign-in" subtitle="Choose how users sign in on the login page and /register/user." />

      {loading ? (
        <div className="flex justify-center py-12">
          <Spinner className="h-7 w-7" />
        </div>
      ) : (
        <form onSubmit={save} className="max-w-3xl space-y-6">
          <section className="card space-y-4 p-6">
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Sign-in method</h2>

            <Toggle
              checked={enabled}
              onChange={setEnabled}
              label="Enable Microsoft sign-in"
            />
            <p className="text-xs text-slate-400 dark:text-slate-500">
              When on, the Microsoft button appears on the login page and user registration page (according to the
              mode below).
            </p>

            <fieldset className="space-y-3 pt-1">
              <legend className="text-sm font-semibold text-slate-700 dark:text-slate-300">Select one from</legend>
              {MODE_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className={cn(
                    'flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition',
                    mode === opt.value
                      ? 'border-primary-400 bg-primary-50 dark:bg-primary-900/20'
                      : 'border-slate-200 hover:border-slate-300 dark:border-slate-700',
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
                    <span className="block text-sm font-bold text-slate-900 dark:text-slate-100">
                      {opt.label}
                    </span>
                    <span className="block text-xs text-slate-500 dark:text-slate-400">{opt.hint}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          </section>

          {microsoftVisible && (
            <section className="card space-y-4 p-6">
              <h2 className="flex items-center gap-2 text-base font-bold text-slate-900 dark:text-slate-100">
                <Fingerprint size={18} /> Microsoft OAuth secrets
              </h2>

              <div className="flex items-start gap-2 rounded-xl bg-primary-50 px-4 py-3 text-sm text-primary-800">
                <Info size={16} className="mt-0.5 shrink-0" />
                <div>
                  <p className="font-semibold">How to set up Azure AD / Microsoft Entra</p>
                  <p className="mt-0.5 text-primary-700/90">
                    Create an app registration in the Azure portal, add this exact Redirect URI as a web
                    platform, grant the <code className="rounded bg-white px-1 py-0.5 font-mono text-xs">User.Read</code>
                    () and <code className="rounded bg-white px-1 py-0.5 font-mono text-xs">User.Read.All</code>{' '}
                    (optional) API permissions, then paste the Application (client) ID, secret and Directory
                    (tenant) ID here. Only sign-ins from email domains allowed in Settings are accepted.
                  </p>
                </div>
              </div>

              {redirectUri && (
                <Field label="Redirect URI" hint="Add this exactly in Azure → Authentication → Redirect URIs.">
                  <code className="block truncate rounded-lg bg-slate-100 px-3 py-2 font-mono text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                    {redirectUri}
                  </code>
                </Field>
              )}

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

              <p className="flex items-center gap-1.5 text-xs text-slate-400">
                <KeyRound size={13} /> Secrets are stored in the database and are only visible to admins. Microsoft
                sign-in only works for email domains listed under Admin → Settings → Allowed email domains.
              </p>
            </section>
          )}

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