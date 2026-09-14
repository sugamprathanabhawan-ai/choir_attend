-- ==============================================================================
-- SUGAM CHOIR PORTAL: FEATURE ALTERATIONS & ADMIN ENHANCEMENTS MIGRATION
-- ==============================================================================
-- Run this script in your Supabase project's SQL Editor:
-- https://supabase.com/dashboard/project/_/sql
--
-- Features & Reliability Fixes:
-- 1. Alter choir_attendance_stack constraint: allow point in (-1, 0, 1).
-- 2. Partial Unique Index: Replace UNIQUE(user_id, datefilled) with a partial index
--    only for regular attendance ('present', 'absent', 'not_filled'). This allows
--    on-time bonuses (-1 pt) and multiple manual adjustments without collision.
-- 3. Create choir_months table for N-month configuration with working days.
-- 4. Create choir_bonus_reviews table to track Valid (-1) / Exclude states.
-- 5. Add RPCs: choir_admin_award_bonus, choir_admin_exclude_bonus.
-- 6. Missing attendance assignment: supports single-member & batch assignment with
--    11:00 PM Saturday cutoff protection to prevent locking members out early.
-- 7. Non-destructive aggregate upsert: eliminates blank table screen flashes & deadlocks.
-- 8. Storage bucket policy: allows public view of selfies for MemHistory.html.
-- ==============================================================================

-- 1. Allow point = -1 in choir_attendance_stack
alter table public.choir_attendance_stack drop constraint if exists choir_attendance_stack_point_check;
alter table public.choir_attendance_stack add constraint choir_attendance_stack_point_check check (point in (-1, 0, 1));

-- 2. Partial Unique Index for regular Saturday attendance
-- Prevents duplicate Saturday submissions while allowing multiple manual adjustments and bonus points
alter table public.choir_attendance_stack drop constraint if exists choir_attendance_stack_user_id_datefilled_key;
drop index if exists public.choir_attendance_stack_regular_unique_idx;

create unique index if not exists choir_attendance_stack_regular_unique_idx
  on public.choir_attendance_stack (user_id, datefilled)
  where attendance_status in ('present', 'absent', 'not_filled');

-- 3. Create choir_months table to manage N number of working months
create table if not exists public.choir_months (
  id uuid primary key default gen_random_uuid(),
  month_name text not null unique,
  working_days smallint not null check (working_days between 1 and 6),
  is_active boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.choir_months enable row level security;
drop policy if exists "choir months authenticated read" on public.choir_months;
create policy "choir months authenticated read" on public.choir_months for select to authenticated using (true);
drop policy if exists "choir months admin write" on public.choir_months;
create policy "choir months admin write" on public.choir_months for all using (public.choir_is_admin()) with check (public.choir_is_admin());

-- Seed initial month from choir_settings
insert into public.choir_months (month_name, working_days, is_active)
select s.month_name, s.working_days, true
from public.choir_settings s where s.id = 1
on conflict (month_name) do update set is_active = true;

-- 4. Create choir_bonus_reviews table to track Valid (-1) / Exclude status
create table if not exists public.choir_bonus_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.choir_profiles(id) on delete cascade,
  month_name text not null,
  status text not null check (status in ('eligible', 'validated', 'excluded')),
  stack_id uuid references public.choir_attendance_stack(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (user_id, month_name)
);

alter table public.choir_bonus_reviews enable row level security;
drop policy if exists "choir bonus reviews authenticated read" on public.choir_bonus_reviews;
create policy "choir bonus reviews authenticated read" on public.choir_bonus_reviews for select to authenticated using (true);
drop policy if exists "choir bonus reviews admin write" on public.choir_bonus_reviews;
create policy "choir bonus reviews admin write" on public.choir_bonus_reviews for all using (public.choir_is_admin()) with check (public.choir_is_admin());

-- 5. Function: Calculate streak as total present Saturdays till date
create or replace function public.choir_calculate_user_streak(p_user_id uuid, p_active_sat date default null)
returns integer language sql stable set search_path = public as $$
  select coalesce(count(*)::integer, 0)
  from public.choir_attendance_stack
  where user_id = p_user_id
    and attendance_status = 'present';
$$;

-- Security-definer RPC function to fetch streak for all approved members
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

-- 6. Stored Procedure: Rebuild aggregate WITHOUT automatic -1 bonus
-- Uses atomic UPSERT on conflict to prevent table locks and blank screen flashes
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

-- 7. RPC: Valid button for on-time bonus (-1 point)
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

-- 8. RPC: Exclude button for on-time bonus
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

-- 9. Enhanced missing attendance assignment: Supports single member or batch
-- Prevents marking missing for today before 11:00 PM cutoff so members are never locked out
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

-- 10. RPCs for Multi-Month Management
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

-- 11. Allow public view on choir-selfies storage so MemHistory.html loads without 403, and update file size limit
update storage.buckets
set file_size_limit = 1048576,
    allowed_mime_types = array['image/jpeg', 'image/png']
where id = 'choir-selfies';

drop policy if exists "choir selfie public view" on storage.objects;
create policy "choir selfie public view" on storage.objects for select using (bucket_id = 'choir-selfies');

-- 12. Ensure past_members table exists and grants are active for public directory
create table if not exists public.past_members (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  service_time text,
  profile_pic_url text,
  details text,
  display_order integer default 0,
  created_at timestamptz not null default now()
);

alter table public.past_members enable row level security;
drop policy if exists "past members public read" on public.past_members;
create policy "past members public read" on public.past_members for select using (true);
drop policy if exists "past members admin write" on public.past_members;
create policy "past members admin write" on public.past_members for all using (public.choir_is_admin()) with check (public.choir_is_admin());

grant select on public.choir_member_history_current to anon, authenticated;
grant select on public.past_members to anon, authenticated;

-- 13. Admin Tools: Delete Stack Row, Add Manual Points, and Symbol Sync
create or replace function public.choir_admin_delete_stack_row(p_stack_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.choir_is_admin() then raise exception 'Administrator access required.'; end if;
  delete from public.choir_attendance_stack where id = p_stack_id;
end;
$$;
grant execute on function public.choir_admin_delete_stack_row(uuid) to authenticated;

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
grant execute on function public.choir_admin_add_manual_points(uuid, integer) to authenticated;

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
create or replace function public.choir_symbol_available(p_symbol text)
returns boolean language sql stable security definer set search_path = public as $$
  select not exists (
    select 1 from public.choir_profiles where lower(trim(symbolnum)) = lower(trim(p_symbol))
  );
$$;
grant execute on function public.choir_symbol_available(text) to authenticated, anon;

create or replace function public.choir_save_selfie(p_path text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_path !~ ('^' || auth.uid()::text || '/selfie\\.jpg$') then
    raise exception 'Invalid selfie path.';
  end if;
  update public.choir_profiles set selfie_path = p_path where id = auth.uid();
end;
$$;
grant execute on function public.choir_save_selfie(text) to authenticated;

create or replace function public.choir_submit_attendance(p_symbol text, p_status text, p_reason text default null)
returns public.choir_attendance_stack language plpgsql security definer set search_path = public as $$
declare
  p public.choir_profiles;
  npt timestamptz := now() at time zone 'Asia/Kathmandu';
  npt_date date := (now() at time zone 'Asia/Kathmandu')::date;
  npt_time time := (now() at time zone 'Asia/Kathmandu')::time;
  already_holidays integer;
  outrow public.choir_attendance_stack;
  active_month text;
  v_point smallint;
  v_holiday smallint;
  v_on_time smallint;
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
grant execute on function public.choir_submit_attendance(text, text, text) to authenticated;

-- 14. Rebuild aggregate table immediately
select public.choir_rebuild_aggregate();

