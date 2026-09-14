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
  point smallint not null check (point in (-1,0,1)),
  holiday_used smallint not null check (holiday_used in (0,1)),
  attendance_on_time smallint not null check (attendance_on_time in (0,1)),
  attendance_status text not null check (attendance_status in ('present','absent','not_filled','manual')),
  check ((attendance_status = 'absent' and length(trim(coalesce(reason,''))) >= 3) or attendance_status <> 'absent')
);
create unique index if not exists choir_attendance_stack_regular_unique_idx
  on public.choir_attendance_stack (user_id, datefilled)
  where attendance_status in ('present', 'absent', 'not_filled');
create index if not exists choir_attendance_stack_date_idx on public.choir_attendance_stack(datefilled);
create index if not exists choir_attendance_stack_month_idx on public.choir_attendance_stack(month_name);

-- Configured working months (support for N number of months)
create table if not exists public.choir_months (
  id uuid primary key default gen_random_uuid(),
  month_name text not null unique,
  working_days smallint not null check (working_days between 1 and 6),
  is_active boolean not null default false,
  created_at timestamptz not null default now()
);

-- Monthly perfect on-time bonus reviews (Valid / Exclude states)
create table if not exists public.choir_bonus_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.choir_profiles(id) on delete cascade,
  month_name text not null,
  status text not null check (status in ('eligible', 'validated', 'excluded')),
  stack_id uuid references public.choir_attendance_stack(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (user_id, month_name)
);

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
  on_time_streak integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.choir_personal_laws (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.choir_profiles(id) on delete cascade,
  personal_law text not null,
  updated_at timestamptz not null default now()
);

drop function if exists public.choir_is_admin() cascade;
create or replace function public.choir_is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.choir_profiles where id = auth.uid() and role = 'admin' and status = 'approved');
$$;

drop function if exists public.choir_is_approved() cascade;
create or replace function public.choir_is_approved()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.choir_profiles where id = auth.uid() and status = 'approved');
$$;

-- A profile is created from Supabase Auth metadata.  Configure Auth email confirmation so
-- Supabase sends the verification code before the member can sign in.
drop function if exists public.choir_create_profile() cascade;
create or replace function public.choir_create_profile()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.choir_profiles (id, full_name, email, phone_num, symbolnum, accepted_laws)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    new.email,
    coalesce(new.raw_user_meta_data->>'phone_num', ''),
    nullif(trim(coalesce(new.raw_user_meta_data->>'symbolnum', '')), ''),
    coalesce((new.raw_user_meta_data->>'accepted_laws')::boolean, false)
  );
  return new;
end;
$$;
drop trigger if exists choir_after_auth_signup on auth.users;
create trigger choir_after_auth_signup after insert on auth.users
for each row execute function public.choir_create_profile();

drop function if exists public.choir_touch_updated_at() cascade;
create or replace function public.choir_touch_updated_at()
returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;
drop trigger if exists choir_profile_updated on public.choir_profiles;
create trigger choir_profile_updated before update on public.choir_profiles for each row execute function public.choir_touch_updated_at();
drop trigger if exists choir_settings_updated on public.choir_settings;
create trigger choir_settings_updated before update on public.choir_settings for each row execute function public.choir_touch_updated_at();
drop trigger if exists choir_law_updated on public.choir_personal_laws;
create trigger choir_law_updated before update on public.choir_personal_laws for each row execute function public.choir_touch_updated_at();

-- Rebuild keeps the aggregate table to exactly one row per member with all-time points till date.
-- When working month days == ontime points, aggregate point -1 occurs.
-- Calculate streak as total present Saturdays till date
create or replace function public.choir_calculate_user_streak(p_user_id uuid, p_active_sat date default null)
returns integer language sql stable set search_path = public as $$
  select coalesce(count(*)::integer, 0)
  from public.choir_attendance_stack
  where user_id = p_user_id
    and attendance_status = 'present';
$$;

-- Security-definer RPC function to fetch active streaks for all approved members
create or replace function public.choir_get_member_streaks()
returns table (
  user_id uuid,
  streak integer
) language sql security definer set search_path = public as $$
  select p.id as user_id,
         coalesce(count(s.id) filter (where s.attendance_status = 'present'), 0)::integer as streak
  from public.choir_profiles p
  left join public.choir_attendance_stack s on s.user_id = p.id
  where p.status = 'approved'
  group by p.id;
$$;

grant execute on function public.choir_get_member_streaks() to authenticated;

-- Rebuild keeps the aggregate table to exactly one row per member with all-time points till date.
-- Automatic -1 bonus is removed (now awarded deliberately by admin in the Extra Table).
drop function if exists public.choir_rebuild_aggregate() cascade;
create or replace function public.choir_rebuild_aggregate()
returns void language plpgsql security definer set search_path = public as $$
declare
  active_month text;
  today_npt date := (now() at time zone 'Asia/Kathmandu')::date;
begin
  select month_name into active_month from public.choir_settings where id = 1;

  insert into public.choir_attendance_aggregate
    (user_id, name, email, symbolnum, phone_num, total_points, total_holiday_used, total_attendance_on_time, on_time_streak)
  select
    p.id,
    p.full_name,
    p.email,
    p.symbolnum,
    p.phone_num,
    coalesce(sum(s.point) filter (where s.datefilled <= today_npt), 0) as total_points,
    coalesce(sum(s.holiday_used) filter (where s.month_name = active_month), 0) as total_holiday_used,
    coalesce(sum(s.attendance_on_time) filter (where s.month_name = active_month), 0) as total_attendance_on_time,
    coalesce(count(s.id) filter (where s.attendance_status = 'present' and s.datefilled <= today_npt), 0)::integer as on_time_streak
  from public.choir_profiles p
  left join public.choir_attendance_stack s on s.user_id = p.id
  where p.status = 'approved'
  group by p.id, p.full_name, p.email, p.symbolnum, p.phone_num
  on conflict (user_id) do update set
    name = excluded.name,
    email = excluded.email,
    symbolnum = excluded.symbolnum,
    phone_num = excluded.phone_num,
    total_points = excluded.total_points,
    total_holiday_used = excluded.total_holiday_used,
    total_attendance_on_time = excluded.total_attendance_on_time,
    on_time_streak = excluded.on_time_streak,
    updated_at = now();

  -- Clean up unapproved or deleted accounts
  delete from public.choir_attendance_aggregate
  where user_id not in (select id from public.choir_profiles where status = 'approved');
end;
$$;

drop function if exists public.choir_refresh_aggregate_after_stack() cascade;
create or replace function public.choir_refresh_aggregate_after_stack()
returns trigger language plpgsql security definer set search_path = public as $$
begin perform public.choir_rebuild_aggregate(); return new; end; $$;
drop trigger if exists choir_stack_refresh_aggregate on public.choir_attendance_stack;
create trigger choir_stack_refresh_aggregate after insert or update or delete on public.choir_attendance_stack
for each statement execute function public.choir_refresh_aggregate_after_stack();

-- The browser calls this RPC; all time, status and point calculations happen in Postgres.
drop function if exists public.choir_submit_attendance(text, text, text) cascade;
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

drop function if exists public.choir_save_selfie(text) cascade;
create or replace function public.choir_save_selfie(p_path text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_path !~ ('^' || auth.uid()::text || '/selfie\\.jpg$') then
    raise exception 'Invalid selfie path.';
  end if;
  update public.choir_profiles set selfie_path = p_path where id = auth.uid();
end;
$$;

-- Marks missing attendance for approved members who did not submit attendance by Saturday 11:00 PM.
-- Points are awarded strictly on the monthly holiday rule basis:
-- 1. If the member has not used their holiday for the active month (0 holidays used), point = 0, holiday_used = 1.
-- 2. If the member has already used their holiday for the active month (> 0 holidays used), point = 1, holiday_used = 1.
drop function if exists public.choir_mark_missing_attendance(date) cascade;
drop function if exists public.choir_mark_missing_attendance(date, uuid) cascade;

create or replace function public.choir_mark_missing_attendance(
  p_date date default null,
  p_user_id uuid default null
)
returns integer language plpgsql security definer set search_path = public as $$
declare
  npt_now timestamptz := now() at time zone 'Asia/Kathmandu';
  last_saturday date := (npt_now)::date - (((extract(isodow from (npt_now)::date)::integer + 1) % 7))::integer;
  npt_date date := coalesce(p_date, last_saturday);
  active_month text;
  inserted_count integer := 0;
begin
  if auth.role() <> 'service_role' and not public.choir_is_admin() then
    raise exception 'Service-role scheduler or administrator access required.';
  end if;

  if npt_date > (npt_now)::date then
    raise exception 'Missing attendance cannot be marked for future dates.';
  end if;

  if extract(isodow from npt_date) <> 6 then
    raise exception 'The specified date is not a Saturday.';
  end if;

  -- Protect today's ongoing Saturday attendance window:
  -- Automated/batch runs cannot mark missing for today until after 11:00 PM Nepal time,
  -- but an admin can explicitly assign missing attendance for an individual member anytime.
  if p_user_id is null and npt_date = (npt_now)::date and (npt_now)::time < time '23:00' then
    raise exception 'Missing attendance for today cannot be marked until after 11:00 PM Nepal time.';
  end if;

  select month_name into active_month from public.choir_settings where id = 1;

  insert into public.choir_attendance_stack (
    user_id, symbol, datefilled, month_name, name, reason, time_filled, point, holiday_used, attendance_on_time, attendance_status
  )
  select
    p.id,
    coalesce(p.symbolnum, '—'),
    npt_date,
    active_month,
    p.full_name,
    'No form submitted',
    now(),
    case when (
      select count(*)
      from public.choir_attendance_stack s
      where s.user_id = p.id
        and s.month_name = active_month
        and s.holiday_used = 1
    ) > 0 then 1 else 0 end as point,
    1 as holiday_used,
    0 as attendance_on_time,
    'not_filled' as attendance_status
  from public.choir_profiles p
  where p.status = 'approved'
    and (p_user_id is null or p.id = p_user_id)
    and not exists (
      select 1 from public.choir_attendance_stack s
      where s.user_id = p.id 
        and s.datefilled = npt_date
        and s.attendance_status in ('present', 'absent', 'not_filled')
    );

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;
grant execute on function public.choir_mark_missing_attendance(date, uuid) to authenticated;

-- RPC: Valid button for on-time bonus (-1 point)
create or replace function public.choir_admin_award_bonus(p_user_id uuid, p_month text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  p public.choir_profiles;
  v_stack_id uuid;
  v_existing_stack uuid;
begin
  if not public.choir_is_admin() then raise exception 'Administrator access required.'; end if;
  select * into p from public.choir_profiles where id = p_user_id and status = 'approved';
  if not found then raise exception 'Approved member not found.'; end if;

  select stack_id into v_existing_stack
  from public.choir_bonus_reviews
  where user_id = p_user_id and month_name = trim(p_month) and status = 'validated';

  if v_existing_stack is not null then
    return v_existing_stack;
  end if;

  insert into public.choir_attendance_stack (
    user_id, symbol, datefilled, month_name, name, reason, time_filled, point, holiday_used, attendance_on_time, attendance_status
  ) values (
    p.id, coalesce(p.symbolnum, '—'), (now() at time zone 'Asia/Kathmandu')::date,
    trim(p_month), p.full_name, 'On-time bonus reward (-1 pt): ' || trim(p_month), now(),
    -1, 0, 0, 'manual'
  ) returning id into v_stack_id;

  insert into public.choir_bonus_reviews (user_id, month_name, status, stack_id, updated_at)
  values (p.id, trim(p_month), 'validated', v_stack_id, now())
  on conflict (user_id, month_name)
  do update set status = 'validated', stack_id = v_stack_id, updated_at = now();

  perform public.choir_rebuild_aggregate();
  return v_stack_id;
end;
$$;
grant execute on function public.choir_admin_award_bonus(uuid, text) to authenticated;

-- RPC: Exclude button for on-time bonus
create or replace function public.choir_admin_exclude_bonus(p_user_id uuid, p_month text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_stack_id uuid;
begin
  if not public.choir_is_admin() then raise exception 'Administrator access required.'; end if;

  select stack_id into v_stack_id
  from public.choir_bonus_reviews
  where user_id = p_user_id and month_name = trim(p_month);

  if v_stack_id is not null then
    delete from public.choir_attendance_stack where id = v_stack_id;
  end if;

  insert into public.choir_bonus_reviews (user_id, month_name, status, stack_id, updated_at)
  values (p_user_id, trim(p_month), 'excluded', null, now())
  on conflict (user_id, month_name)
  do update set status = 'excluded', stack_id = null, updated_at = now();

  perform public.choir_rebuild_aggregate();
end;
$$;
grant execute on function public.choir_admin_exclude_bonus(uuid, text) to authenticated;

-- Multi-month management RPCs
create or replace function public.choir_admin_add_month(p_month text, p_working_days smallint, p_set_active boolean default false)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.choir_is_admin() then raise exception 'Administrator access required.'; end if;
  if p_working_days < 1 or p_working_days > 6 then raise exception 'Working days must be between 1 and 6.'; end if;

  insert into public.choir_months (month_name, working_days, is_active)
  values (trim(p_month), p_working_days, p_set_active)
  on conflict (month_name)
  do update set working_days = p_working_days, is_active = case when p_set_active then true else public.choir_months.is_active end;

  if p_set_active then
    update public.choir_months set is_active = (month_name = trim(p_month));
    update public.choir_settings set month_name = trim(p_month), working_days = p_working_days where id = 1;
    perform public.choir_rebuild_aggregate();
  end if;
end;
$$;
grant execute on function public.choir_admin_add_month(text, smallint, boolean) to authenticated;

create or replace function public.choir_admin_set_active_month(p_month text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_days smallint;
begin
  if not public.choir_is_admin() then raise exception 'Administrator access required.'; end if;
  select working_days into v_days from public.choir_months where month_name = trim(p_month);
  if not found then raise exception 'Month not found.'; end if;

  update public.choir_months set is_active = (month_name = trim(p_month));
  update public.choir_settings set month_name = trim(p_month), working_days = v_days where id = 1;
  perform public.choir_rebuild_aggregate();
end;
$$;
grant execute on function public.choir_admin_set_active_month(text) to authenticated;

create or replace function public.choir_admin_delete_month(p_month text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_active boolean;
begin
  if not public.choir_is_admin() then raise exception 'Administrator access required.'; end if;
  select is_active into v_active from public.choir_months where month_name = trim(p_month);
  if v_active then raise exception 'Cannot delete the currently active month. Set another month as active first.'; end if;

  delete from public.choir_months where month_name = trim(p_month);
end;
$$;
grant execute on function public.choir_admin_delete_month(text) to authenticated;

drop function if exists public.choir_admin_set_settings(text, smallint) cascade;
create or replace function public.choir_admin_set_settings(p_month text, p_working_days smallint)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.choir_is_admin() then raise exception 'Administrator access required.'; end if;
  update public.choir_settings set month_name = trim(p_month), working_days = p_working_days where id = 1;
  perform public.choir_rebuild_aggregate();
end;
$$;

drop function if exists public.choir_admin_delete_stack_row(uuid) cascade;
create or replace function public.choir_admin_delete_stack_row(p_stack_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.choir_is_admin() then raise exception 'Administrator access required.'; end if;
  delete from public.choir_attendance_stack where id = p_stack_id;
end;
$$;

drop function if exists public.choir_admin_add_manual_points(uuid, integer) cascade;
create or replace function public.choir_admin_add_manual_points(p_user_id uuid, p_points integer)
returns integer language plpgsql security definer set search_path = public as $$
declare
  p public.choir_profiles;
  active_month text;
  i integer;
  inserted_count integer := 0;
begin
  if not public.choir_is_admin() then raise exception 'Administrator access required.'; end if;
  if p_points < 1 or p_points > 100 then raise exception 'Manual points must be between 1 and 100.'; end if;
  select * into p from public.choir_profiles where id = p_user_id;
  if not found then raise exception 'Approved member not found.'; end if;
  select month_name into active_month from public.choir_settings where id = 1;
  for i in 1..p_points loop
    insert into public.choir_attendance_stack (
      user_id, symbol, datefilled, month_name, name, reason, time_filled, point, holiday_used, attendance_on_time, attendance_status
    ) values (
      p.id, coalesce(p.symbolnum, '—'), (now() at time zone 'Asia/Kathmandu')::date,
      active_month, p.full_name, 'Manual point added by admin', now(), 1, 0, 0, 'manual'
    );
    inserted_count := inserted_count + 1;
  end loop;
  return inserted_count;
end;
$$;

drop function if exists public.choir_symbol_available(text) cascade;
create or replace function public.choir_symbol_available(p_symbol text)
returns boolean language sql stable security definer set search_path = public as $$
  select not exists (
    select 1 from public.choir_profiles where lower(trim(symbolnum)) = lower(trim(p_symbol))
  );
$$;

drop function if exists public.choir_sync_missing_symbols() cascade;
create or replace function public.choir_sync_missing_symbols()
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.choir_is_admin() then return; end if;
  update public.choir_profiles p
  set symbolnum = coalesce(nullif(trim(u.raw_user_meta_data->>'symbolnum'), ''), p.symbolnum)
  from auth.users u
  where p.id = u.id and p.symbolnum is null and u.raw_user_meta_data->>'symbolnum' is not null;
end;
$$;

drop view if exists public.choir_member_history_current cascade;
create or replace view public.choir_member_history_current as
  select p.id as user_id, p.full_name as name, p.selfie_path
  from public.choir_profiles p
  where p.status = 'approved';

create table if not exists public.past_members (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  service_time text,
  profile_pic_url text,
  details text,
  display_order integer default 0,
  created_at timestamptz not null default now()
);

grant select on public.choir_member_history_current to anon, authenticated;
grant select on public.past_members to anon, authenticated;

alter table public.choir_profiles enable row level security;
alter table public.choir_settings enable row level security;
alter table public.choir_months enable row level security;
alter table public.choir_bonus_reviews enable row level security;
alter table public.choir_attendance_stack enable row level security;
alter table public.choir_attendance_aggregate enable row level security;
alter table public.choir_personal_laws enable row level security;
alter table public.past_members enable row level security;

drop policy if exists "choir months authenticated read" on public.choir_months;
create policy "choir months authenticated read" on public.choir_months for select to authenticated using (true);
drop policy if exists "choir months admin write" on public.choir_months;
create policy "choir months admin write" on public.choir_months for all using (public.choir_is_admin()) with check (public.choir_is_admin());

drop policy if exists "choir bonus reviews authenticated read" on public.choir_bonus_reviews;
create policy "choir bonus reviews authenticated read" on public.choir_bonus_reviews for select to authenticated using (true);
drop policy if exists "choir bonus reviews admin write" on public.choir_bonus_reviews;
create policy "choir bonus reviews admin write" on public.choir_bonus_reviews for all using (public.choir_is_admin()) with check (public.choir_is_admin());

drop policy if exists "choir profile self read" on public.choir_profiles;
create policy "choir profile self read" on public.choir_profiles for select using (id = auth.uid() or public.choir_is_admin());
drop policy if exists "choir profile admin update" on public.choir_profiles;
create policy "choir profile admin update" on public.choir_profiles for update using (public.choir_is_admin()) with check (public.choir_is_admin());
drop policy if exists "choir settings signed in read" on public.choir_settings;
create policy "choir settings signed in read" on public.choir_settings for select to authenticated using (true);
drop policy if exists "choir stack self or admin read" on public.choir_attendance_stack;
drop policy if exists "choir stack approved read" on public.choir_attendance_stack;
create policy "choir stack approved read" on public.choir_attendance_stack for select using (
  user_id = auth.uid()
  or public.choir_is_admin()
  or public.choir_is_approved()
);
drop policy if exists "choir aggregate self or admin read" on public.choir_attendance_aggregate;
drop policy if exists "choir aggregate approved read" on public.choir_attendance_aggregate;
create policy "choir aggregate approved read" on public.choir_attendance_aggregate for select using (
  user_id = auth.uid()
  or public.choir_is_admin()
  or public.choir_is_approved()
);
drop policy if exists "choir personal law self or admin read" on public.choir_personal_laws;
create policy "choir personal law self or admin read" on public.choir_personal_laws for select using (user_id = auth.uid() or public.choir_is_admin());
drop policy if exists "choir personal law admin write" on public.choir_personal_laws;
create policy "choir personal law admin write" on public.choir_personal_laws for all using (public.choir_is_admin()) with check (public.choir_is_admin());
drop policy if exists "past members public read" on public.past_members;
create policy "past members public read" on public.past_members for select using (true);
drop policy if exists "past members admin write" on public.past_members;
create policy "past members admin write" on public.past_members for all using (public.choir_is_admin()) with check (public.choir_is_admin());

-- Storage for compressed selfies (up to 1 MB limit).
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('choir-selfies','choir-selfies',false,1048576,array['image/jpeg','image/png'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists "choir selfie own upload" on storage.objects;
create policy "choir selfie own upload" on storage.objects for insert to authenticated with check (bucket_id = 'choir-selfies' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "choir selfie own read" on storage.objects;
create policy "choir selfie own read" on storage.objects for select to authenticated using (bucket_id = 'choir-selfies' and ((storage.foldername(name))[1] = auth.uid()::text or public.choir_is_admin()));
drop policy if exists "choir selfie public view" on storage.objects;
create policy "choir selfie public view" on storage.objects for select using (bucket_id = 'choir-selfies');
drop policy if exists "choir selfie own update" on storage.objects;
create policy "choir selfie own update" on storage.objects for update to authenticated using (bucket_id = 'choir-selfies' and (storage.foldername(name))[1] = auth.uid()::text) with check (bucket_id = 'choir-selfies' and (storage.foldername(name))[1] = auth.uid()::text);

-- After the church admin signs up normally, promote their account once (password is never stored in SQL):
-- update public.choir_profiles set role='admin', status='approved' where email='sugamprathanabhawan@gmail.com';
