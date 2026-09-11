import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import {
  Building2,
  CalendarDays,
  CheckCircle2,
  CircleSlash,
  Clock,
  Image as ImageIcon,
  MapPin,
  Megaphone,
  Ticket,
  Users,
  Video,
} from 'lucide-react'
import { Avatar, Badge, Modal, PageLoader } from '@/components/ui'
import { useAuth } from '@/hooks/useAuth'
import { downloadIcs, googleCalendarUrl } from '@/lib/calendar'
import { fetchEvent, fetchEventCounts } from '@/lib/queries'
import { supabase } from '@/lib/supabase'
import type { Announcement, Event, EventRegistration, EventRole, GalleryItem } from '@/lib/types'
import { formatDate, seatsRemaining } from '@/lib/utils'

interface TeamRow {
  id: string
  event_id: string
  member_id: string
  role_id: string
  is_public: boolean
  contact_visible: boolean
  notes: string | null
  created_by: string | null
  created_at?: string
  member: { id: string; full_name: string; avatar_url: string | null } | null
  role: EventRole | null
}

export default function EventDetail() {
  const { id } = useParams<{ id: string }>()
  const { user, profile } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [event, setEvent] = useState<Event | null>(null)
  const [team, setTeam] = useState<TeamRow[]>([])
  const [gallery, setGallery] = useState<GalleryItem[]>([])
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [registered, setRegistered] = useState(false)
  const [myRegId, setMyRegId] = useState<string | null>(null)
  const [registrations, setRegistrations] = useState(0)
  const [loading, setLoading] = useState(true)
  const [closedDismissed, setClosedDismissed] = useState(false)

  useEffect(() => {
    let active = true
    if (!id) return
    const load = async () => {
      const ev = await fetchEvent(id)
      if (!ev) {
        setLoading(false)
        return
      }
      const [{ data: teamData }, { data: galleryData }, { data: annData }] = await Promise.all([
        supabase
          .from('event_team_members')
          .select('*, member:profiles(full_name, avatar_url), role:event_roles(*)')
          .eq('event_id', ev.id)
          .eq('is_public', true)
          .order('created_at'),
        supabase.from('gallery_items').select('*').eq('event_id', ev.id).order('created_at', { ascending: false }),
        supabase
          .from('announcements')
          .select('*')
          .or(`event_id.eq.${ev.id},event_id.is.null`)
          .eq('audience', 'all')
          .order('pinned', { ascending: false })
          .order('created_at', { ascending: false }),
      ])
      const countMap = await fetchEventCounts()

      let isReg = false
      let regId: string | null = null
      if (user) {
        const { data: myRegs } = await supabase
          .from('event_registrations')
          .select('id')
          .eq('event_id', ev.id)
          .eq('member_id', user.id)
          .neq('status', 'cancelled')
          .maybeSingle()
        isReg = !!myRegs
        regId = myRegs?.id ?? null
      }

      if (active) {
        setEvent(ev)
        setTeam((teamData ?? []) as TeamRow[])
        setGallery((galleryData ?? []) as GalleryItem[])
        setAnnouncements((annData ?? []).filter((a) => !a.expires_at || new Date(a.expires_at) > new Date()))
        setRegistrations(countMap[ev.id] ?? 0)
        setRegistered(isReg)
        setMyRegId(regId)
        setLoading(false)
      }
    }
    load()
    return () => {
      active = false
    }
  }, [id, user])

  if (loading) return <PageLoader />
  if (!event) {
    return (
      <div className="container-page py-20 text-center">
        <p className="text-lg font-semibold text-slate-700 dark:text-slate-300">Event not found</p>
        <Link to="/events" className="btn-primary mt-4">
          Browse events
        </Link>
      </div>
    )
  }

  const seatsLeft = seatsRemaining({ seats: event.seats, registrations })
  const canRegister =
    event.status === 'published' &&
    event.registration_enabled &&
    seatsLeft > 0 &&
    (!event.registration_deadline || new Date(event.registration_deadline) > new Date())

  const registrationClosed =
    !!event.registration_deadline && new Date(event.registration_deadline).getTime() <= Date.now()

  // group team by role name
  const grouped = new Map<string, TeamRow[]>()
  for (const t of team) {
    const roleName = t.role?.name ?? 'Team'
    grouped.set(roleName, [...(grouped.get(roleName) ?? []), t])
  }

  const success = (location.state as {
    registrationSuccess?: { registrationId: string; registration?: EventRegistration }
  } | null)?.registrationSuccess
  const closeSuccess = () => navigate(location.pathname, { replace: true, state: null })

  return (
    <div>
      <div className="relative aspect-[1774/887] w-full bg-gradient-to-br from-primary-600 to-primary-900">
        {event.banner_url ? (
          <img src={event.banner_url} alt={event.title} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-white/70">
            <Building2 size={48} />
          </div>
        )}
      </div>

      <div className="container-page pb-14 pt-6">
        <div className="card overflow-hidden">
          <div className="p-6 sm:p-8">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="primary">{event.category}</Badge>
                  {event.status === 'completed' && <Badge tone="slate">Completed</Badge>}
                  {event.mode === 'online' && (
                    <Badge tone="slate">
                      <Video size={11} /> Online
                    </Badge>
                  )}
                  {event.mode === 'hybrid' && <Badge tone="slate">Hybrid</Badge>}
                </div>
                <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-900 dark:text-slate-100">{event.title}</h1>
              </div>
              <div className="shrink-0">
                {registered ? (
                  <Link to={myRegId ? `/register/success/${myRegId}` : '#'} className="btn-primary">
                    <Ticket size={16} /> View my ticket
                  </Link>
                ) : canRegister ? (
                  <Link to={`/events/${event.slug ?? event.id}/register`} className="btn-primary">
                    <Ticket size={16} /> Register Now
                  </Link>
                ) : (
                  <button className="btn-secondary" disabled>
                    {event.status === 'completed' ? 'Event completed' : seatsLeft <= 0 ? 'Seats full' : 'Registration closed'}
                  </button>
                )}
              </div>
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Info label="Date" value={`${formatDate(event.start_date)}${event.end_date ? ` — ${formatDate(event.end_date)}` : ''}`}>
                <CalendarDays size={16} />
              </Info>
              <Info label="Time" value={`${event.start_time ?? 'TBA'}${event.end_time ? ` — ${event.end_time}` : ''}`}>
                <Clock size={16} />
              </Info>
              <Info label="Venue" value={event.venue ?? (event.mode === 'online' ? 'Online' : 'TBA')}>
                <MapPin size={16} />
              </Info>
              <Info label="Mode" value={event.mode === 'offline' ? 'Offline' : event.mode === 'online' ? 'Online' : 'Hybrid'}>
                <Video size={16} />
              </Info>
              <Info
                label="Registration deadline"
                value={event.registration_deadline ? formatDate(event.registration_deadline) : 'None'}
              >
                <Clock size={16} />
              </Info>
              <Info label="Seats available" value={`${seatsLeft} / ${event.seats}`}>
                <Users size={16} />
              </Info>
            </div>

            {event.description && (
              <div className="mt-6">
                <h2 className="mb-2 text-lg font-bold text-slate-900 dark:text-slate-100">About</h2>
                <p className="whitespace-pre-line text-sm leading-relaxed text-slate-600 dark:text-slate-400">{event.description}</p>
              </div>
            )}
            {event.coordinator_note && (
              <p className="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">📣 {event.coordinator_note}</p>
            )}
          </div>
        </div>

        {/* EVENT TEAM (public) */}
        {event.show_team_public && grouped.size > 0 && (
          <section className="mt-8">
            <h2 className="mb-4 text-xl font-extrabold text-slate-900 dark:text-slate-100">Event Team</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from(grouped.entries()).map(([roleName, rows]) => (
                <div key={roleName} className="card p-5">
                  <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-primary-700">{roleName}</h3>
                  <ul className="space-y-2">
                    {rows.map((t) => (
                      <li key={t.id} className="flex items-center gap-2">
                        <Avatar name={t.member?.full_name} src={t.member?.avatar_url} className="h-8 w-8 text-xs" />
                        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                          <Link to={`/members/${t.member_id}`} className="hover:text-primary-600">
                            {t.member?.full_name}
                          </Link>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ANNOUNCEMENTS */}
        {announcements.length > 0 && (
          <section className="mt-8">
            <h2 className="mb-4 flex items-center gap-2 text-xl font-extrabold text-slate-900 dark:text-slate-100">
              <Megaphone size={20} /> Announcements
            </h2>
            <div className="space-y-3">
              {announcements.map((a) => (
                <div key={a.id} className="card p-4">
                  <p className="font-semibold text-slate-900 dark:text-slate-100">{a.title}</p>
                  {a.body && <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{a.body}</p>}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* GALLERY */}
        {gallery.length > 0 && (
          <section className="mt-8">
            <h2 className="mb-4 flex items-center gap-2 text-xl font-extrabold text-slate-900 dark:text-slate-100">
              <ImageIcon size={20} /> Gallery
            </h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {gallery.map((g) => (
                <a key={g.id} href={g.media_url} target="_blank" rel="noreferrer" className="group overflow-hidden rounded-xl">
                  <img
                    src={g.media_url}
                    alt={g.title ?? 'Event photo'}
                    className="h-32 w-full object-cover transition group-hover:scale-105 sm:h-40"
                  />
                </a>
              ))}
            </div>
          </section>
        )}

        {/* REGISTRATION STATUS for logged-in users */}
        {user && (
          <div className="mt-8 flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
            <CheckCircle2 size={18} />
            {registered
              ? 'You are registered for this event.'
              : `Signed in as ${profile?.full_name ?? user.email}. Register to confirm your seat.`}
          </div>
        )}
      </div>

      {/* REGISTRATION SUCCESS POPUP */}
      {success && (
        <Modal open onClose={closeSuccess} title="Successfully registered!">
          <div className="text-center">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-green-100 text-green-600">
              <CheckCircle2 size={32} />
            </span>
            <p className="mt-4 text-sm text-slate-600 dark:text-slate-400">
              You're registered for <strong>{event.title}</strong>. Show your ticket QR at the venue to confirm your
              attendance.
            </p>
          </div>
          <div className="mt-6 grid gap-2 sm:grid-cols-2">
            <Link
              to={`/register/success/${success.registrationId}`}
              state={{ registration: success.registration }}
              className="btn-primary"
            >
              <Ticket size={16} /> Open Ticket
            </Link>
            <Link to="/upcoming-events" className="btn-secondary">
              Explore More Events
            </Link>
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              className="btn-secondary"
              onClick={() =>
                window.open(
                  googleCalendarUrl({
                    title: event.title,
                    startDate: event.start_date,
                    startTime: event.start_time,
                    endDate: event.end_date,
                    endTime: event.end_time,
                    venue: event.venue,
                    description: event.description,
                  }),
                  '_blank',
                  'noopener,noreferrer',
                )
              }
            >
              <CalendarDays size={15} /> Add to Calendar
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() =>
                downloadIcs(
                  {
                    title: event.title,
                    startDate: event.start_date,
                    startTime: event.start_time,
                    endDate: event.end_date,
                    endTime: event.end_time,
                    venue: event.venue,
                    description: event.description,
                  },
                  `${event.title.replace(/[^\w\s]/g, '').trim() || 'event'}-calendar.ics`,
                )
              }
            >
              <CalendarDays size={15} /> iCal (.ics)
            </button>
          </div>
        </Modal>
      )}

      {/* REGISTRATION CLOSED POPUP */}
      {registrationClosed && !registered && !closedDismissed && (
        <Modal open onClose={() => setClosedDismissed(true)} title="Registrations are closed">
          <div className="flex items-start gap-4">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-amber-100 text-amber-600">
              <CircleSlash size={22} />
            </span>
            <div>
              <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">Registration deadline has passed</p>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Registrations for <strong>{event.title}</strong> are closed — the registration deadline has passed.
              </p>
              <div className="mt-5 flex flex-wrap justify-end gap-2">
                <Link to="/events" className="btn-primary">
                  Browse events
                </Link>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

function Info({ label, value, children }: { label: string; value: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-lg bg-slate-50 dark:bg-slate-800 px-4 py-3">
      <span className="text-slate-400 dark:text-slate-500">{children}</span>
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">{label}</p>
        <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">{value}</p>
      </div>
    </div>
  )
}
