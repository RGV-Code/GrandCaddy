import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { adminClient, corsHeaders, jsonResponse, processVerifiedPayment, requiredEnv } from '../_shared/payment.ts'

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed.' }, 405)

  try {
    const authorization = request.headers.get('Authorization')
    if (!authorization) return jsonResponse({ error: 'Sign in to verify this payment.' }, 401)
    const userClient = createClient(requiredEnv('SUPABASE_URL'), requiredEnv('SUPABASE_ANON_KEY'), {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: { user }, error: authError } = await userClient.auth.getUser()
    if (authError || !user) return jsonResponse({ error: 'Your session is not valid. Sign in again.' }, 401)

    const body = await request.json()
    if (typeof body.reference !== 'string' || body.reference.length > 100) {
      return jsonResponse({ error: 'A valid payment reference is required.' }, 400)
    }
    const client = adminClient()
    const { data: booking, error: bookingError } = await client
      .from('service_bookings')
      .select('customer_id')
      .eq('payment_reference', body.reference)
      .maybeSingle()
    if (bookingError) throw bookingError
    if (!booking || booking.customer_id !== user.id) {
      return jsonResponse({ error: 'Payment reference not found for your account.' }, 404)
    }
    const result = await processVerifiedPayment(body.reference)
    return jsonResponse(result)
  } catch (error) {
    console.error('Payment verification failed', error)
    return jsonResponse({ error: error instanceof Error ? error.message : 'Payment verification failed.' }, 500)
  }
})
