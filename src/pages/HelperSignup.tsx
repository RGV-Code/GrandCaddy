import { useEffect, useState, type ChangeEvent } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'

type Verification = {
  status: 'pending' | 'approved' | 'rejected'
  rejection_reason: string | null
  storage_path: string
}

export default function HelperSignup() {
  const [verification, setVerification] = useState<Verification | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)

  useEffect(() => {
    async function load() {
      const { data: { user }, error: authError } = await supabase.auth.getUser()
      if (authError) throw authError
      if (!user) {
        setError('Please sign in as a Caddy to submit your ID.')
        setLoading(false)
        return
      }
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single()
      if (profileError) throw profileError
      if (profile.role !== 'helper') {
        setError('This verification page is only for Caddy accounts.')
        setLoading(false)
        return
      }
      const { data, error: queryError } = await supabase
        .from('caddy_verifications')
        .select('status, rejection_reason, storage_path')
        .eq('user_id', user.id)
        .maybeSingle()
      if (queryError) throw queryError
      setVerification(data)
      setLoading(false)
    }
    void load().catch(err => {
      setError(err instanceof Error ? err.message : 'Unable to load verification status.')
      setLoading(false)
    })
  }, [])

  async function submitDocument(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setError('')
    setNotice('')
    if (!['image/jpeg', 'image/png', 'application/pdf'].includes(file.type)) {
      setError('Upload a JPG, PNG, or PDF file.')
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      setError('The document must be 10 MB or smaller.')
      return
    }

    setUploading(true)
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser()
      if (authError) throw authError
      if (!user) throw new Error('Please sign in again.')
      const extension = file.type === 'application/pdf' ? 'pdf' : file.type === 'image/png' ? 'png' : 'jpg'
      const path = `${user.id}/${crypto.randomUUID()}.${extension}`
      const { error: uploadError } = await supabase.storage
        .from('caddy-id-documents')
        .upload(path, file, { contentType: file.type, upsert: false })
      if (uploadError) throw uploadError

      const { error: saveError } = await supabase.from('caddy_verifications').upsert({
        user_id: user.id,
        storage_path: path,
        status: 'pending',
        rejection_reason: null,
        submitted_at: new Date().toISOString(),
        reviewed_at: null,
        reviewed_by: null,
      }, { onConflict: 'user_id' })
      if (saveError) {
        await supabase.storage.from('caddy-id-documents').remove([path])
        throw saveError
      }
      if (verification?.storage_path) {
        const { error: removeError } = await supabase.storage
          .from('caddy-id-documents')
          .remove([verification.storage_path])
        if (removeError) throw removeError
      }
      setVerification({ status: 'pending', rejection_reason: null, storage_path: path })
      setNotice('Your ID was submitted securely. You can use Caddy bookings once an admin approves it.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to submit your ID.')
    } finally {
      setUploading(false)
    }
  }

  return (
    <main className="min-h-screen bg-[#F8F9FC] px-5 py-12">
      <section className="mx-auto max-w-2xl rounded-3xl bg-white p-8 shadow-sm sm:p-10">
        <Link to="/" className="text-sm font-semibold text-[#0B5FFF]">← Home</Link>
        <h1 className="mt-6 text-3xl font-bold">Caddy identity verification</h1>
        <p className="mt-3 text-gray-600">
          Upload a clear photo or scan of your ID. It is stored privately and only you and
          authorized administrators can view it. You must be approved before you can accept jobs.
        </p>
        {loading ? <p className="mt-8">Loading verification status…</p> : (
          <>
            {verification && <div className="mt-6 rounded-xl bg-blue-50 p-4">
              <p className="font-semibold capitalize">Status: {verification.status}</p>
              {verification.status === 'pending' && <p className="mt-1 text-sm text-gray-600">Your ID is waiting for admin review.</p>}
              {verification.status === 'approved' && <p className="mt-1 text-sm text-gray-600">You are approved to browse and accept Caddy jobs.</p>}
              {verification.status === 'rejected' && <p className="mt-1 text-sm text-red-700">{verification.rejection_reason || 'Please upload a clearer ID document.'}</p>}
            </div>}
            {(!verification || verification.status === 'rejected') && (
              <label className="mt-6 block rounded-2xl border-2 border-dashed border-gray-300 p-6 text-center">
                <span className="block font-semibold">{uploading ? 'Uploading securely…' : 'Choose ID document (JPG, PNG, or PDF)'}</span>
                <span className="mt-2 block text-sm text-gray-500">Maximum size: 10 MB</span>
                <input className="mt-4 block w-full" type="file" accept="image/jpeg,image/png,application/pdf" disabled={uploading} onChange={event => void submitDocument(event)} />
              </label>
            )}
            {verification?.status === 'approved' && <Link to="/helper/bookings" className="mt-6 inline-flex rounded-full bg-[#0B5FFF] px-6 py-3 font-semibold text-white">View Caddy bookings</Link>}
          </>
        )}
        {notice && <p role="status" className="mt-5 rounded-xl bg-green-50 p-4 text-green-800">{notice}</p>}
        {error && <p role="alert" className="mt-5 rounded-xl bg-red-50 p-4 text-red-700">{error}</p>}
      </section>
    </main>
  )
}
