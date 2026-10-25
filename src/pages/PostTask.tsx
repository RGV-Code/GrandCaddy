import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'

type BookingForm = {
  title: string
  description: string
  suburb: string
  amount: string
  recipientName: string
  recipientEmail: string
  recipientPhone: string
}

export default function PostTask() {
  const [form, setForm] = useState<BookingForm>({
    title: '',
    description: '',
    suburb: '',
    amount: '',
    recipientName: '',
    recipientEmail: '',
    recipientPhone: '',
  })
  const [error, setError] = useState('')
  const [pendingBookingId, setPendingBookingId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  function update(field: keyof BookingForm, value: string) {
    setForm(current => ({ ...current, [field]: value }))
  }

  async function beginPayment(bookingId: string) {
    const { data, error: paymentError } = await supabase.functions.invoke('create-payment', {
      body: { bookingId },
    })
    if (paymentError) throw paymentError
    if (!data?.authorization_url) throw new Error('The payment provider did not return a checkout link.')
    window.location.assign(data.authorization_url)
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    if (!form.recipientEmail.trim() && !form.recipientPhone.trim()) {
      setError('Add an email address or phone number for the person receiving the service.')
      return
    }
    if (form.recipientPhone && !/^\+[1-9]\d{7,14}$/.test(form.recipientPhone)) {
      setError('Enter the recipient’s phone number in international format, for example +27123456789.')
      return
    }
    const amount = Number(form.amount)
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('Enter a valid service amount.')
      return
    }

    setLoading(true)
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser()
      if (authError) throw authError
      if (!user) {
        navigate('/login')
        return
      }

      const { data: booking, error: bookingError } = await supabase
        .from('service_bookings')
        .insert({
          customer_id: user.id,
          title: form.title.trim(),
          description: form.description.trim(),
          suburb: form.suburb.trim(),
          offered_amount_zar: amount,
        })
        .select('id')
        .single()
      if (bookingError) throw bookingError
      setPendingBookingId(booking.id)

      const { error: recipientError } = await supabase.from('booking_recipients').insert({
        booking_id: booking.id,
        full_name: form.recipientName.trim(),
        email: form.recipientEmail.trim() || null,
        phone: form.recipientPhone.trim() || null,
      })
      if (recipientError) {
        const { error: cleanupError } = await supabase.from('service_bookings').delete().eq('id', booking.id)
        if (cleanupError) throw new Error(`${recipientError.message} The incomplete booking could not be removed: ${cleanupError.message}`)
        setPendingBookingId(null)
        throw recipientError
      }

      await beginPayment(booking.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to start this booking.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen bg-[#F8F9FC] px-5 py-12">
      <div className="mx-auto max-w-2xl rounded-3xl bg-white p-8 shadow-sm sm:p-10">
        <Link to="/" className="text-sm font-semibold text-[#0B5FFF]">← Home</Link>
        <h1 className="mt-6 text-3xl font-bold">Book a service</h1>
        <p className="mt-2 text-gray-600">
          Tell us what help is needed and who will receive the service. A confirmation code
          will be sent to you and the recipient after payment is verified.
        </p>

        <form className="mt-8 space-y-5" onSubmit={event => void submit(event)}>
          <label className="block space-y-2">
            <span className="font-semibold">Service title</span>
            <input required maxLength={120} value={form.title} onChange={event => update('title', event.target.value)} className="w-full rounded-xl border border-gray-300 px-4 py-3" placeholder="e.g. Grocery shopping" />
          </label>
          <label className="block space-y-2">
            <span className="font-semibold">What help is needed?</span>
            <textarea required maxLength={2000} value={form.description} onChange={event => update('description', event.target.value)} className="w-full rounded-xl border border-gray-300 px-4 py-3" rows={4} />
          </label>
          <label className="block space-y-2">
            <span className="font-semibold">Suburb</span>
            <input required maxLength={120} value={form.suburb} onChange={event => update('suburb', event.target.value)} className="w-full rounded-xl border border-gray-300 px-4 py-3" />
          </label>
          <label className="block space-y-2">
            <span className="font-semibold">Offered amount (ZAR)</span>
            <input required min="1" step="0.01" type="number" value={form.amount} onChange={event => update('amount', event.target.value)} className="w-full rounded-xl border border-gray-300 px-4 py-3" />
          </label>

          <fieldset className="space-y-4 rounded-2xl border border-gray-200 p-5">
            <legend className="px-2 font-bold">Person receiving the service</legend>
            <label className="block space-y-2">
              <span className="font-semibold">Full name</span>
              <input required maxLength={120} value={form.recipientName} onChange={event => update('recipientName', event.target.value)} className="w-full rounded-xl border border-gray-300 px-4 py-3" />
            </label>
            <label className="block space-y-2">
              <span className="font-semibold">Email (optional if phone is provided)</span>
              <input type="email" value={form.recipientEmail} onChange={event => update('recipientEmail', event.target.value)} className="w-full rounded-xl border border-gray-300 px-4 py-3" />
            </label>
            <label className="block space-y-2">
              <span className="font-semibold">Phone (optional if email is provided)</span>
              <input type="tel" placeholder="+27123456789" value={form.recipientPhone} onChange={event => update('recipientPhone', event.target.value)} className="w-full rounded-xl border border-gray-300 px-4 py-3" />
            </label>
          </fieldset>

          {error && <div role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">
            <p>{error}</p>
            {pendingBookingId && <Link to="/my-tasks" className="mt-2 inline-block font-semibold underline">Open My bookings to retry payment</Link>}
          </div>}
          <button disabled={loading} className="w-full rounded-full bg-[#0B5FFF] px-6 py-4 font-semibold text-white disabled:opacity-60">
            {loading ? 'Preparing secure checkout…' : 'Continue to secure payment'}
          </button>
        </form>
      </div>
    </main>
  )
}
