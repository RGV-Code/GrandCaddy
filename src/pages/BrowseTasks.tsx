import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'

type Booking = {
  id: string
  title: string
  description: string
  suburb: string
  offered_amount_zar: number
  status: 'open' | 'accepted' | 'in_progress' | 'completed'
  payment_status: 'pending' | 'paid'
  created_at: string
  customer_id: string
}

export default function BrowseTasks() {
  const [bookings, setBookings] = useState<Booking[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const { data, error: queryError } = await supabase
      .from('service_bookings')
      .select('id, title, description, suburb, offered_amount_zar, status, payment_status, created_at, customer_id')
      .eq('status', 'open')
      .eq('payment_status', 'paid')
      .order('created_at', { ascending: false })

    if (queryError) throw queryError
    setBookings(data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => {
    void Promise.resolve().then(load).catch((err) => {
      setError(err instanceof Error ? err.message : 'Unable to load available jobs.')
      setLoading(false)
    })
  }, [load])

  return (
    <main className="min-h-screen bg-[#F8F9FC] px-5 py-12">
      <div className="mx-auto max-w-4xl">
        <Link to="/" className="text-sm font-semibold text-[#0B5FFF]">← Home</Link>
        <div className="mt-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">Browse jobs</h1>
            <p className="mt-2 text-gray-600">Paid service requests currently open for Caddies.</p>
          </div>
          <Link to="/helper/verification" className="rounded-full border border-[#0B5FFF] px-5 py-3 font-semibold text-[#0B5FFF]">
            Verification
          </Link>
        </div>

        {error && <p role="alert" className="mt-6 rounded-xl bg-red-50 p-4 text-red-700">{error}</p>}

        {loading ? (
          <p className="mt-8">Loading available jobs…</p>
        ) : bookings.length === 0 ? (
          <p className="mt-8 rounded-2xl bg-white p-6 text-gray-600">There are no paid jobs available right now.</p>
        ) : (
          <div className="mt-8 space-y-4">
            {bookings.map((booking) => (
              <article key={booking.id} className="rounded-2xl bg-white p-6 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h2 className="text-xl font-bold">{booking.title}</h2>
                    <p className="mt-1 text-gray-600">{booking.suburb} · R{Number(booking.offered_amount_zar).toFixed(2)}</p>
                  </div>
                  <span className="rounded-full bg-green-100 px-3 py-1 text-sm font-medium text-green-800">Paid</span>
                </div>
                <p className="mt-4 whitespace-pre-wrap text-gray-700">{booking.description}</p>
                <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-gray-500">Posted recently</p>
                  <Link to={`/tasks/${booking.id}`} className="rounded-full bg-[#0B5FFF] px-5 py-3 font-semibold text-white">
                    View details
                  </Link>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
