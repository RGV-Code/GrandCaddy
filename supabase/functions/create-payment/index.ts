import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { adminClient, corsHeaders, jsonResponse, requiredEnv } from '../_shared/payment.ts'

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed.' }, 405)

  try {
    const authorization = request.headers.get('Authorization')
    if (!authorization) return jsonResponse({ error: 'Sign in to pay for a booking.' }, 401)
    const userClient = createClient(requiredEnv('SUPABASE_URL'), requiredEnv('SUPABASE_ANON_KEY'), {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: { user }, error: authError } = await userClient.auth.getUser()
    if (authError || !user) return jsonResponse({ error: 'Your session is not valid. Sign in again.' }, 401)

    const body = await request.json()
    if (typeof body.bookingId !== 'string') return jsonResponse({ error: 'A booking ID is required.' }, 400)
    const client = adminClient()
    const { data: booking, error: bookingError } = await client
      .from('service_bookings')
      .select('id, customer_id, title, offered_amount_zar, status, payment_status')
      .eq('id', body.bookingId)
      .maybeSingle()
    if (bookingError) throw bookingError
    if (!booking || booking.customer_id !== user.id) return jsonResponse({ error: 'Booking not found.' }, 404)
    if (booking.payment_status === 'paid') return jsonResponse({ error: 'This booking has already been paid.' }, 409)
    if (booking.status !== 'open') return jsonResponse({ error: 'This booking is no longer open for payment.' }, 409)
    const { data: recipient, error: recipientError } = await client
      .from('booking_recipients')
      .select('booking_id')
      .eq('booking_id', booking.id)
      .maybeSingle()
    if (recipientError) throw recipientError
    if (!recipient) return jsonResponse({ error: 'Add the service recipient’s contact details before paying.' }, 409)

    const amount = Math.round(Number(booking.offered_amount_zar) * 100)
    if (!Number.isSafeInteger(amount) || amount < 100) return jsonResponse({ error: 'The booking amount is invalid.' }, 400)
    const proposedReference = `gc_${crypto.randomUUID().replaceAll('-', '')}`
    const { data: reservation, error: reserveError } = await client.rpc('reserve_booking_checkout', {
      p_booking_id: booking.id,
      p_reference: proposedReference,
    })
    if (reserveError) throw reserveError
    const checkout = reservation?.[0]
    if (!checkout) return jsonResponse({ error: 'The booking changed. Refresh and try again.' }, 409)
    if (!checkout.should_initialize) {
      if (checkout.authorization_url) {
        return jsonResponse({ authorization_url: checkout.authorization_url, reference: checkout.checkout_reference })
      }
      return jsonResponse({ error: 'Secure checkout is being prepared. Try again in a moment.' }, 409)
    }
    const reference = checkout.checkout_reference

    let paystackResponse: Response
    try {
      paystackResponse = await fetch('https://api.paystack.co/transaction/initialize', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${requiredEnv('PAYSTACK_SECRET_KEY')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: user.email,
          amount,
          currency: 'ZAR',
          reference,
          callback_url: `${requiredEnv('APP_URL').replace(/\/+$/, '')}/payment/complete`,
          metadata: { booking_id: booking.id, customer_id: user.id },
        }),
      })
    } catch (error) {
      await client.rpc('clear_booking_checkout', { p_booking_id: booking.id, p_reference: reference })
      throw error
    }
    let responseBody: { status?: boolean; data?: { authorization_url?: string }; message?: string }
    try {
      responseBody = await paystackResponse.json()
    } catch (error) {
      const { error: clearError } = await client.rpc('clear_booking_checkout', {
        p_booking_id: booking.id,
        p_reference: reference,
      })
      if (clearError) throw new Error(`Paystack returned an unreadable response and the checkout could not be cleared: ${clearError.message}`)
      throw error
    }
    if (!paystackResponse.ok || responseBody.status !== true || !responseBody.data?.authorization_url) {
      const { error: clearError } = await client.rpc('clear_booking_checkout', {
        p_booking_id: booking.id,
        p_reference: reference,
      })
      if (clearError) throw clearError
      throw new Error(responseBody.message ?? `Paystack checkout initialization failed (${paystackResponse.status}).`)
    }
    const { data: savedCheckout, error: saveUrlError } = await client.rpc('save_booking_checkout_url', {
      p_booking_id: booking.id,
      p_reference: reference,
      p_authorization_url: responseBody.data.authorization_url,
    })
    if (saveUrlError || !savedCheckout) {
      const { error: clearError } = await client.rpc('clear_booking_checkout', {
        p_booking_id: booking.id,
        p_reference: reference,
      })
      if (clearError) throw new Error(`The checkout link could not be saved or cleared: ${clearError.message}`)
      if (saveUrlError) throw saveUrlError
      throw new Error('The secure checkout link could not be saved.')
    }
    return jsonResponse({
      authorization_url: responseBody.data.authorization_url,
      reference,
    })
  } catch (error) {
    console.error('Payment initialization failed', error)
    return jsonResponse({ error: error instanceof Error ? error.message : 'Payment initialization failed.' }, 500)
  }
})
