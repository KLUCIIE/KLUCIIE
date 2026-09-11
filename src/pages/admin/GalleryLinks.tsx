import { useEffect, useState } from 'react'
import { ExternalLink, Film, Image as ImageIcon, Link2, Play, Plus, Trash2, Youtube } from 'lucide-react'
import { EmptyState, Field, PageHeader, PageLoader, TextInput } from '@/components/ui'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import type { GalleryItem } from '@/lib/types'
import { cn, errorMessage, formatDate, getEmbedInfo, isStorageUpload } from '@/lib/utils'

type LinkType = 'image' | 'youtube' | 'vimeo' | 'direct'

const linkTypes: { key: LinkType; label: string; hint: string; icon: typeof ImageIcon }[] = [
  { key: 'image', label: 'Image URL', hint: 'Direct link to a photo (.png, .jpg, .gif…)', icon: ImageIcon },
  { key: 'youtube', label: 'YouTube', hint: 'Watch or share URL from youtube.com / youtu.be', icon: Youtube },
  { key: 'vimeo', label: 'Vimeo', hint: 'Link to a public Vimeo video', icon: Film },
  { key: 'direct', label: 'Direct video', hint: 'Direct link to an .mp4 / .webm file', icon: Play },
]

export default function GalleryLinks() {
  const { user } = useAuth()
  const [items, setItems] = useState<GalleryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [title, setTitle] = useState('')
  const [linkDate, setLinkDate] = useState('')
  const [url, setUrl] = useState('')
  const [type, setType] = useState<LinkType>('youtube')

  const load = async () => {
    const { data } = await supabase
      .from('gallery_items')
      .select('*')
      .order('created_at', { ascending: false })
    setItems(((data ?? []) as GalleryItem[]).filter((i) => !isStorageUpload(i.media_url)))
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  const validate = (): string | null => {
    const trimmed = url.trim()
    if (!trimmed) return 'Paste a URL to continue.'
    if (type === 'image' && !/^https?:\/\//i.test(trimmed)) return 'Enter a valid http(s) image URL.'
    if (type !== 'image' && !getEmbedInfo(trimmed)) {
      return 'Could not recognize this video link. Use a YouTube, Vimeo or direct video file URL.'
    }
    return null
  }

  const add = async () => {
    const problem = validate()
    if (problem) {
      setError(problem)
      return
    }
    setBusy(true)
    setError('')
    const { error: insertError } = await supabase.from('gallery_items').insert({
      event_id: null,
      title: title.trim() || null,
      photo_date: linkDate || null,
      media_url: url.trim(),
      media_type: type === 'image' ? 'image' : 'video',
      uploaded_by: user?.id ?? null,
    })
    setBusy(false)
    if (insertError) {
      setError(errorMessage(insertError))
      return
    }
    setTitle('')
    setLinkDate('')
    setUrl('')
    load()
  }

  const remove = async (item: GalleryItem) => {
    if (!window.confirm('Remove this media link from the gallery?')) return
    setBusy(true)
    const { error: delError } = await supabase.from('gallery_items').delete().eq('id', item.id)
    setBusy(false)
    if (delError) {
      setError(errorMessage(delError))
      return
    }
    load()
  }

  return (
    <div>
      <PageHeader
        title="Gallery Links"
        subtitle="Paste image URLs and large video links (YouTube, Vimeo, direct files) to feature them on the public gallery."
      />

      {error && <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="card mb-6 space-y-4 p-5">
        <h2 className="flex items-center gap-2 text-base font-bold text-slate-900">
          <Link2 size={16} className="text-primary-600" /> Add a link
        </h2>

        <div className="flex flex-wrap gap-2">
          {linkTypes.map((t) => (
            <button
              key={t.key}
              onClick={() => setType(t.key)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-4 py-1.5 text-sm font-semibold transition',
                type === t.key
                  ? 'border-transparent bg-primary-600 text-white shadow-md shadow-primary-600/25'
                  : 'border-slate-300 bg-white text-slate-600 hover:border-primary-300 hover:text-primary-700',
              )}
            >
              <t.icon size={14} /> {t.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-slate-400">{linkTypes.find((t) => t.key === type)?.hint}</p>

        <div className="grid gap-4 sm:grid-cols-[1fr_1fr_1.5fr_auto]">
          <Field label="Title (optional)">
            <TextInput value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Hackathon highlight" />
          </Field>
          <Field label="Date shown on gallery (optional)" hint="Leave empty to hide the date.">
            <TextInput type="date" value={linkDate} onChange={(e) => setLinkDate(e.target.value)} />
          </Field>
          <Field label="URL">
            <TextInput
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={type === 'image' ? 'https://…/photo.jpg' : 'https://www.youtube.com/watch?v=…'}
            />
          </Field>
          <div className="flex items-end">
            <button className="btn-primary w-full sm:w-auto" onClick={add} disabled={busy}>
              <Plus size={15} /> {busy ? 'Adding…' : 'Add'}
            </button>
          </div>
        </div>

        <p className="flex items-center gap-1.5 text-xs text-slate-400">
          <ExternalLink size={12} /> Link-only items stay here — uploads are managed in the regular Gallery page.
        </p>
      </div>

      {loading ? (
        <PageLoader />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Link2 size={40} />}
          title="No media links yet"
          subtitle="Paste image URLs or YouTube / Vimeo video links to showcase them on the public gallery."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => {
            const embed = getEmbedInfo(item.media_url)
            return (
              <div key={item.id} className="card group overflow-hidden">
                {item.media_type === 'image' ? (
                  <img src={item.media_url} alt={item.title ?? 'Gallery'} className="h-44 w-full object-cover" />
                ) : embed && embed.kind !== 'direct' ? (
                  <iframe
                    src={embed.embedSrc}
                    title={item.title ?? 'Embedded video'}
                    className="h-44 w-full bg-slate-900"
                    loading="lazy"
                    allow="autoplay; fullscreen; picture-in-picture"
                    allowFullScreen
                  />
                ) : embed ? (
                  <video src={embed.embedSrc} className="h-44 w-full bg-slate-900 object-cover" controls />
                ) : (
                  <video src={item.media_url} className="h-44 w-full bg-slate-900 object-cover" controls />
                )}
                <div className="flex items-center justify-between gap-2 p-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-800">{item.title ?? 'Untitled'}</p>
                    <p className="truncate text-xs text-slate-400">
                      {item.photo_date ? `${formatDate(item.photo_date)} · ` : ''}
                      {embed?.kind === 'youtube' ? 'YouTube' : embed?.kind === 'vimeo' ? 'Vimeo' : item.media_type === 'image' ? 'Image link' : 'Video link'}
                    </p>
                  </div>
                  <button
                    className="rounded-lg p-2 text-slate-400 transition hover:bg-red-50 hover:text-red-600"
                    onClick={() => remove(item)}
                    disabled={busy}
                    title="Remove"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
