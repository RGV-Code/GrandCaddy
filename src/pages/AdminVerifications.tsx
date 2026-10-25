import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'

type Verification = {
  id: string
  user_id: string
  storage_path: string
  status: string
  rejection_reason: string | null
  submitted_at: string
  profile: { full_name: string; email: string } | null
}

export default function AdminVerifications() {
  const [records, setRecords] = useState<Verification[]>([])
  const [authorized, setAuthorized] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reasons, setReasons] = useState<Record<string, string>>({})
  const [preview, setPreview] = useState<string | null>(null)
  const [saving, setSaving] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError) throw authError
    if (!user || user.app_metadata.role !== 'admin') {
      setAuthorized(false)
      setLoading(false)
      return
    }
    setAuthorized(true)
    const { data, error: queryError } = await supabase
      .from('caddy_verifications')
      .select('id, user_id, storage_path, status, rejection_reason, submitted_at')
      .order('submitted_at', { ascending: true })
    if (queryError) throw queryError
    const userIds = [...new Set((data ?? []).map(item => item.user_id))]
    const { data: profiles, error: profileError } = userIds.length
      ? await supabase.from('profiles').select('id, full_name, email').in('id', userIds)
      : { data: [], error: null }
    if (profileError) throw profileError
    setRecords((data ?? []).map(item => ({
      ...item,
      profile: (profiles ?? []).find(profile => profile.id === item.user_id) ?? null,
    })))
    setLoading(false)
  }, [])

  useEffect(() => {
    void Promise.resolve().then(load).catch(err => {
      setError(err instanceof Error ? err.message : 'Unable to load verification requests.')
      setLoading(false)
    })
  }, [load])

  async function openDocument(path: string) {
    setError('')
    const { data, error: urlError } = await supabase.storage
      .from('caddy-id-documents')
      .createSignedUrl(path, 300)
    if (urlError) {
      setError(urlError.message)
      return
    }
    setPreview(data.signedUrl)
  }

  async function review(record: Verification, status: 'approved' | 'rejected') {
    const reason = reasons[record.id]?.trim() ?? ''
    if (status === 'rejected' && !reason) {
      setError('Please provide a reason when rejecting an ID.')
      return
    }
    setSaving(record.id)
    setError('')
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser()
      if (authError) throw authError
      if (!user || user.app_metadata.role !== 'admin') throw new Error('Admin access is required.')
      const { error: updateError } = await supabase
        .from('caddy_verifications')
        .update({
          status,
          rejection_reason: status === 'rejected' ? reason : null,
          reviewed_at: new Date().toISOString(),
          reviewed_by: user.id,
        })
        .eq('id', record.id)
      if (updateError) throw updateError
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save this review.')
    } finally {
      setSaving(null)
    }
  }

  return (
    <main className="min-h-screen bg-[#F8F9FC] px-5 py-12">
      <div className="mx-auto max-w-5xl">
        <Link to="/" className="text-sm font-semibold text-[#0B5FFF]">← Home</Link>
        <h1 className="mt-6 text-3xl font-bold">Caddy ID reviews</h1>
        <p className="mt-2 text-gray-600">Review identity documents before enabling Caddy job access.</p>
        {error && <p role="alert" className="mt-6 rounded-xl bg-red-50 p-4 text-red-700">{error}</p>}
        {loading ? <p className="mt-8">Loading review queue…</p> : !authorized ? (
          <p className="mt-8 rounded-2xl bg-white p-6 text-gray-700">Admin access is required to view identity documents.</p>
        ) : records.length === 0 ? (
          <p className="mt-8 rounded-2xl bg-white p-6 text-gray-600">No Caddy verification requests have been submitted.</p>
        ) : (
          <div className="mt-8 space-y-5">
            {records.map(record => (
              <article key={record.id} className="rounded-2xl bg-white p-6 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h2 className="text-xl font-bold">{record.profile?.full_name || 'Caddy account'}</h2>
                    <p className="mt-1 text-gray-600">{record.profile?.email || record.user_id}</p>
                    <p className="mt-2 text-sm capitalize text-gray-500">{record.status} · submitted {new Date(record.submitted_at).toLocaleString()}</p>
                  </div>
                  <button onClick={() => void openDocument(record.storage_path)} className="rounded-full border border-gray-300 px-4 py-2 font-semibold">View private ID</button>
                </div>
                {record.status !== 'approved' && (
                  <>
                    <label className="mt-5 block space-y-2">
                      <span className="text-sm font-semibold">Rejection reason (required to reject)</span>
                      <textarea value={reasons[record.id] ?? ''} onChange={event => setReasons(current => ({ ...current, [record.id]: event.target.value }))} className="w-full rounded-xl border border-gray-300 px-4 py-3" rows={2} maxLength={500} />
                    </label>
                    <div className="mt-4 flex flex-wrap gap-3">
                      <button disabled={saving === record.id} onClick={() => void review(record, 'approved')} className="rounded-full bg-green-700 px-5 py-3 font-semibold text-white disabled:opacity-60">Approve Caddy</button>
                      <button disabled={saving === record.id} onClick={() => void review(record, 'rejected')} className="rounded-full bg-red-700 px-5 py-3 font-semibold text-white disabled:opacity-60">Reject and request new ID</button>
                    </div>
                  </>
                )}
              </article>
            ))}
          </div>
        )}
        {preview && <div role="dialog" aria-modal="true" aria-label="ID document preview" className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setPreview(null)}>
          <div className="max-h-full max-w-5xl rounded-xl bg-white p-3" onClick={event => event.stopPropagation()}>
            <button className="mb-2 rounded-lg px-3 py-2 font-semibold" onClick={() => setPreview(null)}>Close</button>
            <iframe title="Private ID document" src={preview} className="h-[80vh] w-[80vw]" />
          </div>
        </div>}
      </div>
    </main>
  )
}
