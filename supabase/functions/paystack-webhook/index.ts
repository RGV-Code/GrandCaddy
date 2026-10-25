import { corsHeaders, jsonResponse, processVerifiedPayment, validatePaystackSignature } from '../_shared/payment.ts'

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed.' }, 405)

  try {
    const rawBody = await request.text()
    if (!await validatePaystackSignature(request, rawBody)) {
      return jsonResponse({ error: 'Invalid Paystack signature.' }, 401)
    }
    const event = JSON.parse(rawBody)
    if (event.event !== 'charge.success' || typeof event.data?.reference !== 'string') {
      return jsonResponse({ received: true })
    }
    const result = await processVerifiedPayment(event.data.reference)
    if (result.code_delivery_status === 'failed') {
      return jsonResponse({ error: 'Payment was recorded, but confirmation delivery failed.' }, 500)
    }
    return jsonResponse({ received: true })
  } catch (error) {
    console.error('Paystack webhook processing failed', error)
    return jsonResponse({ error: error instanceof Error ? error.message : 'Webhook processing failed.' }, 500)
  }
})
