# Sugam Choir Portal — System Architecture & Developer Reference

> **Important**: This document serves as the master specification for the Sugam Choir Portal. Any future enhancements, refactoring, or database changes must adhere to the rules and patterns documented here.

---

## 1. System Overview

The **Sugam Choir Portal** is a member portal and administration board designed for church choir management.

### Tech Stack
- **Frontend**: Vanilla JavaScript (ES Modules), HTML5, Tailwind CSS (via CDN) with pure light mode, crisp black fonts, and butter-smooth responsive UI.
- **Backend / Database**: Supabase PostgreSQL, Supabase Auth, and Supabase Storage (private selfie bucket `choir-selfies`).
- **Automation / Companion**: Google Apps Script bound to a Google Sheet, executing scheduled time triggers and bi-directional data synchronisation.
- **Timezone Standard**: **Nepal Time (`Asia/Kathmandu` / UTC+5:45)** is used strictly across the frontend, PostgreSQL functions, and Apps Script. **No client clocks are trusted for attendance rules.**

---

## 2. Core Business Logic & Attendance Rules

All attendance calculations, timestamps, and point assessments are strictly enforced inside PostgreSQL (`sql/choir_portal_setup.sql`), ensuring tamper-proof integrity.

### 2.1 Operating Windows
- **Attendance Opening**: Saturdays only, from **03:00 AM to 11:00 PM Nepal Time**.
- **On-Time Cutoff**: **09:50 AM Nepal Time**. Submissions at or before 09:50 AM count as on-time.

### 2.2 Point & Flag Structure
Every record in `choir_attendance_stack` tracks:
- `point` (0 or 1 penalty point)
- `holiday_used` (0 or 1 holiday flag)
- `attendance_on_time` (0 or 1 on-time flag)
- `attendance_status` (`'present'`, `'absent'`, `'not_filled'`, or `'manual'`)

### 2.3 Attendance Rule Matrix
| Submission Time | Status Selected | Point | Holiday Used | On Time | Notes |
| :--- | :--- | :---: | :---: | :---: | :--- |
| **≤ 09:50 AM** | Present | **0** | **0** | **1** | On time, no points, no holiday consumed. |
| **≤ 09:50 AM** | Absent (1st of month) | **0** | **1** | **1** | Consumes the single free holiday for the month. |
| **≤ 09:50 AM** | Absent (Holiday already used) | **1** | **1** | **1** | 1 penalty point because holiday was already used. |
| **> 09:50 AM (Late)** | Present (1st late/holiday of month) | **0** | **1** | **0** | Consumes the monthly free holiday. |
| **> 09:50 AM (Late)** | Present (Holiday already used) | **1** | **1** | **0** | 1 penalty point because holiday was already used. |
| **> 09:50 AM (Late)** | Absent (1st late/holiday of month) | **0** | **1** | **0** | Consumes the monthly free holiday. |
| **> 09:50 AM (Late)** | Absent (Holiday already used) | **1** | **1** | **0** | 1 penalty point because holiday was already used. |

### 2.4 Missing Attendance Auto-Assignment (Rule Basis)
Approved members who **did not submit** attendance by Saturday 11:00 PM are auto-marked via `choir_mark_missing_attendance()`:
- **Status**: `attendance_status = 'not_filled'`
- **Reason**: `'No form submitted'`
- **Rule evaluation**:
  - If member has **0** holidays used in the active month: `point = 0, holiday_used = 1, attendance_on_time = 0` (uses free holiday).
  - If member has **>0** holidays used in the active month: `point = 1, holiday_used = 1, attendance_on_time = 0` (incurs 1 penalty point).
- **Execution**: Triggered automatically by Google Apps Script at 11:01 PM Saturdays, and also checked whenever the administrator opens/refreshes the admin board after Saturday 11:00 PM or on Sunday.

### 2.5 Perfect On-Time Bonus Validation (`-1` Point Awarded Deliberately)
- The automatic `-1` deduction from total points when `ontime >= working_days` has been **removed** from automatic recalculations.
- Instead, qualifying members (where `ontime >= working_days` for the active or selected month) are presented in the administrator's **Monthly Perfect On-Time Review (Extra Table)**.
- When the administrator clicks **Valid (-1)**, a stacking record with `point = -1`, `attendance_status = 'manual'`, `reason = 'On-time bonus reward (-1 pt): {month}'` is inserted via RPC `choir_admin_award_bonus()`, deducting 1 point from their cumulative points.
- If excluded, the administrator clicks **Exclude** via RPC `choir_admin_exclude_bonus()`, preventing or revoking the bonus.

### 2.6 Cumulative Points Till Date
- The **Statistics table** (`#memberStats`) displays the member's **total points till date (all-time)**.
- Total points do **not** reset to zero at the start of a new month; they accumulate all historical points, including any deliberate `-1` on-time bonuses awarded by the administrator.
- Members with `total_points >= 10` are flagged with a **Fine** badge.

### 2.7 Streak: Total Present Saturdays Till Date
- In the Statistics leaderboard (`#memberStats`), the **Streak (Present)** column reflects the **total number of Saturdays the member was marked present till date** across all history.
- This is calculated as `count(*) from choir_attendance_stack where user_id = p.id and attendance_status = 'present'`.
- Displayed cleanly as an accessible badge across both member and administrator views.

---

## 3. Database Architecture (PostgreSQL)

All database definitions reside in `sql/choir_portal_setup.sql`, with targeted migration in `sql/update_features_and_admin_tools.sql`.

### 3.1 Tables
1. **`choir_profiles`**
   - `id` (uuid, references `auth.users`)
   - `full_name` (text), `phone_num` (text), `email` (text)
   - `symbolnum` (text, unique login symbol)
   - `selfie_path` (text, storage key)
   - `status` (`'pending'`, `'approved'`, `'rejected'`)
   - `role` (`'member'`, `'admin'`)
2. **`choir_settings`**
   - `id = 1` (singleton keeping active month name and working days for backward-compatible companion syncs).
3. **`choir_months`**
   - Configures $N$ number of months with working Saturdays:
   - `id` (uuid, primary key), `month_name` (text, unique), `working_days` (smallint, 1–6), `is_active` (boolean).
4. **`choir_bonus_reviews`**
   - Tracks admin validation and exclusion status:
   - `id` (uuid), `user_id` (uuid), `month_name` (text), `status` (`'eligible'`, `'validated'`, `'excluded'`), `stack_id` (uuid).
5. **`choir_attendance_stack`**
   - `id` (uuid, primary key)
   - `user_id` (uuid), `symbol` (text), `datefilled` (date), `month_name` (text), `name` (text)
   - `reason` (text), `time_filled` (timestamptz)
   - `point` (integer: **-1, 0, or 1**)
   - `holiday_used` (integer, 0 or 1)
   - `attendance_on_time` (integer, 0 or 1)
   - `attendance_status` (text: `'present'`, `'absent'`, `'not_filled'`, `'manual'`)
6. **`choir_attendance_aggregate`**
   - Summary cache rebuilt automatically whenever `choir_attendance_stack` changes.
   - `user_id` (uuid, primary key)
   - `name`, `email`, `symbolnum`, `phone_num`
   - `total_points` (all-time points)
   - `total_holiday_used` (active month)
   - `total_attendance_on_time` (active month)
   - `on_time_streak` (total present Saturdays till date)
7. **`choir_personal_laws`**
   - `user_id` (uuid, primary key), `personal_law` (text)

### 3.2 Key Stored Procedures
- **`choir_rebuild_aggregate()`**: Re-aggregates total points till date and active month counters without automatic bonus subtraction.
- **`choir_submit_attendance(p_symbol, p_status, p_reason)`**: Validates time and duplicate submissions, then inserts stacking record.
- **`choir_mark_missing_attendance(p_date default null, p_user_id default null)`**: Identifies approved members who have not submitted for Saturday, applying points on the monthly holiday rule basis (supports single member assignment or full batch).
- **`choir_admin_award_bonus(p_user_id, p_month)`**: Inserts stacking `-1` point record and updates review status to `'validated'`.
- **`choir_admin_exclude_bonus(p_user_id, p_month)`**: Removes bonus stack record if present and marks review status as `'excluded'`.
- **`choir_admin_add_month(p_month, p_working_days, p_set_active)`**: Adds or updates month configuration for $N$ months.
- **`choir_admin_set_active_month(p_month)`**: Activates a configured month and synchronizes `choir_settings`.
- **`choir_admin_delete_month(p_month)`**: Deletes a non-active month configuration.
- **`choir_admin_add_manual_points(p_user_id, p_points)`**: Inserts `p_points` stacking records with `attendance_status = 'manual'`.
- **`choir_admin_delete_stack_row(p_stack_id)`**: Deletes a specific attendance or manual record and updates aggregate points.

### 3.3 Row-Level Security (RLS)
- **`choir_attendance_aggregate`**:
  - Policy `"choir aggregate approved read"`: Accessible by owner, admins, and all approved members.
- **`choir_attendance_stack`**:
  - Policy `"choir stack approved read"`: Accessible by owner, admins, and all approved members.
- **`choir_months`**:
  - Authenticated read; Admin full write.
- **`choir_bonus_reviews`**:
  - Authenticated read; Admin full write.

---

## 4. Frontend Architecture

### 4.1 UI Layout (`index.html`)
- **Member View (`#memberPanel`)**:
  - Live Nepal clock (`#nepalClock`, `#monthLabel`)
  - Personal Law guidance card (`#personalLawCard`)
  - Profile picture update
  - **Choir Attendance Guide (Rules Slider)** (`#rulesSliderSection`): 6-slide carousel explaining attendance hours, 9:50 AM cutoff, total present streak, free monthly holidays, penalty points, and administrator-validated -1 point bonus.
  - Saturday attendance form (`#attendanceForm`)
  - Statistics table (`#memberStats`) with 6 columns: **Name**, **Total points**, **Holiday used**, **Ontime**, **Streak (Present)**, and **Status** (`Fine` or `—`).
- **Administrator View (`#adminPanel`)**:
  - **Extra Table 1: Monthly Perfect On-Time Review**:
    - `#bonusMonthSelect`: Month chooser.
    - `#bonusQualCount`: Counter badge for qualifying members.
    - `#bonusReviewRows`: Interactive table with **Valid (-1)** and **Exclude** buttons.
  - **Extra Table 2: Saturday Attendance Pending & Assign**:
    - `#saturdayDateSelect`: Date picker defaulting to active Saturday in Nepal time.
    - `#assignAllPendingBtn`: Assigns all missing members on rule basis.
    - `#refreshUnsubmittedBtn`: Manual refresh button.
    - `#unsubmittedCount`: Real-time counter badge (`X pending` or `All submitted`).
    - `#unsubmittedRows`: Table showing unsubmitted approved members with contact info, status, and individual **Assign** button.
  - **Admin Member Statistics (Monthly & Historical Filter)**:
    - `#adminStatsMonthFilter`: Filter by "All-Time Cumulative" or specific month (e.g. Baisakh).
    - `#adminStatsRows`: Recalculates stats for chosen month.
  - **Member Detail Section**:
    - Chooser `#memberDetailSelect`, `#memberDetailResult`, manual points form, and history list.
  - **New Member Requests Table** (`#pendingRows`): Approving/rejecting pending accounts.
  - **Personal Law Form** (`#lawForm`): Custom pastoral guidance for members.
  - **Working Months Management (N Months) & CSV Export**:
    - `#addMonthForm`: Form to add/update any $N$ number of months.
    - `#monthsListRows`: Table of configured months with Set Active, Edit, and Delete actions.
    - `#csvMonthSelect` & `#csvExport`: Downloads CSV records for selected month.

### 4.2 Script Modules (`js/app.js`)
- `loadMember()`: Computes total points without auto-bonus, calculates total present Saturdays, and renders 6-column `#memberStats` leaderboard.
- `loadBonusReview(month)`: Queries qualifying members where on-time meets working days and manages Valid (-1) / Exclude actions.
- `loadUnsubmittedSaturday(targetDate)`: Queries unsubmitted members for Saturday and powers individual/batch assignment on rule basis.
- `renderAdminStats(filterMonth)`: Renders cumulative or month-specific stats for admin inspection.
- `loadMonthsList()`: Loads configured months and updates all month dropdowns.
- `getActiveSaturdayDate()`: Resolves current or most recent Saturday in Nepal time.
- `loadUnsubmittedSaturday(targetDate)`: Queries approved members and stack submissions, rendering members without `'present'` or `'absent'` submissions.
- `showMemberDetail(targetMemberId)`: Loads member attendance records and renders the manual points form and history list.
- Event delegation on `#memberDetailResult`:
  - Handles `submit` on `#detailManualPointsForm` to add manual points.
  - Handles `click` on `[data-delete-detail-record]` to delete stack entries.
- Cache-busting: Script tag in `index.html` uses query version parameters (`?v=...`) to prevent browser caching issues during updates.

---

## 5. Google Apps Script Companion (`apps-script/Code.gs`)

Bound to the choir administration Google Sheet:
- **Saturday Automated Schedule (`runSaturdaySchedule`)**:
  - 09:40 AM: Reminder 1 (window closing at 9:50 AM).
  - 03:00 PM: Reminder 2.
  - 09:30 PM: Final reminder.
  - 11:00 PM: Automated `markMissingOnce_(date)` calling Supabase RPC `choir_mark_missing_attendance`.
- **Spreadsheet Sync**:
  - Menu options to sync Supabase tables directly into Google Sheet tabs (`Aggregate`, `Attendance Stack`, `Personal Laws`, `Settings`).
  - Google Drive export utilities (`.xlsx` and `.csv`).

---

## 6. Developer Guidelines for Future Updates

When making future updates, always adhere to the following checklist:

1. **Never Calculate Critical Times in the Browser**:
   - Time calculations, status evaluations, and point assignments belong in PostgreSQL (`choir_submit_attendance`, `choir_mark_missing_attendance`).
2. **Always Run Cumulative Aggregate Recalculations**:
   - Modifying `choir_attendance_stack` records must always trigger or call `choir_rebuild_aggregate()`.
   - Never reset `total_points` on month rollover; only active-month counters (`total_holiday_used`, `total_attendance_on_time`) belong to the current month.
3. **Synchronise DOM IDs Between HTML and JS**:
   - Whenever an element ID is added or removed in `index.html`, verify that `js/app.js` is updated to match.
   - Run syntax checks (`node --check js/app.js`) before deploying.
4. **Update Script Version in `index.html`**:
   - Bump the version parameter on line 74 of `index.html` (e.g. `src="./js/app.js?v=YYYYMMDD-feature"`) so users' browsers fetch the latest script immediately.
5. **Database Updates in Supabase**:
   - Keep both `sql/choir_portal_setup.sql` (the comprehensive schema) and any discrete migration scripts (e.g. `sql/fix_aggregate_points_till_date.sql`) synchronized.
