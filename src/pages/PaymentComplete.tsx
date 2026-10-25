import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'

type VerificationResult = {
  payment_status?: string
  code_delivery_status?: 'sent' | 'failed' | 'already_sent'
  message?: string
}

export default function PaymentComplete() {
  const [searchParams] = useSearchParams()
  const reference = searchParams.get('reference')
  const [result, setResult] = useState<VerificationResult | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!reference) return
    void supabase.functions.invoke('verify-payment', { body: { reference } }).then(({ data, error: invokeError }) => {
      if (invokeError) {
        setError(invokeError.message)
        return
      }
      setResult(data as VerificationResult)
    }).catch(err => setError(err instanceof Error ? err.message : 'Unable to verify payment.'))
  }, [reference])

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#F8F9FC] px-5 py-12">
      <section className="w-full max-w-xl rounded-3xl bg-white p-8 text-center shadow-sm">
        {result?.payment_status === 'paid' ? (
          <>
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-100 text-3xl text-green-700">✓</div>
            <h1 className="mt-5 text-3xl font-bold">Payment successful</h1>
            <p className="mt-3 text-gray-600">Your payment was verified securely.</p>
            {result.code_delivery_status === 'sent' || result.code_delivery_status === 'already_sent' ? (
              <p className="mt-4 rounded-xl bg-green-50 p-4 text-green-800">Your service confirmation code has been sent to you and the recipient by the contact details provided.</p>
            ) : (
              <p role="alert" className="mt-4 rounded-xl bg-amber-50 p-4 text-amber-900">Payment succeeded, but we could not confirm delivery of the service code. Please contact <a className="font-semibold underline" href="mailto:info@grandcaddy.com">info@grandcaddy.com</a> for assistance.</p>
            )}
          </>
        ) : error || !reference ? (
          <>
            <h1 className="text-3xl font-bold">Payment status needs checking</h1>
            <p role="alert" className="mt-3 text-red-700">{error || 'No payment reference was provided. Check My bookings to confirm your payment status.'}</p>
            <p className="mt-3 text-gray-600">Your payment is not marked successful unless Paystack confirms it.</p>
          </>
        ) : (
          <>
            <h1 className="text-3xl font-bold">Verifying your payment…</h1>
            <p className="mt-3 text-gray-600">Please wait while we confirm the payment directly with Paystack.</p>
          </>
        )}
        <Link to="/my-tasks" className="mt-7 inline-flex rounded-full bg-[#0B5FFF] px-6 py-3 font-semibold text-white">View my bookings</Link>
      </section>
    </main>
  )
}
