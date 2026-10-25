# GrandCaddy

GrandCaddy is a React/Vite application backed by Supabase. The Caddy verification, bookings,
payments, and confirmation-code delivery features require the Supabase migration and Edge
Functions below; the frontend alone does not process payments or send messages.

## Configure the backend

1. Create a Supabase project and set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in the
   frontend environment.
2. Apply `supabase/migrations/20261025000000_verification_and_bookings.sql` with the Supabase
   CLI (`supabase db push`) or the Supabase SQL editor.
   Enable email confirmation in Supabase Auth if customer email verification is required.
3. Deploy `create-payment` and `verify-payment` with JWT verification enabled. Deploy
   `paystack-webhook` with JWT verification disabled because Paystack signs webhook requests
   instead:

   ```sh
   supabase functions deploy create-payment
   supabase functions deploy verify-payment
   supabase functions deploy paystack-webhook --no-verify-jwt
   ```
4. Configure these Edge Function secrets (never put secret values in frontend environment
   variables):

   - `PAYSTACK_SECRET_KEY`
   - `SENDGRID_API_KEY`
   - `SENDGRID_FROM_EMAIL` (a verified SendGrid sender)
   - `TWILIO_ACCOUNT_SID`
   - `TWILIO_AUTH_TOKEN`
   - `TWILIO_PHONE_NUMBER` (a Twilio-enabled sender)
   - `APP_URL` (the deployed frontend origin, used for the Paystack callback and CORS)

   Supabase provides `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` to
   Edge Functions. Do not expose the service-role key to the browser.
5. Set Paystack's webhook URL to
   `https://<project-ref>.supabase.co/functions/v1/paystack-webhook`.
6. Give each administrator the `app_metadata` claim `"role": "admin"` using a trusted
   Supabase administrator tool. Do not set admin access in user-editable metadata.

The ID-document bucket is private and accepts PDF, JPG, and PNG uploads up to 10 MB.
Applicants remain unable to browse or accept jobs until an administrator approves their
submission. Confirmation codes are generated only after server-side Paystack verification,
sent to the ordering account and service recipient through SendGrid and/or Twilio, and held
in a private database schema while delivery is pending. A code becomes inaccessible after
24 hours; expired records are removed opportunistically when a later verification request runs.

Paystack captures customer payments in ZAR. This implementation does not yet configure
automated Caddy payouts or transfers; the Caddy completion screen distinguishes the recorded
customer payment from an actual payout. Before production, configure a Caddy payout workflow,
ID-document retention/deletion policy, and applicable privacy/payment compliance controls.

## Run locally

```sh
npm install
npm run dev
```
