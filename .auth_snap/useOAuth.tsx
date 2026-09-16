import { useCallback, useEffect, useState } from 'react'
import type { OAuthConfig } from '@/lib/types'
import { apiOrigin } from '@/lib/supabase'

const DEFAULT: OAuthConfig = { enabled: false, mode: 'register', configured: false }

/** Public Microsoft OAuth config (enabled + mode only — never the secrets). */
export function useOAuth(): OAuthConfig {
  const [cfg, setCfg] = useState<OAuthConfig>(DEFAULT)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${apiOrigin}/api/oauth/config`)
      if (res.ok) {
        const data = (await res.json()) as Partial<OAuthConfig>
        setCfg({ ...DEFAULT, ...data })
      }
    } catch {
      // keep defaults
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return cfg
}