import { useEffect, useState } from 'react'
import { CalendarDays, ImagePlus, Trash2, Upload } from 'lucide-react'
import { EmptyState, Field, PageHeader, PageLoader, SelectInput, TextInput } from '@/components/ui'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import type { Event, GalleryItem } from '@/lib/types'
import { errorMessage, getEmbedInfo } from '@/lib/utils'

export default function Gallery() {
  const { user } = useAuth()
  const [items, setItems] = useState<GalleryItem[]>([])
  const [events, setEvents] = useState<Event[]>([])
  const [eventId, setEventId] = useState('')
  const [title, setTitle] = useState('')
  const [photoDate, setPhotoDate] = useState('')
  const [uploading, setUploading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const load = async () => {
    const [{ data: itemData }, { data: eventData }] = await Promise.all([
      supabase.from('gallery_items').select('*').order('created_at', { ascending: false }),
      supabase.from('events').select('id, title').order('start_date', { ascending: false }),
    ])
    setItems((itemData ?? []) as GalleryItem[])
    setEvents((eventData ?? []) as Event[])
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  const upload = async (file: File) => {
    if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) {
      setError('Only image and video files are supported.')
      return
    }
    setUploading(true)
    setError('')
    const type = file.type.startsWith('video/') ? 'video' : 'image'
    const path = `gallery/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '-')}`
    const { error: upErr } = await supabase.storage.from('media').upload(path, file, { upsert: true })
    if (upErr) {
      setError(errorMessage(upErr))
      setUploading(false)
      return
    }
    const { data: pub } = supabase.storage.from('media').getPublicUrl(path)
    const { error } = await supabase.from('gallery_items').insert({
      event_id: eventId || null,
      title: title || null,
      photo_date: photoDate || null,
      media_url: pub.publicUrl,
      media_type: type,
      uploaded_by: user?.id ?? null,
    })
    setUploading(false)
    if (error) {
      setError(errorMessage(error))
      return
    }
    setTitle('')
    setPhotoDate('')
    setEventId('')
    load()
  }

  const remove = async (item: GalleryItem) => {
    if (!window.confirm('Delete this media item?')) return
    setBusy(true)
    const { error } = await supabase.from('gallery_items').delete().eq('id', item.id)
    setBusy(false)
    if (error) {
      setError(errorMessage(error))
      return
    }
    load()
  }

  if (loading) return <PageLoader />

  return (
    <div>
      <PageHeader title="Gallery" subtitle="Share event photos and videos on the public gallery." />

      {error && <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="card mb-6 space-y-4 p-5">
        <h2 className="flex items-center gap-2 text-base font-bold text-slate-900">
          <ImagePlus size={16} className="text-primary-600" /> Upload media
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Title (optional)">
            <TextInput value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Inauguration photos" />
          </Field>
          <Field label="Date shown on gallery (optional)" hint="Leave empty to hide the date on the public gallery.">
            <TextInput type="date" value={photoDate} onChange={(e) => setPhotoDate(e.target.value)} />
          </Field>
          <Field label="Linked event (optional)">
            <SelectInput value={eventId} onChange={(e) => setEventId(e.target.value)}>
              <option value="">None</option>
              {events.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.title}
                </option>
              ))}
            </SelectInput>
          </Field>
        </div>
        <label className="btn-secondary cursor-pointer">
          <Upload size={15} /> {uploading ? 'Uploading…' : 'Choose file'}
          <input type="file" accept="image/*,video/*" className="hidden" disabled={uploading} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        </label>
      </div>

      {items.length === 0 ? (
        <EmptyState icon={<ImagePlus size={40} />} title="No media yet" subtitle="Upload photos and videos to showcase CIIE events." />
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
              ) : (
                <video src={item.media_url} className="h-44 w-full bg-slate-900 object-cover" controls />
              )}
              <div className="flex items-center justify-between gap-2 p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-800">{item.title ?? 'Untitled'}</p>
                  <label className="mt-1 flex items-center gap-1.5 text-xs text-slate-400">
                    <CalendarDays size={12} className="shrink-0" />
                    <input
                      type="date"
                      value={item.photo_date ? String(item.photo_date).slice(0, 10) : ''}
                      title="Date shown on the public gallery (optional)"
                      onChange={async (e) => {
                        const val = e.target.value || null
                        await supabase.from('gallery_items').update({ photo_date: val }).eq('id', item.id)
                        load()
                      }}
                      className="rounded border border-slate-200 bg-transparent px-1 text-xs text-slate-500"
                    />
                  </label>
                </div>
                <button
                  className="rounded-lg p-2 text-slate-400 transition hover:bg-red-50 hover:text-red-600"
                  onClick={() => remove(item)}
                  disabled={busy}
                  title="Delete"
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
