-- ==============================================================================
-- SUGAM CHOIR PORTAL - UNIFIED SYSTEM REPAIR & MIGRATION SCRIPT
-- ==============================================================================
-- Run this script once in your Supabase SQL Editor:
-- https://supabase.com/dashboard/project/_/sql
--
-- This script fixes:
-- 1. ERROR 42P13: Drops existing function overloads and previous return type signatures
-- 2. HTTP 300 / PGRST203 candidate function overload on choir_mark_missing_attendance
-- 3. Working month persistence, type mapping (integer vs smallint), and auto-seeding
-- 4. choir_member_history_current view (fixes member duplication on MemHistory.html)
-- 5. Public selfie storage bucket permissions for MemHistory.html
-- 6. Profile self-update RLS policy and role/status privilege escalation protection
-- 7. Administrator member status update RPC (choir_admin_update_member_status)
-- 8. Canonical choir_rebuild_aggregate() calculation (present Saturdays streak, manual bonus)
-- ==============================================================================

-- 0. Helper: choir_is_admin()
drop function if exists public.choir_is_admin() cascade;
drop function if exists public.choir_is_admin cascade;

create or replace function public.choir_is_admin()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.choir_profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

grant execute on function public.choir_is_admin() to authenticated, anon;

-- 0B. Ensure choir_attendance_stack allows point in (-1, 0, 1) for on-time bonuses
alter table public.choir_attendance_stack drop constraint if exists choir_attendance_stack_point_check;
alter table public.choir_attendance_stack add constraint choir_attendance_stack_point_check check (point in (-1, 0, 1));

-- 0C. Partial Unique Index for regular Saturday attendance
-- Prevents duplicate Saturday submissions while allowing multiple manual adjustments and bonus points
alter table public.choir_attendance_stack drop constraint if exists choir_attendance_stack_user_id_datefilled_key;
drop index if exists public.choir_attendance_stack_regular_unique_idx;

create unique index if not exists choir_attendance_stack_regular_unique_idx
  on public.choir_attendance_stack (user_id, datefilled)
  where attendance_status in ('present', 'absent', 'not_filled');

-- 1. Ensure choir_months table exists and is seeded
create table if not exists public.choir_months (
  id uuid primary key default gen_random_uuid(),
  month_name text not null unique check (length(trim(month_name)) > 0),
  working_days smallint not null check (working_days between 1 and 6),
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Seed choir_months from choir_settings if empty
insert into public.choir_months (month_name, working_days, is_active)
select coalesce(month_name, 'Baisakh'), coalesce(working_days, 4)::smallint, true
from public.choir_settings where id = 1
on conflict (month_name) do nothing;

-- 2. Ensure choir_settings singleton exists
create table if not exists public.choir_settings (
  id smallint primary key default 1 check (id = 1),
  month_name text not null default 'Baisakh',
  working_days smallint not null default 4 check (working_days between 1 and 6),
  updated_at timestamptz not null default now()
);

insert into public.choir_settings (id, month_name, working_days)
values (1, 'Baisakh', 4)
on conflict (id) do update set updated_at = now();

-- 3. Resolve PGRST203 & 42P13: Drop all overloaded candidate functions for choir_mark_missing_attendance
drop function if exists public.choir_mark_missing_attendance() cascade;
drop function if exists public.choir_mark_missing_attendance(date) cascade;
drop function if exists public.choir_mark_missing_attendance(date, uuid) cascade;
drop function if exists public.choir_mark_missing_attendance cascade;

create or replace function public.choir_mark_missing_attendance(
  p_date date default null,
  p_user_id uuid default null
)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  target_date date;
  target_npt timestamptz;
  active_m text;
  inserted_count integer := 0;
  prof record;
  already_holidays integer;
  assigned_point smallint;
  assigned_holiday smallint;
begin
  if p_date is null then
    -- Default to the most recent Saturday in Nepal time
    target_date := (now() at time zone 'Asia/Kathmandu')::date - (((extract(isodow from (now() at time zone 'Asia/Kathmandu')::date)::integer + 1) % 7))::integer;
  else
    target_date := p_date;
  end if;

  if extract(isodow from target_date) <> 6 then
    raise exception 'Missing attendance can only be recorded for Saturdays.';
  end if;

  target_npt := (target_date::text || ' 23:00:00')::timestamp at time zone 'Asia/Kathmandu';
  if (now() at time zone 'Asia/Kathmandu') < target_npt then
    raise exception 'Missing attendance can only be marked after Saturday 11:00 PM Nepal time.';
  end if;

  -- Select active month for this specific Saturday if attendance already exists, otherwise from settings
  select month_name into active_m from public.choir_attendance_stack
  where datefilled = target_date and month_name is not null limit 1;

  if active_m is null then
    select month_name into active_m from public.choir_settings where id = 1;
  end if;

  for prof in
    select p.id, p.full_name, p.symbolnum
    from public.choir_profiles p
    where p.status = 'approved'
      and (p_user_id is null or p.id = p_user_id)
      and not exists (
        select 1 from public.choir_attendance_stack s
        where s.user_id = p.id
          and s.datefilled = target_date
          and s.attendance_status in ('present', 'absent', 'not_filled')
      )
  loop
    select count(*) into already_holidays
    from public.choir_attendance_stack s
    where s.user_id = prof.id
      and s.month_name = active_m
      and s.holiday_used = 1;

    if already_holidays = 0 then
      assigned_point := 0;
      assigned_holiday := 1;
    else
      assigned_point := 1;
      assigned_holiday := 1;
    end if;

    insert into public.choir_attendance_stack (
      user_id, symbol, datefilled, month_name, name, reason,
      time_filled, point, holiday_used, attendance_on_time, attendance_status
    ) values (
      prof.id,
      prof.symbolnum,
      target_date,
      active_m,
      prof.full_name,
      'Absent (No form submitted before deadline)',
      target_npt,
      assigned_point,
      assigned_holiday,
      0,
      'not_filled'
    );

    inserted_count := inserted_count + 1;
  end loop;

  if inserted_count > 0 then
    perform public.choir_rebuild_aggregate();
  end if;

  return inserted_count;
end;
$$;

grant execute on function public.choir_mark_missing_attendance(date, uuid) to authenticated;

-- 4. Canonical choir_rebuild_aggregate function
drop function if exists public.choir_rebuild_aggregate() cascade;
drop function if exists public.choir_rebuild_aggregate cascade;

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

  delete from public.choir_attendance_aggregate
  where user_id not in (select id from public.choir_profiles where status = 'approved');
end;
$$;

grant execute on function public.choir_rebuild_aggregate() to authenticated, anon;

-- 5. RPC: choir_admin_add_month (Drop first to avoid 42P13 return type conflicts)
drop function if exists public.choir_admin_add_month(text, integer, boolean) cascade;
drop function if exists public.choir_admin_add_month(text, smallint, boolean) cascade;
drop function if exists public.choir_admin_add_month(text, integer) cascade;
drop function if exists public.choir_admin_add_month(text, smallint) cascade;
drop function if exists public.choir_admin_add_month cascade;

create or replace function public.choir_admin_add_month(
  p_month text,
  p_working_days integer,
  p_set_active boolean default false
)
returns void language plpgsql security definer set search_path = public as $$
declare
  clean_month text := trim(coalesce(p_month, ''));
begin
  if not public.choir_is_admin() then
    raise exception 'Administrator access required.';
  end if;
  if length(clean_month) = 0 then
    raise exception 'Month name cannot be blank.';
  end if;
  if p_working_days < 1 or p_working_days > 6 then
    raise exception 'Working days must be between 1 and 6.';
  end if;

  if p_set_active then
    update public.choir_months set is_active = false where is_active = true;
  end if;

  insert into public.choir_months (month_name, working_days, is_active, updated_at)
  values (clean_month, p_working_days::smallint, p_set_active, now())
  on conflict (month_name) do update
  set working_days = excluded.working_days,
      is_active = case when p_set_active then true else choir_months.is_active end,
      updated_at = now();

  if p_set_active then
    update public.choir_settings
    set month_name = clean_month,
        working_days = p_working_days::smallint,
        updated_at = now()
    where id = 1;
    perform public.choir_rebuild_aggregate();
  end if;
end;
$$;

grant execute on function public.choir_admin_add_month(text, integer, boolean) to authenticated;

-- 6. RPC: choir_admin_set_active_month (Drop first to avoid 42P13 return type conflicts)
drop function if exists public.choir_admin_set_active_month(text) cascade;
drop function if exists public.choir_admin_set_active_month cascade;

create or replace function public.choir_admin_set_active_month(p_month text)
returns void language plpgsql security definer set search_path = public as $$
declare
  target_month public.choir_months;
begin
  if not public.choir_is_admin() then
    raise exception 'Administrator access required.';
  end if;

  select * into target_month from public.choir_months where month_name = trim(p_month);
  if not found then
    raise exception 'Month "%" does not exist in choir_months.', p_month;
  end if;

  update public.choir_months set is_active = false where is_active = true;
  update public.choir_months set is_active = true, updated_at = now() where id = target_month.id;

  update public.choir_settings
  set month_name = target_month.month_name,
      working_days = target_month.working_days,
      updated_at = now()
  where id = 1;

  perform public.choir_rebuild_aggregate();
end;
$$;

grant execute on function public.choir_admin_set_active_month(text) to authenticated;

-- 7. RPC: choir_admin_delete_month (Drop first to avoid 42P13 return type conflicts)
drop function if exists public.choir_admin_delete_month(text) cascade;
drop function if exists public.choir_admin_delete_month cascade;

create or replace function public.choir_admin_delete_month(p_month text)
returns void language plpgsql security definer set search_path = public as $$
declare
  m public.choir_months;
begin
  if not public.choir_is_admin() then
    raise exception 'Administrator access required.';
  end if;

  select * into m from public.choir_months where month_name = trim(p_month);
  if not found then
    return;
  end if;
  if m.is_active then
    raise exception 'Cannot delete the active working month. Please set another month active first.';
  end if;

  delete from public.choir_months where id = m.id;
end;
$$;

grant execute on function public.choir_admin_delete_month(text) to authenticated;

-- 8. RPC: choir_admin_update_member_status (Allows Admin to Approve, Deactivate, or Reject members)
drop function if exists public.choir_admin_update_member_status(uuid, text) cascade;
drop function if exists public.choir_admin_update_member_status cascade;

create or replace function public.choir_admin_update_member_status(
  p_user_id uuid,
  p_status text
)
returns public.choir_profiles language plpgsql security definer set search_path = public as $$
declare
  updated_profile public.choir_profiles;
begin
  if not public.choir_is_admin() then
    raise exception 'Administrator access required.';
  end if;
  if p_status not in ('approved', 'rejected', 'deactivated', 'pending') then
    raise exception 'Invalid member status: %', p_status;
  end if;

  update public.choir_profiles
  set status = p_status, updated_at = now()
  where id = p_user_id
  returning * into updated_profile;

  if not found then
    raise exception 'Member not found.';
  end if;

  perform public.choir_rebuild_aggregate();
  return updated_profile;
end;
$$;

grant execute on function public.choir_admin_update_member_status(uuid, text) to authenticated;

-- 8B. RPC: choir_submit_attendance (Guarantees absent members are never awarded on-time credits)
drop function if exists public.choir_submit_attendance(text, text, text) cascade;
drop function if exists public.choir_submit_attendance cascade;

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
    v_on_time := case when p_status = 'present' then 1 else 0 end;
    v_holiday := case when p_status = 'absent' then 1 else 0 end;
    v_point := case when p_status = 'absent' and already_holidays > 0 then 1 else 0 end;
  else
    v_on_time := 0;
    v_holiday := 1;
    v_point := case when already_holidays > 0 then 1 else 0 end;
  end if;

  select month_name into active_month from public.choir_settings where id = 1;

  insert into public.choir_attendance_stack (
    user_id, symbol, datefilled, month_name, name, reason,
    time_filled, point, holiday_used, attendance_on_time, attendance_status
  ) values (
    p.id, p.symbolnum, npt_date, active_month, p.full_name,
    nullif(trim(p_reason),''), now(), v_point, v_holiday, v_on_time, p_status
  )
  returning * into outrow;

  perform public.choir_rebuild_aggregate();
  return outrow;
end;
$$;

grant execute on function public.choir_submit_attendance(text, text, text) to authenticated;

-- 9. Views: choir_member_history_current (Selecting directly from approved choir_profiles to prevent duplication)
drop view if exists public.choir_member_history_current cascade;

create or replace view public.choir_member_history_current as
select
  p.id as user_id,
  p.full_name as name,
  p.selfie_path
from public.choir_profiles p
where p.status = 'approved';

grant select on public.choir_member_history_current to anon, authenticated;

-- 10. Storage bucket: choir-selfies public access & policies
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('choir-selfies', 'choir-selfies', true, 1048576, array['image/jpeg', 'image/png'])
on conflict (id) do update set
  public = true,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "choir selfie own upload" on storage.objects;
create policy "choir selfie own upload" on storage.objects for insert to authenticated
with check (bucket_id = 'choir-selfies' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "choir selfie own update" on storage.objects;
create policy "choir selfie own update" on storage.objects for update to authenticated
using (bucket_id = 'choir-selfies' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "choir selfie own delete" on storage.objects;
create policy "choir selfie own delete" on storage.objects for delete to authenticated
using (bucket_id = 'choir-selfies' and ((storage.foldername(name))[1] = auth.uid()::text or public.choir_is_admin()));

drop policy if exists "choir selfie public read" on storage.objects;
create policy "choir selfie public read" on storage.objects for select to public
using (bucket_id = 'choir-selfies');

-- 11. Profile security: RLS and privilege escalation defense
drop policy if exists "choir profile self read" on public.choir_profiles;
create policy "choir profile self read" on public.choir_profiles for select using (id = auth.uid() or public.choir_is_admin());

drop policy if exists "choir profile self update" on public.choir_profiles;
create policy "choir profile self update" on public.choir_profiles for update using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "choir profile admin update" on public.choir_profiles;
create policy "choir profile admin update" on public.choir_profiles for update using (public.choir_is_admin()) with check (public.choir_is_admin());

drop trigger if exists choir_protect_profile_trigger on public.choir_profiles;
drop function if exists public.choir_protect_profile_fields() cascade;
drop function if exists public.choir_protect_profile_fields cascade;

create or replace function public.choir_protect_profile_fields()
returns trigger language plpgsql security definer as $$
begin
  if not public.choir_is_admin() then
    new.role := old.role;
    new.status := old.status;
  end if;
  return new;
end;
$$;

create trigger choir_protect_profile_trigger before update on public.choir_profiles
for each row execute function public.choir_protect_profile_fields();

alter table public.choir_profiles drop constraint if exists choir_profiles_role_check;
alter table public.choir_profiles add constraint choir_profiles_role_check check (role in ('user', 'admin', 'member'));

-- 12. Helper: choir_is_approved()
create or replace function public.choir_is_approved()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.choir_profiles where id = auth.uid() and status = 'approved');
$$;

grant execute on function public.choir_is_approved() to authenticated;

-- 13. Table: choir_bonus_reviews (Tracks Valid -1 and Exclude statuses)
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

-- 14. Streak Calculation & RPC: choir_get_member_streaks
create or replace function public.choir_calculate_user_streak(p_user_id uuid, p_active_sat date default null)
returns integer language sql stable set search_path = public as $$
  select coalesce(count(*)::integer, 0)
  from public.choir_attendance_stack
  where user_id = p_user_id
    and attendance_status = 'present'
    and datefilled <= coalesce(p_active_sat, (now() at time zone 'Asia/Kathmandu')::date);
$$;

grant execute on function public.choir_calculate_user_streak(uuid, date) to authenticated;

create or replace function public.choir_get_member_streaks()
returns table (
  user_id uuid,
  streak integer
) language sql security definer set search_path = public as $$
  select p.id as user_id,
         coalesce(count(s.id) filter (where s.attendance_status = 'present' and s.datefilled <= (now() at time zone 'Asia/Kathmandu')::date), 0)::integer as streak
  from public.choir_profiles p
  left join public.choir_attendance_stack s on s.user_id = p.id
  where p.status = 'approved'
  group by p.id;
$$;

grant execute on function public.choir_get_member_streaks() to authenticated;

-- 15. Admin Bonus RPCs: choir_admin_award_bonus & choir_admin_exclude_bonus
drop function if exists public.choir_admin_award_bonus(uuid, text) cascade;
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

drop function if exists public.choir_admin_exclude_bonus(uuid, text) cascade;
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

-- 16. Admin Tools: Delete Stack Row, Add Manual Points, and Symbol/Selfie helpers
drop function if exists public.choir_admin_delete_stack_row(uuid) cascade;
create or replace function public.choir_admin_delete_stack_row(p_stack_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.choir_is_admin() then raise exception 'Administrator access required.'; end if;
  delete from public.choir_attendance_stack where id = p_stack_id;
end;
$$;

grant execute on function public.choir_admin_delete_stack_row(uuid) to authenticated;

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

grant execute on function public.choir_sync_missing_symbols() to authenticated;

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

-- 17. Permissive read RLS policies on choir_attendance_stack and choir_attendance_aggregate
alter table public.choir_attendance_stack enable row level security;
drop policy if exists "choir stack self or admin read" on public.choir_attendance_stack;
drop policy if exists "choir stack approved read" on public.choir_attendance_stack;
create policy "choir stack approved read" on public.choir_attendance_stack
for select using (
  user_id = auth.uid()
  or public.choir_is_admin()
  or public.choir_is_approved()
);

alter table public.choir_attendance_aggregate enable row level security;
drop policy if exists "choir aggregate self or admin read" on public.choir_attendance_aggregate;
drop policy if exists "choir aggregate approved read" on public.choir_attendance_aggregate;
create policy "choir aggregate approved read" on public.choir_attendance_aggregate
for select using (
  user_id = auth.uid()
  or public.choir_is_admin()
  or public.choir_is_approved()
);

-- 18. Run initial aggregate rebuild
select public.choir_rebuild_aggregate();

