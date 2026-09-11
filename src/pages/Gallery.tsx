import { useEffect, useMemo, useState } from 'react'
import { Camera, ChevronLeft, ChevronRight, Expand, Film, Image as ImageIcon, Play, X } from 'lucide-react'
import Reveal from '@/components/Reveal'
import { PageLoader } from '@/components/ui'
import { supabase } from '@/lib/supabase'
import type { GalleryItem } from '@/lib/types'
import { cn, formatDate, getEmbedInfo } from '@/lib/utils'

type Filter = 'all' | 'image' | 'video'

const filters: { key: Filter; label: string; icon: typeof ImageIcon }[] = [
  { key: 'all', label: 'All', icon: Camera },
  { key: 'image', label: 'Photos', icon: ImageIcon },
  { key: 'video', label: 'Videos', icon: Film },
]

export default function Gallery() {
  const [items, setItems] = useState<GalleryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<Filter>('all')
  const [activeIndex, setActiveIndex] = useState<number | null>(null)

  useEffect(() => {
    let active = true
    const load = async () => {
      const { data } = await supabase
        .from('gallery_items')
        .select('*')
        .order('created_at', { ascending: false })
      if (active) {
        setItems((data ?? []) as GalleryItem[])
        setLoading(false)
      }
    }
    load()
    return () => {
      active = false
    }
  }, [])

  const filtered = useMemo(
    () => items.filter((i) => filter === 'all' || i.media_type === filter),
    [items, filter],
  )

  const photoCount = items.filter((i) => i.media_type === 'image').length
  const videoCount = items.length - photoCount
  const active = activeIndex !== null ? filtered[activeIndex] ?? null : null
  const index = activeIndex

  useEffect(() => {
    if (activeIndex === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setActiveIndex(null)
      if (e.key === 'ArrowRight') setActiveIndex((i) => (i === null ? null : (i + 1) % filtered.length))
      if (e.key === 'ArrowLeft') setActiveIndex((i) => (i === null ? null : (i - 1 + filtered.length) % filtered.length))
    }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [activeIndex, filtered.length])

  return (
    <div className="overflow-x-clip">
      {/* HERO */}
      <section className="relative overflow-hidden bg-slate-950 text-white">
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="animate-orb-1 absolute -left-24 -top-32 h-[28rem] w-[28rem] rounded-full bg-primary-600/40 blur-[130px]" />
          <div className="animate-orb-2 absolute -right-24 bottom-[-8rem] h-[28rem] w-[28rem] rounded-full bg-emerald-500/30 blur-[130px]" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_35%,rgba(2,6,23,0.5))]" />
          <div className="absolute inset-0 opacity-[0.12] [background-image:linear-gradient(to_right,rgba(255,255,255,0.6)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.6)_1px,transparent_1px)] [background-size:72px_72px]" />
        </div>

        <div className="container-page relative z-10 py-20 text-center lg:py-28">
          <Reveal>
            <span className="glass inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-widest text-white">
              <Camera size={14} className="text-primary-300" /> CIIE Moments
            </span>
          </Reveal>
          <Reveal delay={120}>
            <h1 className="mt-6 font-display text-4xl font-black leading-tight tracking-tight sm:text-6xl">
              A gallery of{' '}
              <span className="text-gradient-animated">ideas in motion</span>
            </h1>
          </Reveal>
          <Reveal delay={240}>
            <p className="mx-auto mt-5 max-w-2xl text-slate-300">
              Photos and videos from CIIE events — hackathons, workshops, summits and the community behind them.
            </p>
          </Reveal>
          <Reveal delay={360}>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              {[
                { value: items.length, label: 'Media items' },
                { value: photoCount, label: 'Photos' },
                { value: videoCount, label: 'Videos' },
              ].map((s, i) => (
                <div
                  key={s.label}
                  className={cn('glass rounded-2xl px-6 py-4', i > 0 && 'hidden sm:block')}
                >
                  <p className="font-display text-2xl font-black text-white">{s.value}</p>
                    <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">
                    {s.label}
                  </p>
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* GRID */}
      <section className="container-page py-14">
        <Reveal>
          <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
            <div>
              <span className="inline-flex items-center gap-2 rounded-full bg-primary-100 px-3 py-1 text-xs font-bold uppercase tracking-widest text-primary-700">
                <Camera size={13} /> Highlights
              </span>
              <h2 className="mt-3 font-display text-3xl font-black tracking-tight text-slate-900 dark:text-slate-100 sm:text-4xl">
                Event <span className="text-gradient">Gallery</span>
              </h2>
            </div>
            <div className="flex gap-2">
              {filters.map((f) => (
                <button
                  key={f.key}
                  onClick={() => setFilter(f.key)}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-semibold transition',
                    filter === f.key
                      ? 'border-transparent bg-primary-600 text-white shadow-lg shadow-primary-600/30'
                      : 'border-slate-300 bg-white text-slate-600 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-400 hover:border-primary-300 hover:text-primary-700',
                  )}
                >
                  <f.icon size={14} /> {f.label}
                </button>
              ))}
            </div>
          </div>
        </Reveal>

        {loading ? (
          <PageLoader />
        ) : filtered.length === 0 ? (
          <Reveal>
            <div className="flex flex-col items-center rounded-2xl border border-dashed border-slate-300 bg-white dark:border-slate-600 dark:bg-slate-900 px-6 py-16 text-center">
              <Camera size={40} className="mb-3 text-slate-300" />
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">No media yet</p>
              <p className="mt-1 max-w-sm text-sm text-slate-500 dark:text-slate-400">
                Check back soon — CIIE photos and videos will appear here as events happen.
              </p>
            </div>
          </Reveal>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((item, i) => {
              const embed = getEmbedInfo(item.media_url)
              return (
                <Reveal key={item.id} delay={(i % 6) * 70} variant="zoom" className="aspect-square">
                  <button
                    onClick={() => setActiveIndex(i)}
                    className="group relative block h-full w-full overflow-hidden rounded-2xl bg-slate-900 text-left shadow-sm transition hover:-translate-y-1 hover:shadow-xl"
                  >
                    {item.media_type === 'image' ? (
                      <img
                        src={item.media_url}
                        alt={item.title ?? 'CIIE gallery photo'}
                        loading="lazy"
                        className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
                      />
                    ) : embed && embed.kind !== 'direct' ? (
                      <iframe
                        src={embed.embedSrc}
                        title={item.title ?? 'CIIE gallery video'}
                        className="h-full w-full"
                        loading="lazy"
                        allow="autoplay; fullscreen; picture-in-picture"
                        allowFullScreen
                      />
                    ) : (
                      <video
                        src={item.media_url}
                        muted
                        playsInline
                        preload="metadata"
                        className="h-full w-full object-cover"
                      />
                    )}

                    <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
                      {item.media_type !== 'image' && (
                        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/20 backdrop-blur transition group-hover:scale-110">
                          <Play size={22} className="ml-0.5 text-white" />
                        </span>
                      )}
                    </span>

                    <span className="absolute inset-0 bg-gradient-to-t from-slate-950/70 via-transparent to-transparent opacity-0 transition group-hover:opacity-100" />

                    <span className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-4 opacity-0 transition group-hover:opacity-100">
                      <span className="min-w-0">
                        {item.title && (
                          <span className="block truncate text-sm font-semibold text-white">{item.title}</span>
                        )}
                        {item.photo_date && <span className="block text-xs text-white/70">{formatDate(item.photo_date)}</span>}
                      </span>
                      <Expand size={16} className="shrink-0 text-white/80" />
                    </span>
                  </button>
                </Reveal>
              )
            })}
          </div>
        )}
      </section>

      {/* LIGHTBOX */}
      {index !== null && active && (
        <div
          className="fixed inset-0 z-[60] flex flex-col bg-slate-950/95 backdrop-blur-sm"
          onClick={() => setActiveIndex(null)}
        >
          <div className="flex items-center justify-between p-4">
            <p className="truncate px-2 text-sm font-semibold text-white">
              {active.title ?? 'CIIE gallery'}
              {active.photo_date ? ` · ${formatDate(active.photo_date)}` : ''}
            </p>
            <button
              className="rounded-lg p-2 text-white/70 transition hover:bg-white/10 hover:text-white"
              onClick={() => setActiveIndex(null)}
              aria-label="Close"
            >
              <X size={22} />
            </button>
          </div>

          <div
            className="relative min-h-0 flex-1 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="absolute left-1/2 top-3 z-30 w-max -translate-x-1/2 rounded-full bg-black/55 px-3 py-1 text-xs font-bold tracking-widest text-white backdrop-blur sm:left-6 sm:translate-x-0">
              {index + 1} / {filtered.length}
            </span>

            <div className="absolute inset-0 overflow-auto">
              <div className="flex min-h-full w-full flex-col items-center justify-center gap-4 p-4 sm:p-6">
                {(() => {
                  const embed = getEmbedInfo(active.media_url)
                  if (active.media_type === 'image') {
                    return (
                      <img
                        src={active.media_url}
                        alt={active.title ?? 'CIIE gallery photo'}
                        className="max-h-[calc(100vh-10rem)] max-w-full rounded-xl object-contain shadow-2xl"
                      />
                    )
                  }
                  if (embed && embed.kind !== 'direct') {
                    return (
                      <div className="w-full max-w-4xl">
                        <div className="aspect-video w-full overflow-hidden rounded-xl bg-slate-900 shadow-2xl">
                          <iframe
                            src={embed.embedSrc}
                            title={active.title ?? 'CIIE gallery video'}
                            className="h-full w-full"
                            allow="autoplay; fullscreen; picture-in-picture"
                            allowFullScreen
                          />
                        </div>
                      </div>
                    )
                  }
                  return (
                    <video
                      src={active.media_url}
                      controls
                      autoPlay
                      className="max-h-[calc(100vh-10rem)] max-w-full rounded-xl object-contain shadow-2xl"
                    />
                  )
                })()}
              </div>
            </div>

            {filtered.length > 1 && (
              <>
                <button
                  className="absolute left-2 top-1/2 z-30 -translate-y-1/2 rounded-full bg-white/10 p-3 text-white backdrop-blur transition hover:bg-white/20 sm:left-6"
                  onClick={() => setActiveIndex((index - 1 + filtered.length) % filtered.length)}
                  aria-label="Previous"
                >
                  <ChevronLeft size={22} />
                </button>
                <button
                  className="absolute right-2 top-1/2 z-30 -translate-y-1/2 rounded-full bg-white/10 p-3 text-white backdrop-blur transition hover:bg-white/20 sm:right-6"
                  onClick={() => setActiveIndex((index + 1) % filtered.length)}
                  aria-label="Next"
                >
                  <ChevronRight size={22} />
                </button>
              </>
            )}
          </div>

          <p className="pb-4 text-center text-xs font-medium tracking-widest text-white/50">
            Use arrow keys to navigate
          </p>
        </div>
      )}
    </div>
  )
}
