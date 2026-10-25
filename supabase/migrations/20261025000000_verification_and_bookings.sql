create schema if not exists private;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'role' = 'admin', false);
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  email text not null default '',
  phone text,
  role text not null check (role in ('customer', 'helper')),
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  assigned_role text;
begin
  assigned_role := case
    when new.raw_user_meta_data ->> 'role' in ('customer', 'helper')
      then new.raw_user_meta_data ->> 'role'
    else 'customer'
  end;

  insert into public.profiles (id, full_name, email, phone, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(new.email, ''),
    nullif(new.raw_user_meta_data ->> 'phone', ''),
    assigned_role
  )
  on conflict (id) do update set
    full_name = excluded.full_name,
    email = excluded.email,
    phone = excluded.phone;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
after insert or update of email on auth.users
for each row execute function public.handle_new_user();

insert into public.profiles (id, full_name, email, phone, role)
select
  id,
  coalesce(raw_user_meta_data ->> 'full_name', ''),
  coalesce(email, ''),
  nullif(raw_user_meta_data ->> 'phone', ''),
  case when raw_user_meta_data ->> 'role' = 'helper' then 'helper' else 'customer' end
from auth.users
on conflict (id) do nothing;

create or replace function public.prevent_profile_role_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() = old.id and new.role <> old.role then
    raise exception 'Profile roles cannot be changed by the account owner';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_profile_role on public.profiles;
create trigger protect_profile_role
before update on public.profiles
for each row execute function public.prevent_profile_role_change();

create table if not exists public.caddy_verifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles (id) on delete cascade,
  storage_path text not null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  rejection_reason text,
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users (id)
);

create table if not exists public.service_bookings (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles (id),
  caddy_id uuid references public.profiles (id),
  title text not null,
  description text not null,
  suburb text not null,
  offered_amount_zar numeric(10, 2) not null check (offered_amount_zar > 0),
  status text not null default 'open'
    check (status in ('open', 'accepted', 'in_progress', 'completed')),
  payment_status text not null default 'pending'
    check (payment_status in ('pending', 'paid')),
  confirmation_code_status text not null default 'not_ready'
    check (confirmation_code_status in ('not_ready', 'pending', 'sent', 'failed')),
  payment_reference text unique,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.booking_recipients (
  booking_id uuid primary key references public.service_bookings (id) on delete cascade,
  full_name text not null,
  email text,
  phone text,
  check (email is not null or phone is not null)
);

create index if not exists service_bookings_open_paid_idx
  on public.service_bookings (status, payment_status, created_at desc);
create index if not exists service_bookings_customer_idx
  on public.service_bookings (customer_id, created_at desc);
create index if not exists service_bookings_caddy_idx
  on public.service_bookings (caddy_id, created_at desc);

create table if not exists private.booking_service_codes (
  booking_id uuid primary key references public.service_bookings (id) on delete cascade,
  code text not null,
  code_hash text not null,
  created_at timestamptz not null default now()
);

create table if not exists private.booking_payment_checkouts (
  booking_id uuid primary key references public.service_bookings (id) on delete cascade,
  reference text not null unique,
  authorization_url text,
  created_at timestamptz not null default now()
);

revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;
revoke all on private.booking_service_codes from public, anon, authenticated;
grant select, insert, update, delete on private.booking_service_codes to service_role;
revoke all on private.booking_payment_checkouts from public, anon, authenticated;
grant select, insert, update, delete on private.booking_payment_checkouts to service_role;

create or replace function public.confirm_booking_payment(
  p_booking_id uuid,
  p_reference text,
  p_code_hash text,
  p_code text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed_id uuid;
begin
  update public.service_bookings
  set payment_status = 'paid',
      confirmation_code_status = 'pending'
  where id = p_booking_id
    and payment_reference = p_reference
    and payment_status = 'pending'
    and status = 'open'
  returning id into changed_id;

  if changed_id is null then
    return false;
  end if;
  delete from private.booking_payment_checkouts where booking_id = p_booking_id;

  insert into private.booking_service_codes (booking_id, code, code_hash)
  values (p_booking_id, p_code, p_code_hash)
  on conflict (booking_id) do update set
    code = excluded.code,
    code_hash = excluded.code_hash,
    created_at = now();

  return true;
end;
$$;

create or replace function public.read_booking_service_code(p_booking_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  service_code text;
begin
  delete from private.booking_service_codes
  where created_at < now() - interval '24 hours';
  select code into service_code
  from private.booking_service_codes
  where booking_id = p_booking_id and created_at >= now() - interval '24 hours';
  return service_code;
end;
$$;

create or replace function public.clear_booking_service_code(p_booking_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from private.booking_service_codes where booking_id = p_booking_id;
$$;

create or replace function public.reserve_booking_checkout(p_booking_id uuid, p_reference text)
returns table (checkout_reference text, authorization_url text, should_initialize boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_checkout private.booking_payment_checkouts%rowtype;
  changed_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_booking_id::text, 0));

  select * into existing_checkout
  from private.booking_payment_checkouts
  where booking_id = p_booking_id
  for update;

  if found and (
    (existing_checkout.authorization_url is not null and existing_checkout.created_at >= now() - interval '24 hours')
    or (existing_checkout.authorization_url is null and existing_checkout.created_at >= now() - interval '5 minutes')
  ) then
    return query select existing_checkout.reference, existing_checkout.authorization_url, false;
    return;
  end if;

  delete from private.booking_payment_checkouts where booking_id = p_booking_id;
  update public.service_bookings
  set payment_reference = p_reference
  where id = p_booking_id and payment_status = 'pending' and status = 'open'
  returning id into changed_id;
  if changed_id is null then
    return;
  end if;

  insert into private.booking_payment_checkouts (booking_id, reference)
  values (p_booking_id, p_reference);
  return query select p_reference, null::text, true;
end;
$$;

create or replace function public.save_booking_checkout_url(
  p_booking_id uuid,
  p_reference text,
  p_authorization_url text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed_id uuid;
begin
  update private.booking_payment_checkouts
  set authorization_url = p_authorization_url
  where booking_id = p_booking_id and reference = p_reference
  returning booking_id into changed_id;
  return changed_id is not null;
end;
$$;

create or replace function public.clear_booking_checkout(p_booking_id uuid, p_reference text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from private.booking_payment_checkouts
  where booking_id = p_booking_id and reference = p_reference;
  update public.service_bookings
  set payment_reference = null
  where id = p_booking_id and payment_reference = p_reference and payment_status = 'pending';
end;
$$;

revoke all on function public.confirm_booking_payment(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.read_booking_service_code(uuid) from public, anon, authenticated;
revoke all on function public.clear_booking_service_code(uuid) from public, anon, authenticated;
revoke all on function public.reserve_booking_checkout(uuid, text) from public, anon, authenticated;
revoke all on function public.save_booking_checkout_url(uuid, text, text) from public, anon, authenticated;
revoke all on function public.clear_booking_checkout(uuid, text) from public, anon, authenticated;
grant execute on function public.confirm_booking_payment(uuid, text, text, text) to service_role;
grant execute on function public.read_booking_service_code(uuid) to service_role;
grant execute on function public.clear_booking_service_code(uuid) to service_role;
grant execute on function public.reserve_booking_checkout(uuid, text) to service_role;
grant execute on function public.save_booking_checkout_url(uuid, text, text) to service_role;
grant execute on function public.clear_booking_checkout(uuid, text) to service_role;

create or replace function public.enforce_booking_workflow()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;

  if new.customer_id <> old.customer_id
    or new.created_at <> old.created_at
    or new.title <> old.title
    or new.description <> old.description
    or new.suburb <> old.suburb
    or new.offered_amount_zar <> old.offered_amount_zar
    or new.payment_status <> old.payment_status
    or new.confirmation_code_status <> old.confirmation_code_status
    or new.payment_reference is distinct from old.payment_reference then
    raise exception 'Booking details and payment status cannot be changed by users';
  end if;

  if old.caddy_id is null then
    if old.status <> 'open'
      or new.caddy_id <> auth.uid()
      or new.status <> 'accepted'
      or not exists (
        select 1 from public.profiles p
        join public.caddy_verifications v on v.user_id = p.id
        where p.id = auth.uid() and p.role = 'helper' and v.status = 'approved'
      ) then
      raise exception 'Only approved Caddies can accept open bookings';
    end if;
  else
    if old.caddy_id <> auth.uid()
      or new.caddy_id <> old.caddy_id
      or not (
        (old.status = 'accepted' and new.status = 'in_progress')
        or (old.status = 'in_progress' and new.status = 'completed')
      ) then
      raise exception 'Invalid booking status transition';
    end if;
  end if;

  if new.status = 'completed' then
    new.completed_at := now();
  else
    new.completed_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists validate_booking_workflow on public.service_bookings;
create trigger validate_booking_workflow
before update on public.service_bookings
for each row execute function public.enforce_booking_workflow();

alter table public.profiles enable row level security;
alter table public.caddy_verifications enable row level security;
alter table public.service_bookings enable row level security;
alter table public.booking_recipients enable row level security;

drop policy if exists "Profiles are visible to their owner and admins" on public.profiles;
create policy "Profiles are visible to their owner and admins"
on public.profiles for select to authenticated
using (id = auth.uid() or public.is_admin());

drop policy if exists "Owners may update their contact details" on public.profiles;
create policy "Owners may update their contact details"
on public.profiles for update to authenticated
using (id = auth.uid())
with check (id = auth.uid());

drop policy if exists "Admins manage profiles" on public.profiles;
create policy "Admins manage profiles"
on public.profiles for all to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Caddies and admins read verification records" on public.caddy_verifications;
create policy "Caddies and admins read verification records"
on public.caddy_verifications for select to authenticated
using (user_id = auth.uid() or public.is_admin());

drop policy if exists "Caddies submit their own verification" on public.caddy_verifications;
create policy "Caddies submit their own verification"
on public.caddy_verifications for insert to authenticated
with check (
  user_id = auth.uid()
  and status = 'pending'
  and storage_path like auth.uid()::text || '/%'
  and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'helper')
);

drop policy if exists "Caddies resubmit rejected verification" on public.caddy_verifications;
create policy "Caddies resubmit rejected verification"
on public.caddy_verifications for update to authenticated
using (user_id = auth.uid() and status = 'rejected')
with check (
  user_id = auth.uid()
  and status = 'pending'
  and storage_path like auth.uid()::text || '/%'
);

drop policy if exists "Admins review verification records" on public.caddy_verifications;
create policy "Admins review verification records"
on public.caddy_verifications for update to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Customers and assigned Caddies read bookings" on public.service_bookings;
create policy "Customers and assigned Caddies read bookings"
on public.service_bookings for select to authenticated
using (
  customer_id = auth.uid()
  or public.is_admin()
  or (
    exists (
      select 1 from public.profiles p
      join public.caddy_verifications v on v.user_id = p.id
      where p.id = auth.uid() and p.role = 'helper' and v.status = 'approved'
    )
    and payment_status = 'paid'
    and (status = 'open' or caddy_id = auth.uid())
  )
);

drop policy if exists "Customers create their own bookings" on public.service_bookings;
create policy "Customers create their own bookings"
on public.service_bookings for insert to authenticated
with check (
  customer_id = auth.uid()
  and caddy_id is null
  and status = 'open'
  and payment_status = 'pending'
  and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'customer')
);

drop policy if exists "Customers remove their unpaid incomplete bookings" on public.service_bookings;
create policy "Customers remove their unpaid incomplete bookings"
on public.service_bookings for delete to authenticated
using (
  customer_id = auth.uid()
  and caddy_id is null
  and status = 'open'
  and payment_status = 'pending'
  and payment_reference is null
);

drop policy if exists "Approved Caddies accept and complete bookings" on public.service_bookings;
create policy "Approved Caddies accept and complete bookings"
on public.service_bookings for update to authenticated
using (
  (caddy_id is null and status = 'open' and payment_status = 'paid')
  or caddy_id = auth.uid()
)
with check (caddy_id = auth.uid());

drop policy if exists "Customers manage recipient details for their bookings" on public.booking_recipients;
create policy "Customers manage recipient details for their bookings"
on public.booking_recipients for all to authenticated
using (
  exists (
    select 1 from public.service_bookings b
    where b.id = booking_id
      and b.customer_id = auth.uid()
      and b.payment_status = 'pending'
      and b.payment_reference is null
      and b.status = 'open'
  )
)
with check (
  exists (
    select 1 from public.service_bookings b
    where b.id = booking_id
      and b.customer_id = auth.uid()
      and b.payment_status = 'pending'
      and b.payment_reference is null
      and b.status = 'open'
  )
);

drop policy if exists "Assigned Caddies read recipient details" on public.booking_recipients;
create policy "Assigned Caddies read recipient details"
on public.booking_recipients for select to authenticated
using (
  exists (
    select 1 from public.service_bookings b
    where b.id = booking_id and b.caddy_id = auth.uid()
  )
);

drop policy if exists "Admins read bookings" on public.service_bookings;
create policy "Admins read bookings"
on public.service_bookings for select to authenticated
using (public.is_admin());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('caddy-id-documents', 'caddy-id-documents', false, 10485760, array['image/jpeg', 'image/png', 'application/pdf'])
on conflict (id) do update set
  public = false,
  file_size_limit = 10485760,
  allowed_mime_types = array['image/jpeg', 'image/png', 'application/pdf'];

drop policy if exists "Caddies upload ID documents to their own folder" on storage.objects;
create policy "Caddies upload ID documents to their own folder"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'caddy-id-documents'
  and (storage.foldername(name))[1] = auth.uid()::text
  and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'helper')
);

drop policy if exists "Caddies replace their own ID documents" on storage.objects;
create policy "Caddies replace their own ID documents"
on storage.objects for delete to authenticated
using (bucket_id = 'caddy-id-documents' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Admins and owners read ID documents" on storage.objects;
create policy "Admins and owners read ID documents"
on storage.objects for select to authenticated
using (
  bucket_id = 'caddy-id-documents'
  and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
);
