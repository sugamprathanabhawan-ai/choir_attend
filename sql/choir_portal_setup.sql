-- Sugam Choir Portal database setup (run once in a NEW Supabase project's SQL Editor).
-- This file intentionally uses a choir_ prefix so it is safe beside the earlier prototype.
create extension if not exists pgcrypto;

create table if not exists public.choir_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null check (length(trim(full_name)) > 1),
  email text not null,
  phone_num text not null check (phone_num ~ '^9[0-9]{9}$'),
  symbolnum text unique,
  selfie_path text,
  accepted_laws boolean not null default false,
  status text not null default 'pending' check (status in ('pending','approved','rejected','deactivated')),
  role text not null default 'user' check (role in ('user','admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.choir_settings (
  id smallint primary key default 1 check (id = 1),
  month_name text not null default 'Baisakh',
  working_days smallint not null default 4 check (working_days between 1 and 6),
  updated_at timestamptz not null default now()
);
insert into public.choir_settings (id) values (1) on conflict (id) do nothing;

-- The requested stacking table.  One submitted row per approved member per Saturday.
create table if not exists public.choir_attendance_stack (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.choir_profiles(id) on delete cascade,
  symbol text not null,
  datefilled date not null,
  month_name text not null,
  name text not null,
  reason text,
  time_filled timestamptz not null default now(),
  point smallint not null check (point in (0,1)),
  holiday_used smallint not null check (holiday_used in (0,1)),
  attendance_on_time smallint not null check (attendance_on_time in (0,1)),
  attendance_status text not null check (attendance_status in ('present','absent','not_filled')),
  unique (user_id, datefilled),
  check ((attendance_status = 'absent' and length(trim(coalesce(reason,''))) >= 3) or attendance_status <> 'absent')
);
create index if not exists choir_attendance_stack_date_idx on public.choir_attendance_stack(datefilled);
create index if not exists choir_attendance_stack_month_idx on public.choir_attendance_stack(month_name);

-- The requested non-stacking aggregate table.  It always represents the active month.
create table if not exists public.choir_attendance_aggregate (
  user_id uuid primary key references public.choir_profiles(id) on delete cascade,
  name text not null,
  email text not null,
  symbolnum text,
  phone_num text not null,
  total_points integer not null default 0,
  total_holiday_used integer not null default 0,
  total_attendance_on_time integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.choir_personal_laws (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.choir_profiles(id) on delete cascade,
  personal_law text not null,
  updated_at timestamptz not null default now()
);

create or replace function public.choir_is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.choir_profiles where id = auth.uid() and role = 'admin' and status = 'approved');
$$;

-- A profile is created from Supabase Auth metadata.  Configure Auth email confirmation so
-- Supabase sends the verification code before the member can sign in.
create or replace function public.choir_create_profile()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.choir_profiles (id, full_name, email, phone_num, accepted_laws)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    new.email,
    coalesce(new.raw_user_meta_data->>'phone_num', ''),
    coalesce((new.raw_user_meta_data->>'accepted_laws')::boolean, false)
  );
  return new;
end;
$$;
drop trigger if exists choir_after_auth_signup on auth.users;
create trigger choir_after_auth_signup after insert on auth.users
for each row execute function public.choir_create_profile();

create or replace function public.choir_touch_updated_at()
returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;
drop trigger if exists choir_profile_updated on public.choir_profiles;
create trigger choir_profile_updated before update on public.choir_profiles for each row execute function public.choir_touch_updated_at();
drop trigger if exists choir_settings_updated on public.choir_settings;
create trigger choir_settings_updated before update on public.choir_settings for each row execute function public.choir_touch_updated_at();
drop trigger if exists choir_law_updated on public.choir_personal_laws;
create trigger choir_law_updated before update on public.choir_personal_laws for each row execute function public.choir_touch_updated_at();

-- Rebuild keeps the aggregate table to exactly one row per member for the selected month.
create or replace function public.choir_rebuild_aggregate()
returns void language plpgsql security definer set search_path = public as $$
declare active_month text;
begin
  select month_name into active_month from public.choir_settings where id = 1;
  delete from public.choir_attendance_aggregate;
  insert into public.choir_attendance_aggregate
    (user_id, name, email, symbolnum, phone_num, total_points, total_holiday_used, total_attendance_on_time)
  select p.id, p.full_name, p.email, p.symbolnum, p.phone_num,
    coalesce(sum(s.point) filter (where s.month_name = active_month), 0),
    coalesce(sum(s.holiday_used) filter (where s.month_name = active_month), 0),
    coalesce(sum(s.attendance_on_time) filter (where s.month_name = active_month), 0)
  from public.choir_profiles p
  left join public.choir_attendance_stack s on s.user_id = p.id
  where p.status = 'approved'
  group by p.id, p.full_name, p.email, p.symbolnum, p.phone_num;
end;
$$;

create or replace function public.choir_refresh_aggregate_after_stack()
returns trigger language plpgsql security definer set search_path = public as $$
begin perform public.choir_rebuild_aggregate(); return new; end; $$;
drop trigger if exists choir_stack_refresh_aggregate on public.choir_attendance_stack;
create trigger choir_stack_refresh_aggregate after insert or update or delete on public.choir_attendance_stack
for each statement execute function public.choir_refresh_aggregate_after_stack();

-- The browser calls this RPC; all time, status and point calculations happen in Postgres.
create or replace function public.choir_submit_attendance(p_symbol text, p_status text, p_reason text default null)
returns public.choir_attendance_stack language plpgsql security definer set search_path = public as $$
declare p public.choir_profiles; npt timestamptz := now() at time zone 'Asia/Kathmandu';
  npt_date date := (now() at time zone 'Asia/Kathmandu')::date;
  npt_time time := (now() at time zone 'Asia/Kathmandu')::time;
  already_holidays integer; outrow public.choir_attendance_stack; active_month text;
  v_point smallint; v_holiday smallint; v_on_time smallint;
begin
  select * into p from public.choir_profiles where id = auth.uid();
  if not found or p.status <> 'approved' then raise exception 'Your account is awaiting administrator approval.'; end if;
  if p.symbolnum is null or p.symbolnum <> trim(p_symbol) then raise exception 'Your symbol number does not match your account.'; end if;
  if extract(isodow from npt_date) <> 6 or npt_time < time '03:00' or npt_time > time '23:00' then
    raise exception 'Attendance opens only Saturday, 3:00 AM–11:00 PM Nepal time.';
  end if;
  if p_status not in ('present','absent') then raise exception 'Choose Present or Absent.'; end if;
  if p_status = 'absent' and length(trim(coalesce(p_reason,''))) < 3 then raise exception 'Please enter a valid absence reason.'; end if;
  select count(*) into already_holidays from public.choir_attendance_stack s
    join public.choir_settings st on st.id = 1 where s.user_id = p.id and s.month_name = st.month_name and s.holiday_used = 1;
  if npt_time <= time '09:50' then
    v_on_time := 1; v_holiday := case when p_status = 'absent' then 1 else 0 end;
    v_point := case when p_status = 'absent' and already_holidays > 0 then 1 else 0 end;
  else
    v_on_time := 0; v_holiday := 1;
    v_point := case when already_holidays > 0 then 1 else 0 end;
  end if;
  select month_name into active_month from public.choir_settings where id = 1;
  insert into public.choir_attendance_stack (user_id,symbol,datefilled,month_name,name,reason,time_filled,point,holiday_used,attendance_on_time,attendance_status)
  values (p.id,p.symbolnum,npt_date,active_month,p.full_name,nullif(trim(p_reason),''),now(),v_point,v_holiday,v_on_time,p_status)
  returning * into outrow;
  return outrow;
end;
$$;

create or replace function public.choir_save_selfie(p_path text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_path !~ ('^' || auth.uid()::text || '/selfie\\.jpg$') then
    raise exception 'Invalid selfie path.';
  end if;
  update public.choir_profiles set selfie_path = p_path where id = auth.uid();
end;
$$;

-- Called by the Apps Script at 11:01 PM Saturday.  It adds exactly one row for every
-- approved member who did not submit.  Restrict this function to service-role callers.
create or replace function public.choir_mark_missing_attendance()
returns integer language plpgsql security definer set search_path = public as $$
declare npt_date date := (now() at time zone 'Asia/Kathmandu')::date; active_month text; inserted_count integer;
begin
  if auth.role() <> 'service_role' then raise exception 'Service-role scheduler required.'; end if;
  if extract(isodow from npt_date) <> 6 or (now() at time zone 'Asia/Kathmandu')::time < time '23:01' then
    raise exception 'This job may only run after 11:01 PM Nepal time on Saturday.';
  end if;
  select month_name into active_month from public.choir_settings where id = 1;
  insert into public.choir_attendance_stack (user_id,symbol,datefilled,month_name,name,reason,time_filled,point,holiday_used,attendance_on_time,attendance_status)
  select p.id,p.symbolnum,npt_date,active_month,p.full_name,'No form submitted',now(),1,1,0,'not_filled'
  from public.choir_profiles p
  where p.status = 'approved' and p.symbolnum is not null
    and not exists (select 1 from public.choir_attendance_stack s where s.user_id = p.id and s.datefilled = npt_date);
  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

create or replace function public.choir_admin_set_settings(p_month text, p_working_days smallint)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.choir_is_admin() then raise exception 'Administrator access required.'; end if;
  update public.choir_settings set month_name = trim(p_month), working_days = p_working_days where id = 1;
  perform public.choir_rebuild_aggregate();
end;
$$;

alter table public.choir_profiles enable row level security;
alter table public.choir_settings enable row level security;
alter table public.choir_attendance_stack enable row level security;
alter table public.choir_attendance_aggregate enable row level security;
alter table public.choir_personal_laws enable row level security;

create policy "choir profile self read" on public.choir_profiles for select using (id = auth.uid() or public.choir_is_admin());
create policy "choir profile admin update" on public.choir_profiles for update using (public.choir_is_admin()) with check (public.choir_is_admin());
create policy "choir settings signed in read" on public.choir_settings for select to authenticated using (true);
create policy "choir stack self or admin read" on public.choir_attendance_stack for select using (user_id = auth.uid() or public.choir_is_admin());
create policy "choir aggregate self or admin read" on public.choir_attendance_aggregate for select using (user_id = auth.uid() or public.choir_is_admin());
create policy "choir personal law self or admin read" on public.choir_personal_laws for select using (user_id = auth.uid() or public.choir_is_admin());
create policy "choir personal law admin write" on public.choir_personal_laws for all using (public.choir_is_admin()) with check (public.choir_is_admin());

-- Storage for 10 KB compressed JPG selfies.
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('choir-selfies','choir-selfies',false,10240,array['image/jpeg'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
create policy "choir selfie own upload" on storage.objects for insert to authenticated with check (bucket_id = 'choir-selfies' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "choir selfie own read" on storage.objects for select to authenticated using (bucket_id = 'choir-selfies' and ((storage.foldername(name))[1] = auth.uid()::text or public.choir_is_admin()));
create policy "choir selfie own update" on storage.objects for update to authenticated using (bucket_id = 'choir-selfies' and (storage.foldername(name))[1] = auth.uid()::text) with check (bucket_id = 'choir-selfies' and (storage.foldername(name))[1] = auth.uid()::text);

-- After the church admin signs up normally, promote their account once (password is never stored in SQL):
-- update public.choir_profiles set role='admin', status='approved' where email='sugamprathanabhawan@gmail.com';
