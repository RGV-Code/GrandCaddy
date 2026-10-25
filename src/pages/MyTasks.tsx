import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'

type Booking = {
  id: string
  title: string
  suburb: string
  offered_amount_zar: number
  status: string
  payment_status: string
  confirmation_code_status: string
  created_at: string
}

export default function MyTasks() {
  const [bookings, setBookings] = useState<Booking[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [paying, setPaying] = useState<string | null>(null)

  const loadBookings = useCallback(async () => {
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError) throw authError
    if (!user) {
      setError('Please sign in to view your bookings.')
      setLoading(false)
      return
    }
    const { data, error: queryError } = await supabase
      .from('service_bookings')
      .select('id, title, suburb, offered_amount_zar, status, payment_status, confirmation_code_status, created_at')
      .eq('customer_id', user.id)
      .order('created_at', { ascending: false })
    if (queryError) throw queryError
    setBookings(data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => {
    void Promise.resolve().then(loadBookings).catch(err => {
      setError(err instanceof Error ? err.message : 'Unable to load bookings.')
      setLoading(false)
    })
  }, [loadBookings])

  async function pay(bookingId: string) {
    setPaying(bookingId)
    setError('')
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('create-payment', {
        body: { bookingId },
      })
      if (invokeError) throw invokeError
      if (!data?.authorization_url) throw new Error('The payment provider did not return a checkout link.')
      window.location.assign(data.authorization_url)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to start payment.')
      setPaying(null)
    }
  }

  return (
    <main className="min-h-screen bg-[#F8F9FC] px-5 py-12">
      <div className="mx-auto max-w-4xl">
        <Link to="/" className="text-sm font-semibold text-[#0B5FFF]">← Home</Link>
        <div className="mt-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">My bookings</h1>
            <p className="mt-2 text-gray-600">Track payments and service requests.</p>
          </div>
          <Link to="/post-task" className="rounded-full bg-[#0B5FFF] px-5 py-3 font-semibold text-white">Book a service</Link>
        </div>

        {error && <p role="alert" className="mt-6 rounded-xl bg-red-50 p-4 text-red-700">{error}</p>}
        {loading ? <p className="mt-8">Loading bookings…</p> : bookings.length === 0
          ? <p className="mt-8 rounded-2xl bg-white p-6 text-gray-600">You do not have any bookings yet.</p>
          : <div className="mt-8 space-y-4">
            {bookings.map(booking => (
              <article key={booking.id} className="rounded-2xl bg-white p-6 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h2 className="text-xl font-bold">{booking.title}</h2>
                    <p className="mt-1 text-gray-600">{booking.suburb} · R{Number(booking.offered_amount_zar).toFixed(2)}</p>
                  </div>
                  <span className="rounded-full bg-gray-100 px-3 py-1 text-sm capitalize">{booking.status.replace('_', ' ')}</span>
                </div>
                <p className="mt-4 text-sm text-gray-600">
                  Payment: <strong className="capitalize">{booking.payment_status}</strong>
                </p>
                {booking.payment_status === 'pending' ? (
                  <button disabled={paying === booking.id} onClick={() => void pay(booking.id)} className="mt-4 rounded-full bg-[#0B5FFF] px-5 py-3 font-semibold text-white disabled:opacity-60">
                    {paying === booking.id ? 'Opening checkout…' : 'Pay securely'}
                  </button>
                ) : (
                  <p className={`mt-3 text-sm ${booking.confirmation_code_status === 'sent' ? 'text-green-700' : 'text-amber-800'}`}>
                    {booking.confirmation_code_status === 'sent'
                      ? 'Payment received. The service confirmation code was sent to you and the recipient.'
                      : booking.confirmation_code_status === 'pending'
                        ? 'Payment received. Sending the service confirmation code now.'
                        : 'Payment received, but code delivery needs assistance. Contact info@grandcaddy.com.'}
                  </p>
                )}
              </article>
            ))}
          </div>}
      </div>
    </main>
  )
}
