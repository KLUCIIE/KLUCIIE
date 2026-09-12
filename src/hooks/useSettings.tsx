import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { supabase } from '@/lib/supabase'
import type { PlatformSettings } from '@/lib/types'

const DEFAULT_SETTINGS: PlatformSettings = {
  id: 1,
  allow_public_signup: true,
  signup_domain_restriction: true,
  signup_allowed_domains: ['kluniversity.in'],
  interview_day_1: null,
  interview_day_2: null,
  facebook_url: null,
  instagram_url: null,
  linkedin_url: null,
  twitter_url: null,
  youtube_url: null,
  contact_email: null,
  contact_phone: null,
  office_address: null,
  signup_fields: [],
  register_fields: [],
  signup_email_otp: true,
  allow_password_reset: true,
  stop_dynamic_qr: false,
  use_attendance_realtime: true,
  signup_deadline: null,
  amtps_mode: true,
  amtps_wings: [],
  updated_by: null,
}

type SettingsContextValue = {
  settings: PlatformSettings
  refresh: () => Promise<void>
}

const SettingsContext = createContext<SettingsContextValue>({
  settings: DEFAULT_SETTINGS,
  refresh: async () => {},
})

async function fetchSettings(): Promise<PlatformSettings | null> {
  const { data } = await supabase.from('platform_settings').select('*').eq('id', 1).maybeSingle()
  if (data) return data as PlatformSettings
  // Robust fallback: the singleton row may not exist yet (or may have a
  // different id) — fall back to any single row so settings still load.
  const { data: anyRow } = await supabase.from('platform_settings').select('*').limit(1).maybeSingle()
  return (anyRow as PlatformSettings | null) ?? null
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<PlatformSettings>(DEFAULT_SETTINGS)

  useEffect(() => {
    let active = true
    const load = async () => {
      const data = await fetchSettings()
      if (active && data) setSettings(data)
    }
    load()
    return () => {
      active = false
    }
  }, [])

  const refresh = useCallback(async () => {
    const data = await fetchSettings()
    if (data) setSettings(data)
  }, [])

  const value = useMemo<SettingsContextValue>(() => ({ settings, refresh }), [settings, refresh])

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}

export function useSettings(): PlatformSettings {
  return useContext(SettingsContext).settings
}

/** Re-fetch platform settings and push the fresh row into context (e.g. after saving). */
export function useRefreshSettings(): () => Promise<void> {
  return useContext(SettingsContext).refresh
}

/** Assigned GD/Interview date for a given batch, or null when not set yet. */
export function interviewDateFor(settings: PlatformSettings, batch: 1 | 2 | null | undefined): string | null {
  if (!batch) return null
  return batch === 1 ? settings.interview_day_1 : settings.interview_day_2
}

/** True once the configured signup deadline has passed (registrations closed). */
export function signupDeadlinePassed(settings: PlatformSettings): boolean {
  if (!settings.signup_deadline) return false
  const d = new Date(settings.signup_deadline).getTime()
  return Number.isFinite(d) && d < Date.now()
}
