-- Run this script in your Supabase project's SQL Editor:
-- https://supabase.com/dashboard/project/_/sql

-- 1. Update choir_rebuild_aggregate to:
--    a. Calculate total_points till date (all-time).
--    b. When working month days == on-time points, aggregate point -1 occurs (perfect on-time attendance bonus).
--    c. Track active month's holidays used and on-time count.
create or replace function public.choir_rebuild_aggregate()
returns void language plpgsql security definer set search_path = public as $$
declare
  active_month text;
  active_working_days smallint;
  today_npt date := (now() at time zone 'Asia/Kathmandu')::date;
begin
  select month_name, working_days into active_month, active_working_days from public.choir_settings where id = 1;
  delete from public.choir_attendance_aggregate where user_id is not null;
  insert into public.choir_attendance_aggregate
    (user_id, name, email, symbolnum, phone_num, total_points, total_holiday_used, total_attendance_on_time)
  select
    p.id,
    p.full_name,
    p.email,
    p.symbolnum,
    p.phone_num,
    (coalesce(sum(s.point) filter (where s.datefilled <= today_npt), 0)
      - case when coalesce(sum(s.attendance_on_time) filter (where s.month_name = active_month), 0) >= coalesce(active_working_days, 4) then 1 else 0 end) as total_points,
    coalesce(sum(s.holiday_used) filter (where s.month_name = active_month), 0) as total_holiday_used,
    coalesce(sum(s.attendance_on_time) filter (where s.month_name = active_month), 0) as total_attendance_on_time
  from public.choir_profiles p
  left join public.choir_attendance_stack s on s.user_id = p.id
  where p.status = 'approved'
  group by p.id, p.full_name, p.email, p.symbolnum, p.phone_num;
end;
$$;

-- 2. Ensure missing attendance after Saturday 11:00 PM auto-assigns points on rule basis:
--    - 0 holidays used in active month -> point = 0, holiday_used = 1
--    - >0 holidays used in active month -> point = 1, holiday_used = 1
create or replace function public.choir_mark_missing_attendance(p_date date default null)
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

  if npt_date = (npt_now)::date and (npt_now)::time < time '23:00' then
    raise exception 'Missing attendance can only be marked after 11:00 PM Nepal time on Saturday.';
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
    and not exists (
      select 1 from public.choir_attendance_stack s
      where s.user_id = p.id and s.datefilled = npt_date
    );

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

-- 3. Update RLS policy so all approved choir members can view the choir Statistics table
drop policy if exists "choir aggregate self or admin read" on public.choir_attendance_aggregate;
drop policy if exists "choir aggregate approved read" on public.choir_attendance_aggregate;

create policy "choir aggregate approved read" on public.choir_attendance_aggregate
for select using (
  user_id = auth.uid()
  or public.choir_is_admin()
  or exists (
    select 1 from public.choir_profiles
    where id = auth.uid() and status = 'approved'
  )
);

-- 4. Rebuild aggregate table now
select public.choir_rebuild_aggregate();
