import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'

type Booking = {
  id: string
  title: string
  description: string
  suburb: string
  offered_amount_zar: number
  status: 'open' | 'accepted' | 'in_progress' | 'completed'
  payment_status: 'pending' | 'paid'
  customer_id: string
  caddy_id: string | null
  created_at: string
}

type Recipient = {
  full_name: string
  email: string | null
  phone: string | null
}

export default function TaskDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [booking, setBooking] = useState<Booking | null>(null)
  const [recipient, setRecipient] = useState<Recipient | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [updating, setUpdating] = useState(false)

  useEffect(() => {
    async function load() {
      if (!id) {
        setError('Task not found.')
        setLoading(false)
        return
      }

      const { data, error: bookingError } = await supabase
        .from('service_bookings')
        .select('id, title, description, suburb, offered_amount_zar, status, payment_status, customer_id, caddy_id, created_at')
        .eq('id', id)
        .single()

      if (bookingError) {
        throw bookingError
      }

      const { data: recipientData, error: recipientError } = await supabase
        .from('booking_recipients')
        .select('full_name, email, phone')
        .eq('booking_id', id)
        .maybeSingle()

      if (recipientError) {
        throw recipientError
      }

      setBooking(data)
      setRecipient(recipientData)
      setLoading(false)
    }

    void load().catch((err) => {
      setError(err instanceof Error ? err.message : 'Unable to load this task.')
      setLoading(false)
    })
  }, [id])

  async function updateStatus(status: 'accepted' | 'in_progress' | 'completed') {
    if (!booking) return

    setUpdating(true)
    setError('')

    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser()
      if (authError) throw authError
      if (!user) {
        navigate('/login')
        return
      }

      const { data: verification, error: verificationError } = await supabase
        .from('caddy_verifications')
        .select('status')
        .eq('user_id', user.id)
        .maybeSingle()
      if (verificationError) throw verificationError
      if (verification?.status !== 'approved') {
        throw new Error('Your Caddy verification must be approved before accepting jobs.')
      }

      const { error: bookingError } = await supabase
        .from('service_bookings')
        .update({
          caddy_id: status === 'accepted' ? user.id : booking.caddy_id,
          status,
        })
        .eq('id', booking.id)

      if (bookingError) throw bookingError
      setBooking((current) => current ? { ...current, status, caddy_id: status === 'accepted' ? user.id : current.caddy_id } : current)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update this task.')
    } finally {
      setUpdating(false)
    }
  }

  if (loading) {
    return <main className="min-h-screen bg-[#F8F9FC] px-5 py-12"><div className="mx-auto max-w-3xl rounded-3xl bg-white p-8 shadow-sm"><p>Loading task details…</p></div></main>
  }

  if (error || !booking) {
    return (
      <main className="min-h-screen bg-[#F8F9FC] px-5 py-12">
        <div className="mx-auto max-w-3xl rounded-3xl bg-white p-8 shadow-sm">
          <Link to="/browse-tasks" className="text-sm font-semibold text-[#0B5FFF]">← Back to jobs</Link>
          <p className="mt-6 rounded-xl bg-red-50 p-4 text-red-700">{error || 'Task not found.'}</p>
        </div>
      </main>
    )
  }

  const isHelperAssigned = booking.caddy_id !== null
  const canActAsHelper = booking.payment_status === 'paid' && booking.status !== 'completed'

  return (
    <main className="min-h-screen bg-[#F8F9FC] px-5 py-12">
      <div className="mx-auto max-w-3xl rounded-3xl bg-white p-8 shadow-sm sm:p-10">
        <Link to="/browse-tasks" className="text-sm font-semibold text-[#0B5FFF]">← Browse jobs</Link>
        <div className="mt-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">{booking.title}</h1>
            <p className="mt-2 text-gray-600">{booking.suburb} · R{Number(booking.offered_amount_zar).toFixed(2)}</p>
          </div>
          <span className="rounded-full bg-gray-100 px-3 py-1 text-sm capitalize">{booking.status.replace('_', ' ')}</span>
        </div>

        <div className="mt-6 rounded-2xl bg-[#F5F7FF] p-5">
          <p className="text-sm font-semibold uppercase tracking-wide text-[#0B5FFF]">Service details</p>
          <p className="mt-3 whitespace-pre-wrap text-gray-700">{booking.description}</p>
        </div>

        <dl className="mt-6 grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-gray-200 p-4">
            <dt className="text-sm font-medium text-gray-500">Payment status</dt>
            <dd className="mt-1 text-lg font-semibold capitalize">{booking.payment_status}</dd>
          </div>
          <div className="rounded-2xl border border-gray-200 p-4">
            <dt className="text-sm font-medium text-gray-500">Service recipient</dt>
            <dd className="mt-1 text-lg font-semibold">{recipient?.full_name ?? 'Not provided'}</dd>
          </div>
        </dl>

        {recipient && (
          <div className="mt-6 rounded-2xl border border-gray-200 p-4 text-sm text-gray-700">
            <p><strong>Email:</strong> {recipient.email ?? 'Not provided'}</p>
            <p className="mt-2"><strong>Phone:</strong> {recipient.phone ?? 'Not provided'}</p>
          </div>
        )}

        {error && <p role="alert" className="mt-6 rounded-xl bg-red-50 p-4 text-red-700">{error}</p>}

        {booking.status === 'open' && booking.payment_status === 'paid' && !isHelperAssigned && (
          <button disabled={updating} onClick={() => void updateStatus('accepted')} className="mt-8 rounded-full bg-[#0B5FFF] px-6 py-3 font-semibold text-white disabled:opacity-60">
            {updating ? 'Updating…' : 'Accept this job'}
          </button>
        )}

        {booking.status === 'accepted' && booking.caddy_id && canActAsHelper && (
          <button disabled={updating} onClick={() => void updateStatus('in_progress')} className="mt-8 rounded-full bg-[#0B5FFF] px-6 py-3 font-semibold text-white disabled:opacity-60">
            {updating ? 'Starting…' : 'Start the job'}
          </button>
        )}

        {booking.status === 'in_progress' && booking.caddy_id && canActAsHelper && (
          <button disabled={updating} onClick={() => void updateStatus('completed')} className="mt-8 rounded-full bg-[#0B5FFF] px-6 py-3 font-semibold text-white disabled:opacity-60">
            {updating ? 'Completing…' : 'Mark as completed'}
          </button>
        )}

        {booking.status === 'completed' && (
          <p className="mt-8 rounded-xl bg-green-50 p-4 text-green-800">This job has already been completed.</p>
        )}
      </div>
    </main>
  )
}