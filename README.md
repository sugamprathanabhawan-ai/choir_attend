# Sugam Choir Portal

One-page member and choir-board portal using browser JavaScript, Tailwind CSS, Supabase PostgreSQL/Storage, Gmail, and a Google Apps Script scheduler.

## 1. Create Supabase

1. Create a new Supabase project.
2. Open **SQL Editor** and run [`sql/choir_portal_setup.sql`](sql/choir_portal_setup.sql) once.
3. In **Authentication → Providers → Email**, enable email confirmations. In **Authentication → SMTP Settings**, add `sugamprathanabhawan@gmail.com` and its Gmail App Password as the custom SMTP sender. This makes sign-up and password-reset emails come from the church Gmail account.
4. Set the confirmation email template to show the verification token/code. Supabase controls the token length; the website accepts the code it sends. A fixed four-digit signup code is not a safe browser-only feature—changing it would require a separate trusted registration service.
5. In **Authentication → URL Configuration**, add your Vercel URL as a redirect URL.
6. Get the **Project URL** and **anon public** key from **Project Settings → API**. Put them in `js/config.js`. Never put a service-role key in this file or in Vercel.

### First administrator

Create the church account through the normal sign-up page using `sugamprathanabhawan@gmail.com` and the initial password `Sugam123`, verify the email, then run this in the SQL Editor:

```sql
update public.choir_profiles
set role = 'admin', status = 'approved'
where email = 'sugamprathanabhawan@gmail.com';
```

Use **Reset password by email** in the app whenever the administrator password needs to be changed. Do not place an administrator password in source code.

## 2. Connect the supplied Google Sheet and scheduler

1. Open the supplied Google Sheet, then choose **Extensions → Apps Script**.
2. Replace the default script with [`apps-script/Code.gs`](apps-script/Code.gs), save it, and reload the spreadsheet.
3. In the Apps Script project, open **Project Settings → Script properties** and add:
   - `SUPABASE_URL` — your project URL
   - `SUPABASE_SERVICE_ROLE_KEY` — Project Settings → API → service_role key
   - `APP_URL` — your deployed Vercel URL
4. In the sheet, use **Sugam Choir → Set up / repair tabs**, authorize it, then use **Sugam Choir → Install Saturday schedule**.
5. The script sends reminders only on Saturdays at approximately 9:40 AM, 3:00 PM, and 9:30 PM Nepal time. At 11:01 PM it adds a `1 / 1 / 0` row for each approved member who did not submit. It also syncs the sheet’s Aggregate, Attendance Stack, Personal Laws, and Settings tabs from Supabase. Use the same **Sugam Choir** menu to create `.xlsx` and `.csv` export files in Drive.

Apps Script time triggers run within a few minutes of their requested time, so the script deliberately checks Nepal time every five minutes and records each action once per Saturday.

## 3. Deploy to Vercel

1. Create a GitHub repository and push this project.
2. Import the repository into Vercel as a **static site**. No build command or server function is needed.
3. Deploy, copy the public Vercel URL, add it to Supabase redirect URLs, and set it as `APP_URL` in the Apps Script properties.
4. Visit the deployed URL and sign up a test member. The administrator approves the request, assigns its unique symbol number, and can then test attendance.

## Attendance rules implemented

- Form: Saturday only, 3:00 AM–11:00 PM Nepal time.
- Before or at 9:50 AM: Present = `0/0/1`; absent uses a holiday flag, and becomes `1/1/1` if a holiday has already been used.
- After 9:50 AM: first submitted record = `0/1/0`; records after a holiday has already been used = `1/1/0` (present or absent).
- Missing form at 11:01 PM Saturday = `1/1/0`.

All flags and points are calculated inside Postgres, not trusted from the browser clock.
