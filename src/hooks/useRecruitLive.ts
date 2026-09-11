import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { RecruitApplicationRow } from '@/lib/types'

const POLL_MS = 20000

/**
 * Recruitment pipeline rows for the GD / Interview / Final Selection pages.
 * The local supabase shim has no realtime push, so we poll get_recruit_applications
 * every POLL_MS and also expose refresh() for immediate refetch after actions.
 */
export function useRecruitLive() {
  const [rows, setRows] = useState<RecruitApplicationRow[] | null>(null)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    const { data, error: err } = await supabase.rpc('get_recruit_applications')
    if (err) {
      setError(err.message)
      return
    }
    setRows((data as RecruitApplicationRow[] | null) ?? [])
  }, [])

  useEffect(() => {
    void refresh()
    const id = window.setInterval(() => void refresh(), POLL_MS)
    window.addEventListener('focus', refresh)
    return () => {
      window.clearInterval(id)
      window.removeEventListener('focus', refresh)
    }
  }, [refresh])

  return { rows, error, refresh }
}
