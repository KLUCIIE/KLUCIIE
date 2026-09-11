import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarClock, CheckCircle2, Clock, QrCode as QrIcon, RefreshCw } from 'lucide-react'
import { Badge, PageLoader, SelectInput } from '@/components/ui'
import { useAuth } from '@/hooks/useAuth'
import { useBranding } from '@/hooks/useBranding'
import { useSettings } from '@/hooks/useSettings'
import { qrWithLogoDataUrl } from '@/lib/qr'
import { supabase } from '@/lib/supabase'
import type { Event, RoundWindow } from '@/lib/types'
import { cn, endOfDayMs, formatDate, formatDateTime, isEventEnded as isEventEndedFn, kolkataMs } from '@/lib/utils'

interface RegisteredEvent {
  event_id: string
  status?: string
  event?: Pick<Event, 'id' | 'title' | 'start_date' | 'start_time' | 'end_date' | 'end_time' | 'status'> | null
}

interface RoundInfo {
  round: number
  code?: string
  issued_at?: string
  used: boolean
  status: 'present' | 'absent'
  method?: string
  marked_at?: string
}

interface QrInfo {
  started: boolean
  closed?: boolean
  attendance_rounds?: number
  rounds?: RoundInfo[]
  active_round?: number | null
  round_windows?: RoundWindow[]
  audience?: 'members' | 'faculty'
  event_title?: string
  start_date?: string
  start_time?: string
  end_date?: string
  end_time?: string
  error?: string
}

function eventStartsAt(e: { start_date: string; start_time?: string | null }): Date {
  return new Date(`${e.start_date}T${e.start_time || '00:00'}:00`)
}

export default function MemberQrPage() {
  const { user, profile } = useAuth()
  const branding = useBranding()
  const settings = useSettings()
  // When the admin enables "Stop dynamic QR", codes never rotate — the same
  // QR stays valid until scanned, with no countdown or auto-refresh.
  const staticQr = settings.stop_dynamic_qr
  const logoUrl = branding.qr_attendance_logo_url ?? branding.ciie_logo_url ?? '/logo.png'
  const [rows, setRows] = useState<RegisteredEvent[]>([])
  const [eventId, setEventId] = useState('')
  const [qrInfo, setQrInfo] = useState<QrInfo | null>(null)
  const [qrMap, setQrMap] = useState<Record<number, string>>({})
  const [memberQr, setMemberQr] = useState('')
  const [memberCode, setMemberCode] = useState('')
  const [loading, setLoading] = useState(true)
  const [qrLoading, setQrLoading] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const [activeRound, setActiveRound] = useState<number | null>(null)
  const [nowTick, setNowTick] = useState(0)
  const [nowMs, setNowMs] = useState(() => Date.now())

  // Attendance QR codes rotate server-side every ~60 seconds so a
  // screenshotted QR expires quickly after it was captured.
  const QR_ROTATE_MS = 60000

  const copyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(code)
      window.setTimeout(() => setCopied((c) => (c === code ? null : c)), 2000)
    } catch {
      // clipboard unavailable
    }
  }

  useEffect(() => {
    if (!user) return
    let active = true
    const load = async () => {
      // A registration made before sign-in may not have member_id yet. The
      // server links only rows matching this authenticated user's email.
      await supabase.rpc('link_my_event_registrations')
      const [{ data }, { data: memberData }] = await Promise.all([
        supabase
          .from('event_registrations')
          .select('event_id, status, event:events(id, title, start_date, start_time, end_date, end_time, status)')
          .eq('member_id', user.id)
          .neq('status', 'cancelled'),
        supabase.from('member_qr_codes').select('code').eq('member_id', user.id).maybeSingle(),
      ])
      if (!active) return
      const regs = (data ?? []) as unknown as RegisteredEvent[]
      setRows(regs)
      const c = (memberData as { code?: string } | null)?.code
      if (c) {
        setMemberCode(c)
        setMemberQr(await qrWithLogoDataUrl(c, logoUrl, 400))
      }
      setLoading(false)
    }
    load()
    return () => {
      active = false
    }
  }, [user])

  const startedEvents = useMemo(
    () => rows.filter((r) => r.event && new Date(eventStartsAt(r.event)) <= new Date()),
    [rows],
  )

  const selectedEvent = useMemo(() => rows.find((r) => r.event_id === eventId)?.event ?? null, [rows, eventId])

  const refreshQr = useCallback(
    async (id: string, silent = false) => {
      if (!id) return
      if (!silent) setQrLoading(true)
      const { data, error } = await supabase.rpc('get_my_event_attendance_qr', { p_event_id: id })
      if (!silent) setQrLoading(false)
      if (error) {
        setQrInfo({ started: false, attendance_rounds: 1, rounds: [], error: error.message })
        return
      }
      const info = (data ?? {}) as QrInfo
      setQrInfo(info)
      if (info.started && user) {
        const map: Record<number, string> = {}
        for (const r of info.rounds ?? []) {
          if (r.code) {
            map[r.round] = await qrWithLogoDataUrl(r.code, logoUrl, 240)
          }
        }
        setQrMap(map)
      } else {
        setQrMap({})
      }
    },
    [user, logoUrl],
  )

  useEffect(() => {
    if (!eventId || !settings.use_attendance_realtime) return
    const channel = supabase
      .channel(`member-qr-live-${eventId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'attendance', filter: `event_id=eq.${eventId}` },
        () => void refreshQr(eventId, true),
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [eventId, refreshQr, settings.use_attendance_realtime])

  // Rotating QR engine: while the event is live, re-poll every few seconds so
  // the server rotates the code and the screen always shows the current one.
  const started = !!qrInfo?.started

  // 1s tick used for the "refreshes in Ns" countdown next to the QR.
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  const selectedRoundNum = activeRound ?? qrInfo?.active_round ?? null
  const shownRound = useMemo(
    () => (qrInfo?.rounds ?? []).find((x) => x.round === selectedRoundNum) ?? null,
    [qrInfo, selectedRoundNum],
  )
  const shownCode = shownRound?.code ?? null

  // The "refreshes in Ns" timer starts when the QR is opened (the code first
  // appears on screen) and restarts whenever the server rotates in a new code —
  // not from when the server issued the code.
  const [qrShownAt, setQrShownAt] = useState<number | null>(null)
  useEffect(() => {
    if (shownCode) setQrShownAt(Date.now())
  }, [shownCode])

  const refreshIn = staticQr ? 0 : qrShownAt ? Math.max(0, Math.ceil((qrShownAt + QR_ROTATE_MS - nowMs) / 1000)) : 0

  // Auto-transition at the event's start and end times: the QR appears the
  // moment the event starts and closes once it ends — no manual refresh. The
  // end time is also read from the event row so this works even if the server
  // RPC hasn't been updated to report the closed state yet.
  useEffect(() => {
    if (!eventId) return
    const transitions: number[] = []
    const startDate = qrInfo?.start_date ?? selectedEvent?.start_date
    const startTime = qrInfo?.start_time ?? selectedEvent?.start_time ?? null
    const endDate = qrInfo?.end_date ?? selectedEvent?.end_date
    const endTime = qrInfo?.end_time ?? selectedEvent?.end_time ?? null
    if (startDate) transitions.push(kolkataMs(startDate, startTime))
    if (endDate) transitions.push(endTime ? kolkataMs(endDate, endTime) : endOfDayMs(endDate))
    // Round windows (faculty events): auto-refresh when a window opens/closes.
    for (const w of qrInfo?.round_windows ?? []) {
      const s = new Date(w.starts_at).getTime()
      const e = new Date(w.ends_at).getTime()
      if (Number.isFinite(s)) transitions.push(s)
      if (Number.isFinite(e)) transitions.push(e)
    }
    const now = Date.now()
    const next = transitions.filter((t) => t > now).sort((a, b) => a - b)[0]
    if (next == null) return
    const id = window.setTimeout(() => {
      setNowTick((n) => n + 1)
      void refreshQr(eventId, true)
    }, next - now + 500)
    return () => window.clearTimeout(id)
  }, [eventId, qrInfo, selectedEvent, refreshQr])

  // Client-side "event ended" check — an immediate fallback that doesn't
  // depend on the server RPC reporting the closed state.
  const eventEnded = useMemo(() => isEventEndedFn(selectedEvent), [selectedEvent, nowTick])

  const qrClosed = !!qrInfo?.closed || eventEnded
  const endDate = qrInfo?.end_date ?? selectedEvent?.end_date ?? null
  const endTime = qrInfo?.end_time ?? selectedEvent?.end_time ?? null

  // Round-window waiting state: the event is running but no round's window is
  // open right now (faculty events with admin-configured round times).
  const windows = useMemo(() => {
    const list = [...(qrInfo?.round_windows ?? [])].sort((a, b) => a.round - b.round)
    return list.map((w) => {
      const s = new Date(w.starts_at).getTime()
      const e = new Date(w.ends_at).getTime()
      const now = nowMs
      return { ...w, s, e, past: now >= e, active: now >= s && now < e }
    })
  }, [qrInfo, nowMs])
  const anyWindowActive = windows.some((w) => w.active)
  const waitingForRound =
    !!qrInfo?.started && !qrClosed && windows.length > 0 && !anyWindowActive

  useEffect(() => {
    if (!eventId || !started || qrClosed || staticQr) return
    const id = window.setInterval(() => void refreshQr(eventId, true), 5000)
    return () => window.clearInterval(id)
  }, [eventId, started, qrClosed, staticQr, refreshQr])

  const onSelectEvent = (id: string) => {
    setEventId(id)
    setQrMap({})
    setQrInfo(null)
    setActiveRound(null)
    void refreshQr(id)
  }

  if (loading) return <PageLoader />

  if (!profile) {
    return (
      <div className="card p-8 text-center">
        <h1 className="text-lg font-bold text-slate-900">Profile not found</h1>
        <p className="mt-1 text-sm text-slate-500">
          Your account isn't linked to a member profile yet. Please contact the CIIE administrator.
        </p>
      </div>
    )
  }

  return (
    <div className="max-w-md">
      <h1 className="text-2xl font-extrabold text-slate-900">QR Attendance</h1>
      <p className="mt-1 text-sm text-slate-500">
        Pick a registered event to get its attendance QR. Show it to a CIIE member on duty to be marked present — the
        code below each QR can also be typed into the scanner.
      </p>

      <div className="card mt-6 p-5">
        <label className="mb-1.5 flex items-center gap-1.5 text-sm font-bold text-slate-900">
          <CalendarClock size={15} className="text-primary-600" /> Select your event
        </label>
        {rows.length === 0 ? (
          <p className="text-sm text-slate-400">You have no event registrations yet.</p>
        ) : (
          <SelectInput
            value={eventId}
            onChange={(e) => onSelectEvent(e.target.value)}
          >
            <option value="">Choose an event…</option>
            {rows.map((r) => (
              <option key={r.event_id} value={r.event_id} disabled={!r.event || r.event.status === 'cancelled'}>
                {r.event?.title ?? 'Event unavailable'}{r.event?.status === 'completed' ? ' — Completed' : r.event?.status === 'cancelled' ? ' — Cancelled' : ''}
              </option>
            ))}
          </SelectInput>
        )}

        {qrLoading && <div className="mt-4"><PageLoader /></div>}

        {!qrLoading && eventId && selectedEvent && qrInfo && (
          <div className="mt-5">
            {qrClosed ? (
              <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
                <p className="font-semibold">Event closed.</p>
                <p className="mt-1 text-xs text-red-600">
                  Attendance for this event has ended
                  {endDate ? ` — ${formatDate(endDate)}${endTime ? ` · ${endTime}` : ''}` : ''}. No more QR codes are
                  issued and attendance can no longer be marked.
                </p>
                {qrInfo.error && (
                  <p className="mt-2 rounded bg-red-50 px-2 py-1 text-xs font-medium text-red-600">
                    Server error: {qrInfo.error}
                  </p>
                )}
              </div>
            ) : waitingForRound ? (
              <div className="rounded-xl bg-sky-50 px-4 py-3 text-sm text-sky-800">
                <p className="font-semibold">No attendance round is open right now.</p>
                <p className="mt-1 text-xs text-sky-700">
                  Your QR unlocks automatically during each round's window — this page updates by itself.
                </p>
                <ul className="mt-3 space-y-1.5">
                  {windows.map((w) => (
                    <li
                      key={w.round}
                      className={cn(
                        'flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-medium',
                        w.active ? 'bg-green-100 text-green-800' : w.past ? 'bg-white/60 text-slate-400' : 'bg-white/80 text-slate-600',
                      )}
                    >
                      <Clock size={13} className={w.active ? 'text-green-600' : 'text-slate-400'} />
                      <span className="font-bold">Round {w.round}</span>
                      <span>
                        {formatDateTime(w.starts_at)} → {formatDateTime(w.ends_at)}
                      </span>
                      {w.active && <Badge tone="green">Open now</Badge>}
                      {w.past && <span className="ml-auto text-[10px] uppercase tracking-wide">Closed</span>}
                    </li>
                  ))}
                </ul>
              </div>
            ) : qrInfo.started ? (
              <div>
                <div className="mb-3 text-center text-sm font-bold text-slate-700">
                  {(qrInfo.attendance_rounds ?? 1) > 1
                    ? `${qrInfo.attendance_rounds} attendance rounds — pick a round to see its QR`
                    : '1 attendance round'}
                </div>

                <div className="mb-4 flex flex-wrap items-center justify-center gap-2">
                  {(qrInfo.rounds ?? []).map((r) => {
                    const isActive = selectedRoundNum === r.round
                    return (
                      <button
                        key={r.round}
                        type="button"
                        onClick={() => setActiveRound(r.round)}
                        className={cn(
                          'relative flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold transition',
                          isActive
                            ? 'bg-primary-600 text-white shadow-md'
                            : r.status === 'present'
                              ? 'bg-green-100 text-green-700 hover:bg-green-200'
                              : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
                        )}
                        title={`Round ${r.round}`}
                      >
                        {r.round}
                        {r.status === 'present' && (
                          <CheckCircle2
                            size={14}
                            className={cn('absolute -right-1 -top-1 rounded-full bg-white', isActive ? 'text-green-400' : 'text-green-600')}
                          />
                        )}
                      </button>
                    )
                  })}
                </div>

                {(qrInfo.rounds ?? []).length > 0 &&
                  (() => {
                    const r = shownRound
                    const dataUrl = r ? qrMap[r.round] : undefined
                    const code = r?.code
                    if (!r) return null
                    return (
                      <div className="mx-auto max-w-xs rounded-2xl border-2 border-slate-200 bg-white p-4 text-center">
                        <div className="relative mx-auto w-fit">
                          {dataUrl ? (
                            <div className="relative">
                              <img src={dataUrl} alt={`Round ${r.round} attendance QR`} className="mx-auto h-48 w-48" />
                              {r.status === 'present' && (
                                <div className="absolute inset-0 flex items-center justify-center">
                                  <span className="flex h-14 w-14 items-center justify-center rounded-full bg-green-500 text-white shadow-lg ring-4 ring-white">
                                    <CheckCircle2 size={30} />
                                  </span>
                                </div>
                              )}
                            </div>
                          ) : (
                            <PageLoader />
                          )}
                        </div>
                        <p className="mt-3 text-xs font-bold text-slate-700">Round {r.round}</p>
                        {r.status === 'present' ? (
                          <Badge tone="green">{r.marked_at ? `Present · ${formatDateTime(r.marked_at)}` : 'Present'}</Badge>
                        ) : (
                          <>
                            <Badge tone="slate">Not scanned yet</Badge>
                            {refreshIn > 0 && (
                              <p className="mt-1.5 flex items-center justify-center gap-1.5 text-[11px] font-semibold text-amber-600">
                                <RefreshCw size={12} /> Refreshes in {refreshIn}s
                              </p>
                            )}
                          </>
                        )}
                        {code && (
                          <button
                            type="button"
                            onClick={() => copyCode(code)}
                            className="mt-2 w-full break-all rounded-lg bg-slate-100 px-2 py-1.5 font-mono text-[10px] font-bold tracking-wider text-slate-600 transition hover:bg-slate-200"
                            title="Copy attendance code"
                          >
                            {copied === code ? 'Copied!' : code}
                          </button>
                        )}
                      </div>
                    )
                  })()}

                <p className="mt-3 flex items-center justify-center gap-1.5 rounded-xl bg-slate-100 px-4 py-3 text-xs text-slate-500">
                  <QrIcon size={15} />{' '}
                  {staticQr
                    ? 'This QR is static — it does not change. The moment you\'re marked present, the tick appears instantly.'
                    : 'The QR rotates automatically every ~60 seconds — show the current one, and never share a screenshot. The moment you\'re marked present, the tick appears instantly.'}
                </p>
                <button className="btn-secondary mt-3 w-full" onClick={() => refreshQr(eventId)}>
                  <RefreshCw size={14} /> Refresh QRs
                </button>
              </div>
            ) : (
              <div className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
                <p className="font-semibold">This event hasn't started yet.</p>
                <p className="mt-1 text-xs text-amber-700">
                  {formatDate(selectedEvent.start_date)} at {selectedEvent.start_time || '00:00'} — the QR will appear
                  here once the event begins.
                </p>
                {qrInfo.error && (
                  <p className="mt-2 rounded bg-red-50 px-2 py-1 text-xs font-medium text-red-600">
                    Server error: {qrInfo.error}
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {profile.role !== 'user' && profile.role !== 'member_ciie' && (
        <>
          <h2 className="mt-8 flex items-center gap-2 text-base font-bold text-slate-900">
            <QrIcon size={16} className="text-primary-600" /> My member QR
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Your personal CIIE identity QR — use it at any event even if you didn't pre-register.
          </p>

          <div className="card mt-3 overflow-hidden text-center">
            <div className="border-b border-slate-200 bg-gradient-to-r from-primary-600 to-primary-800 px-6 py-4 text-white">
              <p className="text-xs font-semibold uppercase tracking-[0.2em]">CIIE Member</p>
              <p className="text-lg font-extrabold">{profile.full_name}</p>
              <p className="text-xs text-primary-100">{profile.ciie_id}</p>
            </div>
            <div className="p-6">
              {memberQr ? <img src={memberQr} alt="Member QR" className="mx-auto h-56 w-56" /> : <PageLoader />}
              <p className="mt-4 font-mono text-xs text-slate-400">{memberCode}</p>
            </div>
          </div>

          <div className="mt-5 flex items-start gap-2 rounded-xl bg-slate-100 px-4 py-3 text-xs text-slate-500">
            <QrIcon size={16} className="mt-0.5 shrink-0" />
            <span>
              Keep these QRs private — they are tied to your CIIE identity.
            </span>
          </div>
        </>
      )}

      {startedEvents.length === 0 && rows.length > 0 && (
        <div className="mt-4">
          <Badge tone="slate">No events running right now</Badge>
        </div>
      )}
    </div>
  )
}
