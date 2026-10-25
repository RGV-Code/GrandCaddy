import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'

type Booking = {
  id: string
  customer_id: string
  caddy_id: string | null
  title: string
  description: string
  suburb: string
  offered_amount_zar: number
  status: 'open' | 'accepted' | 'in_progress' | 'completed'
  payment_status: 'pending' | 'paid'
}

export default function MyBookings() {
  const [bookings, setBookings] = useState<Booking[]>([])
  const [verification, setVerification] = useState('pending')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState<string | null>(null)
  const [recipientByBooking, setRecipientByBooking] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError) throw authError
    if (!user) {
      setError('Please sign in to view Caddy bookings.')
      setLoading(false)
      return
    }
    const { data: verificationRecord, error: verificationError } = await supabase
      .from('caddy_verifications')
      .select('status')
      .eq('user_id', user.id)
      .maybeSingle()
    if (verificationError) throw verificationError
    setVerification(verificationRecord?.status ?? 'not submitted')
    if (verificationRecord?.status !== 'approved') {
      setLoading(false)
      return
    }

    const { data, error: bookingError } = await supabase
      .from('service_bookings')
      .select('id, customer_id, caddy_id, title, description, suburb, offered_amount_zar, status, payment_status')
      .order('created_at', { ascending: false })
    if (bookingError) throw bookingError
    setBookings(data ?? [])
    const assigned = (data ?? []).filter(booking => booking.caddy_id === user.id)
    if (assigned.length) {
      const { data: recipients, error: recipientError } = await supabase
        .from('booking_recipients')
        .select('booking_id, full_name, email, phone')
        .in('booking_id', assigned.map(booking => booking.id))
      if (recipientError) throw recipientError
      setRecipientByBooking(Object.fromEntries((recipients ?? []).map(recipient => [
        recipient.booking_id,
        `${recipient.full_name}${recipient.phone ? ` · ${recipient.phone}` : ''}${recipient.email ? ` · ${recipient.email}` : ''}`,
      ])))
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void Promise.resolve().then(load).catch(err => {
      setError(err instanceof Error ? err.message : 'Unable to load Caddy bookings.')
      setLoading(false)
    })
  }, [load])

  async function updateStatus(booking: Booking, status: 'accepted' | 'in_progress' | 'completed') {
    setUpdating(booking.id)
    setError('')
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser()
      if (authError) throw authError
      if (!user) throw new Error('Please sign in again.')
      const { error: updateError } = await supabase
        .from('service_bookings')
        .update({ caddy_id: status === 'accepted' ? user.id : booking.caddy_id, status })
        .eq('id', booking.id)
      if (updateError) throw updateError
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update this booking.')
    } finally {
      setUpdating(null)
    }
  }

  return (
    <main className="min-h-screen bg-[#F8F9FC] px-5 py-12">
      <div className="mx-auto max-w-4xl">
        <Link to="/" className="text-sm font-semibold text-[#0B5FFF]">← Home</Link>
        <h1 className="mt-6 text-3xl font-bold">Caddy bookings</h1>
        <p className="mt-2 text-gray-600">Browse paid service requests and manage your assigned jobs.</p>
        {error && <p role="alert" className="mt-6 rounded-xl bg-red-50 p-4 text-red-700">{error}</p>}
        {loading ? <p className="mt-8">Loading bookings…</p> : verification !== 'approved' ? (
          <section className="mt-8 rounded-2xl bg-white p-6">
            <h2 className="text-xl font-bold">Caddy approval required</h2>
            <p className="mt-2 text-gray-600">Your identity verification is {verification}. You can access bookings after an admin approves your ID.</p>
            <Link to="/helper/verification" className="mt-4 inline-block font-semibold text-[#0B5FFF]">Submit or check your ID verification →</Link>
          </section>
        ) : bookings.length === 0 ? (
          <p className="mt-8 rounded-2xl bg-white p-6 text-gray-600">No paid bookings are available right now.</p>
        ) : (
          <div className="mt-8 space-y-4">
            {bookings.map(booking => (
              <article key={booking.id} className="rounded-2xl bg-white p-6 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h2 className="text-xl font-bold">{booking.title}</h2>
                    <p className="mt-1 text-gray-600">{booking.suburb} · R{Number(booking.offered_amount_zar).toFixed(2)}</p>
                  </div>
                  <span className="rounded-full bg-gray-100 px-3 py-1 text-sm capitalize">{booking.status.replace('_', ' ')}</span>
                </div>
                <p className="mt-4 whitespace-pre-wrap text-gray-700">{booking.description}</p>
                {booking.caddy_id && <p className="mt-3 text-sm text-gray-600">Service recipient: {recipientByBooking[booking.id] ?? 'Loading recipient details…'}</p>}
                {booking.status === 'open' && (
                  <button disabled={updating === booking.id} onClick={() => void updateStatus(booking, 'accepted')} className="mt-5 rounded-full bg-[#0B5FFF] px-5 py-3 font-semibold text-white disabled:opacity-60">
                    {updating === booking.id ? 'Accepting…' : 'Accept job'}
                  </button>
                )}
                {booking.status === 'accepted' && (
                  <button disabled={updating === booking.id} onClick={() => void updateStatus(booking, 'in_progress')} className="mt-5 rounded-full bg-[#0B5FFF] px-5 py-3 font-semibold text-white disabled:opacity-60">
                    Start job
                  </button>
                )}
                {booking.status === 'in_progress' && (
                  <button disabled={updating === booking.id} onClick={() => void updateStatus(booking, 'completed')} className="mt-5 rounded-full bg-[#0B5FFF] px-5 py-3 font-semibold text-white disabled:opacity-60">
                    Mark job completed
                  </button>
                )}
                {booking.status === 'completed' && booking.payment_status === 'paid' && (
                  <p className="mt-5 rounded-xl bg-green-50 p-4 font-semibold text-green-800">
                    Payment received for this completed job.
                    <span className="mt-1 block text-sm font-normal">This confirms the customer’s payment; Caddy payout transfers are not configured yet.</span>
                  </p>
                )}
              </article>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
