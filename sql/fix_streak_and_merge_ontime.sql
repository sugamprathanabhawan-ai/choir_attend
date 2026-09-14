-- ==============================================================================
-- SUGAM CHOIR PORTAL: FIX STREAK VISIBILITY & ON-TIME DATA FOR ALL MEMBERS
-- ==============================================================================
-- Run this script in your Supabase project's SQL Editor:
-- https://supabase.com/dashboard/project/_/sql
--
-- What this script accomplishes:
-- 1. Adds on_time_streak column to choir_attendance_aggregate.
-- 2. Creates choir_calculate_user_streak() to compute gap-free Saturday streaks.
-- 3. Creates choir_get_member_streaks() security-definer RPC function so all
--    approved members can fetch streaks directly.
-- 4. Updates choir_rebuild_aggregate() to persist on_time_streak in the aggregate table.
-- 5. Updates RLS policy on choir_attendance_stack so all approved choir members
--    can read attendance records, ensuring non-admin members see streaks too.
-- ==============================================================================

-- 1. Ensure on_time_streak column exists in choir_attendance_aggregate
alter table public.choir_attendance_aggregate
add column if not exists on_time_streak integer default 0;

-- 2. Function to compute a single member's unbroken continuous on-time streak
create or replace function public.choir_calculate_user_streak(p_user_id uuid, p_active_sat date)
returns integer language plpgsql stable set search_path = public as $$
declare
  v_streak integer := 0;
  v_prev_date date := null;
  v_rec record;
  v_days_since_active integer;
  v_first boolean := true;
begin
  for v_rec in
    select datefilled, attendance_on_time
    from public.choir_attendance_stack
    where user_id = p_user_id
      and attendance_status <> 'manual'
      and datefilled <= p_active_sat
    order by datefilled desc
  loop
    if v_first then
      v_first := false;
      v_days_since_active := p_active_sat - v_rec.datefilled;
      -- If most recent record was late or absent, streak is 0
      if coalesce(v_rec.attendance_on_time, 0) <> 1 then
        return 0;
      end if;
      -- If most recent record is older than previous Saturday (>7 days), streak expired
      if v_days_since_active > 7 then
        return 0;
      end if;
      v_streak := 1;
      v_prev_date := v_rec.datefilled;
    else
      -- If late or absent, streak is broken
      if coalesce(v_rec.attendance_on_time, 0) <> 1 then
        exit;
      end if;
      -- If gap between Saturdays > 7 days, streak is broken
      if (v_prev_date - v_rec.datefilled) > 7 then
        exit;
      end if;
      v_streak := v_streak + 1;
      v_prev_date := v_rec.datefilled;
    end if;
  end loop;

  return v_streak;
end;
$$;

-- 3. Security-definer RPC function to fetch active streaks for all approved members
create or replace function public.choir_get_member_streaks()
returns table (
  user_id uuid,
  streak integer
) language plpgsql security definer set search_path = public as $$
declare
  npt_now timestamptz := now() at time zone 'Asia/Kathmandu';
  active_sat date;
  p_rec record;
begin
  -- Calculate active Saturday in Nepal time
  active_sat := (npt_now)::date - (((extract(isodow from (npt_now)::date)::integer + 1) % 7))::integer;

  for p_rec in
    select id from public.choir_profiles where status = 'approved'
  loop
    user_id := p_rec.id;
    streak := public.choir_calculate_user_streak(p_rec.id, active_sat);
    return next;
  end loop;
end;
$$;

-- Grant execution to authenticated users
grant execute on function public.choir_get_member_streaks() to authenticated;

-- 4. Update choir_rebuild_aggregate to calculate and store on_time_streak
create or replace function public.choir_rebuild_aggregate()
returns void language plpgsql security definer set search_path = public as $$
declare
  active_month text;
  active_working_days smallint;
  npt_now timestamptz := now() at time zone 'Asia/Kathmandu';
  today_npt date := (npt_now)::date;
  active_sat date := (npt_now)::date - (((extract(isodow from (npt_now)::date)::integer + 1) % 7))::integer;
begin
  select month_name, working_days into active_month, active_working_days from public.choir_settings where id = 1;
  delete from public.choir_attendance_aggregate where user_id is not null;
  insert into public.choir_attendance_aggregate
    (user_id, name, email, symbolnum, phone_num, total_points, total_holiday_used, total_attendance_on_time, on_time_streak)
  select
    p.id,
    p.full_name,
    p.email,
    p.symbolnum,
    p.phone_num,
    (coalesce(sum(s.point) filter (where s.datefilled <= today_npt), 0)
      - case when coalesce(sum(s.attendance_on_time) filter (where s.month_name = active_month), 0) >= coalesce(active_working_days, 4) then 1 else 0 end) as total_points,
    coalesce(sum(s.holiday_used) filter (where s.month_name = active_month), 0) as total_holiday_used,
    coalesce(sum(s.attendance_on_time) filter (where s.month_name = active_month), 0) as total_attendance_on_time,
    public.choir_calculate_user_streak(p.id, active_sat) as on_time_streak
  from public.choir_profiles p
  left join public.choir_attendance_stack s on s.user_id = p.id
  where p.status = 'approved'
  group by p.id, p.full_name, p.email, p.symbolnum, p.phone_num;
end;
$$;

-- 5. Helper function and RLS policies
-- Security-definer helper to check if the current user is an approved choir member
create or replace function public.choir_is_approved()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.choir_profiles where id = auth.uid() and status = 'approved');
$$;

grant execute on function public.choir_is_approved() to authenticated;

alter table public.choir_attendance_stack enable row level security;

drop policy if exists "choir stack self or admin read" on public.choir_attendance_stack;
drop policy if exists "choir stack approved read" on public.choir_attendance_stack;

create policy "choir stack approved read" on public.choir_attendance_stack
for select using (
  user_id = auth.uid()
  or public.choir_is_admin()
  or public.choir_is_approved()
);

-- Ensure aggregate read policy allows approved members as well
drop policy if exists "choir aggregate self or admin read" on public.choir_attendance_aggregate;
drop policy if exists "choir aggregate approved read" on public.choir_attendance_aggregate;

create policy "choir aggregate approved read" on public.choir_attendance_aggregate
for select using (
  user_id = auth.uid()
  or public.choir_is_admin()
  or public.choir_is_approved()
);

-- 6. Trigger immediate rebuild of aggregate table with streaks populated
select public.choir_rebuild_aggregate();
