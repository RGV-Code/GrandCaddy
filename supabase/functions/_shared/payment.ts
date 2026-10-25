import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

export const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_URL')?.replace(/\/+$/, '') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

export const adminClient = () => createClient(
  requiredEnv('SUPABASE_URL'),
  requiredEnv('SUPABASE_SERVICE_ROLE_KEY'),
  { auth: { persistSession: false, autoRefreshToken: false } },
)

export function requiredEnv(name: string) {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`Missing required server configuration: ${name}`)
  return value
}

export function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

async function sendEmail(to: string, name: string, code: string, title: string) {
  const sender = requiredEnv('SENDGRID_FROM_EMAIL')
  const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${requiredEnv('SENDGRID_API_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to, name }] }],
      from: { email: sender },
      subject: `GrandCaddy service confirmation: ${title}`,
      content: [{
        type: 'text/plain',
        value: `Your GrandCaddy service code is ${code}. Share it with the Caddy when the service is provided. Booking: ${title}.`,
      }],
    }),
  })
  if (!response.ok) throw new Error(`SendGrid delivery failed (${response.status}).`)
}

async function sendSms(to: string, code: string, title: string) {
  const accountSid = requiredEnv('TWILIO_ACCOUNT_SID')
  const authToken = requiredEnv('TWILIO_AUTH_TOKEN')
  const form = new URLSearchParams({
    To: to,
    From: requiredEnv('TWILIO_PHONE_NUMBER'),
    Body: `GrandCaddy code: ${code}. Share it with the Caddy when ${title} is complete.`,
  })
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form,
  })
  if (!response.ok) throw new Error(`Twilio SMS delivery failed (${response.status}).`)
}

function newServiceCode() {
  const limit = Math.floor(0x100000000 / 1_000_000) * 1_000_000
  const bytes = new Uint32Array(1)
  do crypto.getRandomValues(bytes)
  while (bytes[0] >= limit)
  return String(bytes[0] % 1_000_000).padStart(6, '0')
}

export async function processVerifiedPayment(reference: string) {
  const client = adminClient()
  const { data: booking, error: bookingError } = await client
    .from('service_bookings')
    .select('id, customer_id, title, offered_amount_zar, payment_status, payment_reference, confirmation_code_status')
    .eq('payment_reference', reference)
    .maybeSingle()
  if (bookingError) throw bookingError
  if (!booking) throw new Error('No booking matches this payment reference.')

  const paystackResponse = await fetch(
    `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
    { headers: { Authorization: `Bearer ${requiredEnv('PAYSTACK_SECRET_KEY')}` } },
  )
  if (!paystackResponse.ok) throw new Error(`Paystack could not verify this payment (${paystackResponse.status}).`)
  const verification = await paystackResponse.json()
  const transaction = verification?.data
  const expectedAmount = Math.round(Number(booking.offered_amount_zar) * 100)
  if (
    transaction?.status !== 'success'
    || transaction.reference !== reference
    || transaction.amount !== expectedAmount
    || transaction.currency !== 'ZAR'
    || verification.status !== true
  ) {
    throw new Error('Paystack has not confirmed the expected payment amount and currency.')
  }

  if (booking.payment_status !== 'paid') {
    const code = newServiceCode()
    const codeHash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code))
    const hashHex = Array.from(new Uint8Array(codeHash), byte => byte.toString(16).padStart(2, '0')).join('')
    const { data: markedPaid, error: confirmError } = await client.rpc('confirm_booking_payment', {
      p_booking_id: booking.id,
      p_reference: reference,
      p_code_hash: hashHex,
      p_code: code,
    })
    if (confirmError) throw confirmError
    if (!markedPaid) {
      const { data: current, error: currentError } = await client
        .from('service_bookings')
        .select('payment_status')
        .eq('id', booking.id)
        .single()
      if (currentError) throw currentError
      if (current.payment_status !== 'paid') throw new Error('This payment could not be applied to the booking.')
    }
  }

  if (booking.confirmation_code_status === 'sent') {
    await client.rpc('clear_booking_service_code', { p_booking_id: booking.id })
    return { payment_status: 'paid', code_delivery_status: 'already_sent' as const }
  }

  const { data: code, error: codeError } = await client.rpc('read_booking_service_code', { p_booking_id: booking.id })
  if (codeError) throw codeError
  if (!code) {
    const { data: currentBooking, error: currentError } = await client
      .from('service_bookings')
      .select('confirmation_code_status')
      .eq('id', booking.id)
      .single()
    if (currentError) throw currentError
    if (currentBooking.confirmation_code_status === 'sent') {
      return { payment_status: 'paid', code_delivery_status: 'already_sent' as const }
    }
    await client.from('service_bookings')
      .update({ confirmation_code_status: 'failed' })
      .eq('id', booking.id)
      .eq('payment_status', 'paid')
      .neq('confirmation_code_status', 'sent')
    return { payment_status: 'paid', code_delivery_status: 'failed' as const }
  }

  const { data: account, error: accountError } = await client.auth.admin.getUserById(booking.customer_id)
  if (accountError) throw accountError
  if (!account.user.email) throw new Error('The ordering account has no email address for the confirmation code.')
  const { data: buyerProfile, error: buyerError } = await client
    .from('profiles')
    .select('full_name, phone')
    .eq('id', booking.customer_id)
    .single()
  if (buyerError) throw buyerError
  const { data: recipient, error: recipientError } = await client
    .from('booking_recipients')
    .select('full_name, email, phone')
    .eq('booking_id', booking.id)
    .single()
  if (recipientError) throw recipientError

  const deliveries: Promise<void>[] = [
    sendEmail(account.user.email, buyerProfile.full_name, code, booking.title),
  ]
  if (recipient.email) deliveries.push(sendEmail(recipient.email, recipient.full_name, code, booking.title))
  if (buyerProfile.phone) deliveries.push(sendSms(buyerProfile.phone, code, booking.title))
  if (recipient.phone) deliveries.push(sendSms(recipient.phone, code, booking.title))

  const results = await Promise.allSettled(deliveries)
  const failures = results.filter(result => result.status === 'rejected')
  if (failures.length) {
    console.error('Service code delivery failed', failures.map(result => (
      result.status === 'rejected' ? result.reason?.message : ''
    )))
    const { error: statusError } = await client.from('service_bookings')
      .update({ confirmation_code_status: 'failed' })
      .eq('id', booking.id)
      .eq('payment_status', 'paid')
      .neq('confirmation_code_status', 'sent')
    if (statusError) throw statusError
    return { payment_status: 'paid', code_delivery_status: 'failed' as const }
  }

  const { error: statusError } = await client.from('service_bookings')
    .update({ confirmation_code_status: 'sent' })
    .eq('id', booking.id)
    .eq('payment_status', 'paid')
  if (statusError) throw statusError
  const { error: clearError } = await client.rpc('clear_booking_service_code', { p_booking_id: booking.id })
  if (clearError) throw clearError
  return { payment_status: 'paid', code_delivery_status: 'sent' as const }
}

export async function validatePaystackSignature(request: Request, rawBody: string) {
  const signature = request.headers.get('x-paystack-signature')
  if (!signature) return false
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(requiredEnv('PAYSTACK_SECRET_KEY')),
    { name: 'HMAC', hash: 'SHA-512' },
    false,
    ['sign'],
  )
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody))
  const expected = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
  if (expected.length !== signature.length) return false
  let mismatch = 0
  for (let index = 0; index < expected.length; index += 1) {
    mismatch |= expected.charCodeAt(index) ^ signature.charCodeAt(index)
  }
  return mismatch === 0
}
