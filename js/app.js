import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const config = window.CHOIRPORTAL_CONFIG;
if (!config?.url || config.url.includes('YOUR_PROJECT') || !config?.anonKey) {
  document.body.innerHTML = '<main class="p-8 font-sans"><h1 class="text-2xl font-bold">Supabase setup needed</h1><p class="mt-3">Add your Supabase project URL and anonymous key in js/config.js before publishing.</p></main>';
  throw new Error('Supabase configuration is missing.');
}
const supabase = createClient(config.url, config.anonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
let user, profile, settings, selectedStatus = 'present', compressedSelfie, selfiePreparation;
const $ = id => document.getElementById(id);
const text = (id, value = '') => { $(id).textContent = value; };
const THEME_KEY = 'choir_theme';
function applyTheme(theme) {
  const dark = theme === 'dark';
  document.documentElement.classList.toggle('dark-mode', dark);
  ['darkModeToggle', 'authDarkModeToggle'].forEach(id => {
    const toggle = $(id);
    if (!toggle) return;
    toggle.innerHTML = `<i class="fa-solid fa-${dark ? 'sun' : 'moon'}"></i>`;
    toggle.setAttribute('aria-label', `Switch to ${dark ? 'light' : 'dark'} mode`);
    toggle.title = `Switch to ${dark ? 'light' : 'dark'} mode`;
  });
}
const savedTheme = localStorage.getItem(THEME_KEY);
applyTheme(savedTheme || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
function toggleTheme() {
  const nextTheme = document.documentElement.classList.contains('dark-mode') ? 'light' : 'dark';
  localStorage.setItem(THEME_KEY, nextTheme);
  applyTheme(nextTheme);
}
$('darkModeToggle').addEventListener('click', toggleTheme);
$('authDarkModeToggle').addEventListener('click', toggleTheme);
const SAVED_LOGIN_KEY = 'choir_saved_login';
function rememberLogin(email, password) { localStorage.setItem(SAVED_LOGIN_KEY, JSON.stringify({ email, password })); }
function restoreSavedLogin() {
  try {
    const saved = JSON.parse(localStorage.getItem(SAVED_LOGIN_KEY));
    if (saved?.email && saved?.password) { $('loginEmail').value = saved.email; $('loginSymbol').value = saved.password; }
  } catch { localStorage.removeItem(SAVED_LOGIN_KEY); }
}
function toast(message, type = 'ok') { const el = $('toast'); el.textContent = message; el.className = `fixed right-5 top-5 z-50 max-w-sm rounded-xl px-5 py-3 text-sm font-semibold text-white shadow-xl ${type === 'error' ? 'bg-red-600' : 'bg-emerald-600'}`; setTimeout(() => el.classList.add('hidden'), 4500); }
function friendlyError(error, fallback = 'Something went wrong. Please try again.') {
  const message = String(error?.message || error || '').toLowerCase();
  if (error?.code === '23505' || message.includes('duplicate key') || message.includes('already submitted') || message.includes('unique')) return 'You have already filled in attendance for today.';
  if (message.includes('invalid login credentials')) return 'Your email or symbol number is not correct.';
  if (message.includes('already registered') || message.includes('already been registered')) return 'An account already uses this email address.';
  if (message.includes('email not confirmed')) return 'Please confirm your email, then try logging in again.';
  if (message.includes('invalid email')) return 'Please enter a valid email address.';
  if (message.includes('password should be') || message.includes('password must')) return 'Your symbol must have at least 6 characters.';
  if (message.includes('rate limit') || message.includes('too many requests')) return 'Please wait a few minutes, then try again.';
  if (message.includes('network') || message.includes('fetch') || message.includes('connection')) return 'We could not connect. Please check your internet and try again.';
  if (message.includes('permission') || message.includes('not allowed') || message.includes('row-level security') || message.includes('administrator access required')) return 'You do not have permission to do that.';
  if (message.includes('attendance opens only')) return 'Attendance can only be filled in on Saturday from 3:00 AM to 11:00 PM.';
  if (message.includes('awaiting administrator approval') || message.includes('waiting for approval')) return 'Your account is waiting for approval.';
  if (message.includes('symbol number does not match')) return 'Your symbol number does not match this account.';
  if (message.includes('choose present or absent')) return 'Please choose Present or Absent.';
  if (message.includes('absence reason') || message.includes('tell us why you are absent')) return 'Please tell us why you are absent.';
  if (message.includes('no member was found') || message.includes('approved member not found')) return 'We could not find that member.';
  if (message.includes('attendance record not found')) return 'That attendance record has already been removed.';
  if (message.includes('manual points must')) return 'Enter a whole number from 1 to 100.';
  if (message.includes('not all manual points')) return 'We could not add all the points. Please try again.';
  if (message.includes('invalid selfie path') || message.includes('photo')) return 'We could not use that photo. Please choose another one.';
  if (message.includes('missing attendance can only be marked')) return 'Missing attendance can only be marked after 11:00 PM Nepal time on Saturday.';
  if (message.includes('specified date is not a saturday')) return 'Missing attendance can only be recorded for Saturdays.';
  if (message.includes('check constraint') || message.includes('invalid input')) return 'Please check the information you entered and try again.';
  if (message.includes('delete requires a where clause')) return 'Database error: Safe-update blocked rebuilding member totals. Please run the SQL fix in Supabase.';
  if (error?.code === 'PGRST116' || message.includes('0 rows')) return 'We could not find your account. Please try logging in again.';
  return fallback;
}
function showLoader(title = 'Please wait', message = 'Preparing your choir portal') { text('appLoaderTitle', title); text('appLoaderMessage', message); $('appLoader').classList.remove('hidden'); $('appLoader').classList.add('flex'); }
function hideLoader() { $('appLoader').classList.add('hidden'); $('appLoader').classList.remove('flex'); }
async function withLoader(title, message, action) { showLoader(title, message); try { return await action(); } finally { hideLoader(); } }
const submitButton = form => form.querySelector('button[type="submit"], button:not([type])');
function escape(value = '') { const el = document.createElement('span'); el.textContent = value; return el.innerHTML; }
function nptNow() { return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kathmandu' })); }
function nptDate(value = new Date()) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kathmandu', year: 'numeric', month: '2-digit', day: '2-digit' }).format(value); }
function nptTime(value) { return value ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kathmandu', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) : '—'; }
function isAdmin() { return profile?.role === 'admin' && profile?.status === 'approved'; }
function clearAttendanceResult() { $('attendanceResult').classList.add('hidden'); $('retryAttendance').classList.add('hidden'); }
function showAttendanceResult(title, detail, type = 'success') {
  const result = $('attendanceResult');
  result.className = `rounded-xl border p-4 md:col-span-2 ${type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-red-200 bg-red-50 text-red-900'}`;
  text('attendanceResultTitle', title); text('attendanceResultDetail', detail);
  $('retryAttendance').classList.toggle('hidden', type === 'success');
}
function attendanceResultMessage(record) {
  if (record.attendance_status === 'absent') return record.point === 1
    ? 'Your absence has been recorded as 1 point, 1 holiday, and not on time.'
    : 'Your absence has been recorded as 0 points, 1 holiday, and not on time.';
  const pointMessage = record.point === 1
    ? 'You received 1 point because your monthly holiday had already been used.'
    : record.holiday_used === 1
      ? 'You received no point because this is the first holiday used this month.'
      : 'You received no point because you were present on time.';
  const timeMessage = record.attendance_on_time === 1 ? 'It was recorded on time.' : 'It was recorded after the 9:50 AM on-time deadline.';
  return `${pointMessage} ${timeMessage}`;
}
function attendanceCompleteMessage(record) {
  if (record?.attendance_status === 'not_filled') {
    const pointText = Number(record?.point) === 1
      ? '1 penalty point was added because your monthly holiday had already been used.'
      : '0 penalty points were added (used your 1 monthly holiday).';
    return `You did not fill the form before Saturday 11:00 PM Nepal time. A missing attendance record was logged on the rule basis (${pointText})`;
  }
  const time = nptTime(record?.time_filled);
  const completion = time === '—'
    ? 'You have successfully filled in attendance for this Saturday. The form is now closed for you.'
    : `You already filled in attendance today at ${time} Nepal time. The form is closed for you.`;
  return record?.attendance_status === 'present' && Number(record?.attendance_on_time) === 0
    ? `${completion} You are late! Please be punctual next time.`
    : completion;
}
function closeAttendanceForm(message = 'You have successfully filled in attendance for this Saturday. The form is now closed for you.') {
  $('attendanceSubmit').disabled = true;
  $('reasonInput').disabled = true;
  document.querySelectorAll('.status-btn').forEach(button => { button.disabled = true; });
  text('attendanceState', 'Already filled in');
  showAttendanceResult('Attendance complete.', message);
}

document.querySelectorAll('[data-auth-tab]').forEach(button => button.addEventListener('click', () => showAuth(button.dataset.authTab)));
function showAuth(tab) { document.querySelectorAll('.auth-form').forEach(el => el.classList.add('hidden')); $(`${tab}Form`).classList.remove('hidden'); document.querySelectorAll('.auth-tab').forEach(el => el.classList.toggle('bg-white', el.dataset.authTab === tab)); }
showAuth('login');
restoreSavedLogin();
const homePill = document.createElement('a'); homePill.href = 'https://sugamchurch.vercel.app/'; homePill.textContent = 'Home'; homePill.className = 'rounded-full bg-slate-100 px-4 py-2 text-sm font-bold text-ink hover:bg-slate-200'; const topNavActions = document.querySelector('nav .flex.items-center.gap-3'); if (topNavActions) topNavActions.prepend(homePill);
const authHomePill = homePill.cloneNode(true); authHomePill.className = 'absolute left-5 top-5 z-10 rounded-full bg-ink px-4 py-2 text-sm font-bold text-white shadow hover:bg-slate-700'; const authView = $('authView'); authView.classList.add('relative'); authView.prepend(authHomePill);
const loginProgress = document.createElement('div'); loginProgress.id = 'loginProgress'; loginProgress.className = 'login-loader hidden rounded-2xl border border-sky-200 p-4 text-sm text-ink shadow-inner'; loginProgress.innerHTML = '<div class="flex items-center gap-3"><div class="login-loader-icon flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-ink text-lg text-gold shadow-lg"><i class="fa-solid fa-heart"></i></div><div class="min-w-0 flex-1"><div class="flex items-center justify-between gap-3"><p class="font-black tracking-wide">Jesus loves you</p><span class="flex gap-1 text-gold"><i class="login-loader-dot fa-solid fa-circle text-[6px]"></i><i class="login-loader-dot fa-solid fa-circle text-[6px]"></i><i class="login-loader-dot fa-solid fa-circle text-[6px]"></i></span></div><p class="mt-0.5 text-xs font-medium text-slate-500">Preparing your choir space</p></div></div><div class="mt-3 h-2 overflow-hidden rounded-full bg-white/90 shadow-inner"><div class="login-progress-bar h-full w-1/3 rounded-full bg-gradient-to-r from-sky-400 via-gold to-sky-400"></div></div>'; $('loginForm').append(loginProgress);

async function compressImage(file) {
  if (!file) throw new Error('Please choose a photo.');
  let source = file;
  const isHeic = /\.hei[cf]$/i.test(file.name) || /image\/hei[cf]/i.test(file.type);
  if (isHeic) {
    try {
      const { default: heic2any } = await import('https://cdn.jsdelivr.net/npm/heic2any@0.0.4/+esm');
      source = await heic2any({ blob: file, toType: 'image/jpeg', quality: .9 });
      if (Array.isArray(source)) source = source[0];
    } catch (error) {
      throw new Error('This HEIC photo could not be read. Please save it as JPG or PNG and try again.');
    }
  }
  let image;
  try { image = await createImageBitmap(source); }
  catch (error) {
    const url = URL.createObjectURL(source); image = await new Promise((resolve, reject) => { const el = new Image(); el.onload = () => { URL.revokeObjectURL(url); resolve(el); }; el.onerror = () => { URL.revokeObjectURL(url); reject(new Error('The photo could not be read.')); }; el.src = url; });
  }
  let quality = .76; let width = Math.min(image.width, 400); let height = Math.round(image.height * width / image.width);
  for (let pass = 0; pass < 10; pass++) {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; canvas.getContext('2d').drawImage(image, 0, 0, width, height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (blob && blob.size <= 10 * 1024) return blob;
    width = Math.round(width * .78); height = Math.round(height * .78); quality = Math.max(.25, quality - .07);
  }
  throw new Error('The photo could not be compressed below 10 KB. Please take a simpler, well-lit photo.');
}
function savePendingSelfie(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => { sessionStorage.setItem('choir_pending_selfie', reader.result); resolve(); };
    reader.onerror = () => reject(new Error('The selfie could not be prepared for upload.'));
    reader.readAsDataURL(blob);
  });
}
async function uploadPendingSelfie() {
  const encoded = sessionStorage.getItem('choir_pending_selfie'); if (!encoded || !user) return;
  const blob = await (await fetch(encoded)).blob(); const path = `${user.id}/selfie.jpg`;
  const { error } = await supabase.storage.from('choir-selfies').upload(path, blob, { upsert: true, contentType: 'image/jpeg' });
  if (error) throw error;
  const { error: profileError } = await supabase.rpc('choir_save_selfie', { p_path: path }); if (profileError) throw profileError;
  sessionStorage.removeItem('choir_pending_selfie');
}

$('signupSelfie').addEventListener('change', event => {
  const form = $('signupForm'); const button = submitButton(form); compressedSelfie = null;
  selfiePreparation = withLoader('Preparing your selfie', 'Compressing it safely for upload', async () => { compressedSelfie = await compressImage(event.target.files[0]); });
  button.disabled = true;
  selfiePreparation.catch(error => { event.target.value = ''; toast(friendlyError(error, 'We could not use that photo. Please choose another one.'), 'error'); }).finally(() => { selfiePreparation = null; button.disabled = false; });
});
$('profilePictureInput').addEventListener('change', async event => {
  const input = event.target;
  if (!input.files?.[0] || !user) return;
  input.disabled = true;
  try {
    await withLoader('Updating your profile picture', 'Compressing and saving your new photo', async () => {
      const photo = await compressImage(input.files[0]);
      const path = `${user.id}/selfie.jpg`;
      const { error: uploadError } = await supabase.storage.from('choir-selfies').upload(path, photo, { upsert: true, contentType: 'image/jpeg' });
      if (uploadError) throw uploadError;
      const { error: profileError } = await supabase.rpc('choir_save_selfie', { p_path: path });
      if (profileError) throw profileError;
      profile.selfie_path = path;
      await signedSelfie();
    });
    toast('Your profile picture has been updated.');
  } catch (error) { toast(friendlyError(error, 'We could not update your profile picture. Please try again.'), 'error'); }
  finally { input.value = ''; input.disabled = false; }
});
$('signupForm').addEventListener('submit', async event => {
  event.preventDefault(); const name = $('signupName').value.trim(); const phone = $('signupPhone').value.trim(); const email = $('signupEmail').value.trim(); const symbol = $('signupSymbol').value.trim();
  if (!/^9\d{9}$/.test(phone)) return toast('Use a valid 10-digit Nepali phone number beginning with 9.', 'error');
  if (!symbol) return toast('Please choose a symbol.', 'error');
  if (selfiePreparation) return toast('Your selfie is still being prepared. Please wait a moment.', 'error');
  if (!compressedSelfie) return toast('Please add a selfie; it will be compressed to a 10 KB JPG.', 'error');
  const button = submitButton(event.currentTarget); button.disabled = true;
  try { await withLoader('Creating your account', 'Saving your secure member profile', async () => { const { data: available, error: availabilityError } = await supabase.rpc('choir_symbol_available', { p_symbol: symbol }); if (availabilityError) throw availabilityError; if (!available) throw new Error('That symbol is already in use. Please choose another.'); await savePendingSelfie(compressedSelfie); const { error } = await supabase.auth.signUp({ email, password: symbol, options: { data: { full_name: name, phone_num: phone, symbolnum: symbol, accepted_laws: true } } }); if (error) throw error; }); rememberLogin(email, symbol); toast('Account created. Log in with your email and symbol number.'); showAuth('login'); $('loginEmail').value = email; $('loginSymbol').value = symbol; }
  catch (error) { toast(friendlyError(error, 'We could not create your account. Please try again.'), 'error'); }
  finally { button.disabled = false; }
});
 $('loginForm').addEventListener('submit', async event => { event.preventDefault(); const button = submitButton(event.currentTarget); const email = $('loginEmail').value.trim(); const symbol = $('loginSymbol').value.trim(); button.disabled = true; loginProgress.classList.remove('hidden'); try { await withLoader('Signing you in', 'Opening your choir space', async () => { const { data, error } = await supabase.auth.signInWithPassword({ email, password: symbol }); if (error) throw error; rememberLogin(email, symbol); await boot(data.user); }); } catch (error) { toast(friendlyError(error, 'We could not log you in. Please try again.'), 'error'); } finally { loginProgress.classList.add('hidden'); button.disabled = false; } });

function startClock() { const render = () => text('nepalClock', new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kathmandu', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format()); render(); setInterval(render, 1000); }
async function signedSelfie() {
  const storedPath = profile?.selfie_path?.trim();
  if (!user) return;

  // Prefer the saved path, but also try the standard file path. This lets a
  // selfie render even while an older profile row is waiting for its path update.
  const paths = [...new Set([
    ...(storedPath ? (storedPath.includes('/') ? [storedPath] : [`${user.id}/${storedPath}`, storedPath]) : []),
    `${user.id}/selfie.jpg`
  ])];
  for (const path of paths) {
    const { data, error } = await supabase.storage.from('choir-selfies').createSignedUrl(path, 3600);
    if (!error && data?.signedUrl) {
      $('navSelfie').removeAttribute('src');
      $('navSelfie').src = data.signedUrl;
      return;
    }
  }
  // A newly created profile can briefly exist before its storage object is available.
  // Keep the neutral avatar instead of showing an alarming error.
  $('navSelfie').src = `https://ui-avatars.com/api/?name=${encodeURIComponent(profile?.full_name || 'Member')}&background=e0f2fe&color=0c4a6e&bold=true`;
}
async function boot(activeUser) {
  if (!activeUser) { const { data } = await supabase.auth.getUser(); activeUser = data.user; }
  if (!activeUser) return;
  user = activeUser;
  const [{ data: nextProfile, error: profileError }, { data: nextSettings, error: settingsError }] = await Promise.all([
    supabase.from('choir_profiles').select('id,full_name,email,symbolnum,selfie_path,status,role').eq('id', user.id).single(), supabase.from('choir_settings').select('month_name,working_days').eq('id', 1).single()
  ]); if (profileError || settingsError) return toast(friendlyError(profileError || settingsError, 'We could not open your choir space. Please try again.'), 'error'); profile = nextProfile; settings = nextSettings;
  $('authView').classList.add('hidden'); $('appView').classList.remove('hidden'); text('navEmail', profile.email); text('navName', profile.full_name); text('monthLabel', `${settings.month_name} • ${settings.working_days} working Saturday${settings.working_days === 1 ? '' : 's'}`); startClock();
  if (profile.status !== 'approved') $('pendingPanel').classList.remove('hidden');
  // The portal is ready now. Load non-essential data without holding up sign-in.
  void signedSelfie();
  void uploadPendingSelfie().then(() => signedSelfie()).catch(error => console.warn('Selfie upload will retry automatically on the next sign-in.', error));
  void loadMember().catch(error => toast(friendlyError(error, 'We could not load your attendance details. Please refresh and try again.'), 'error'));
  if (isAdmin()) { $('adminPanel').classList.remove('hidden'); void loadAdmin(); }
}
async function loadMember() {
  text('memberSymbol', profile?.symbolnum || 'Not assigned yet');
  const today = nptDate();
  const [lawResult, aggregateResult, attendanceResult, stackPointsResult] = await Promise.all([
    supabase.from('choir_personal_laws').select('personal_law').eq('user_id', user.id).maybeSingle(),
    supabase.from('choir_attendance_aggregate').select('*').order('name'),
    supabase.from('choir_attendance_stack').select('attendance_status,attendance_on_time,time_filled').eq('user_id', user.id).eq('datefilled', today).neq('attendance_status', 'manual').maybeSingle(),
    supabase.from('choir_attendance_stack').select('user_id,point,datefilled').lte('datefilled', today)
  ]);
  if (lawResult.error || aggregateResult.error || attendanceResult.error) {
    throw lawResult.error || aggregateResult.error || attendanceResult.error;
  }
  if (lawResult.data) { $('personalLawCard').classList.remove('hidden'); text('personalLaw', lawResult.data.personal_law); }
  const stackPointsByUser = {};
  (stackPointsResult?.data || []).forEach(row => {
    stackPointsByUser[row.user_id] = (stackPointsByUser[row.user_id] || 0) + (Number(row.point) || 0);
  });
  const aggregates = (aggregateResult.data || []).map(row => {
    const calculatedPoints = stackPointsByUser[row.user_id];
    return {
      ...row,
      total_points: calculatedPoints !== undefined ? Math.max(Number(row.total_points) || 0, calculatedPoints) : (Number(row.total_points) || 0)
    };
  });
  const agg = aggregates.find(row => row.user_id === user.id) || { total_points: 0, total_holiday_used: 0, total_attendance_on_time: 0 };
  if (stackPointsByUser[user.id] !== undefined) {
    agg.total_points = Math.max(Number(agg.total_points) || 0, stackPointsByUser[user.id]);
  }
  $('memberStats').innerHTML = aggregates.map(row => { const isFine = Number(row.total_points) >= 10; return `<tr class="${isFine ? 'fine-row' : ''}"><td class="p-3 font-semibold">${escape(row.name)}</td><td class="p-3 font-bold">${row.total_points}</td><td class="p-3">${row.total_holiday_used}</td><td class="p-3">${isFine ? '<span class="fine-badge">Fine</span>' : '—'}</td></tr>`; }).join('') || '<tr><td colspan="4">No member statistics yet.</td></tr>';
  text('statsCaption', `All-time aggregate (total points till date) • ${settings.month_name}: ${settings.working_days} working Saturdays • on-time attendance: ${agg.total_attendance_on_time}`);
  const npt = nptNow(); const inWindow = npt.getDay() === 6 && (npt.getHours() > 3 || (npt.getHours() === 3 && npt.getMinutes() >= 0)) && npt.getHours() < 23;
  const alreadySubmitted = Boolean(attendanceResult.data);
  text('attendanceState', alreadySubmitted ? 'Already filled in' : inWindow && profile.status === 'approved' ? 'Form is open' : profile.status === 'approved' ? 'Form is closed' : 'Approval required');
  const formClosed = alreadySubmitted || !inWindow || profile.status !== 'approved';
  $('attendanceSubmit').disabled = formClosed; $('reasonInput').disabled = formClosed;
  document.querySelectorAll('.status-btn').forEach(button => { button.disabled = formClosed; });
  if (alreadySubmitted) closeAttendanceForm(attendanceCompleteMessage(attendanceResult.data));
}
$('retryAttendance').addEventListener('click', () => $('attendanceForm').requestSubmit());
document.querySelectorAll('.status-btn').forEach(button => button.addEventListener('click', () => { selectedStatus = button.dataset.status; document.querySelectorAll('.status-btn').forEach(el => el.classList.toggle('active', el === button)); $('reasonWrap').classList.toggle('hidden', selectedStatus !== 'absent'); clearAttendanceResult(); }));
document.querySelector('[data-status="present"]').click();
$('attendanceForm').addEventListener('submit', async event => {
  event.preventDefault(); const reason = $('reasonInput').value.trim();
  if (selectedStatus === 'absent' && reason.length < 3) return toast('Please enter a valid reason for absence.', 'error');
  const button = $('attendanceSubmit'); button.disabled = true; clearAttendanceResult();
  let data, error;
  try { ({ data, error } = await withLoader('Saving attendance', 'Recording your Saturday attendance', () => supabase.rpc('choir_submit_attendance', { p_symbol: profile.symbolnum, p_status: selectedStatus, p_reason: reason || null }))); }
  catch (requestError) { error = requestError; }
  button.disabled = false;
  if (error) {
    console.error('Attendance submission error:', error);
    if (error.code === '23505' || String(error.message || '').toLowerCase().includes('duplicate key')) {
      await loadMember();
      return toast('You have already filled in attendance for today.');
    }
    const message = friendlyError(error, 'We could not save your attendance. Please try again.');
    showAttendanceResult('Attendance was not saved.', message, 'error');
    return toast(message, 'error');
  }
  showAttendanceResult('Attendance complete.', attendanceCompleteMessage(data));
  toast('You have successfully filled in attendance for this Saturday.'); event.target.reset(); selectedStatus = 'present';
  document.querySelectorAll('.status-btn').forEach(el => el.classList.toggle('active', el.dataset.status === 'present'));
  $('reasonWrap').classList.add('hidden'); closeAttendanceForm(attendanceCompleteMessage(data)); await loadMember();
});

async function loadAdmin() {
  const today = nptDate();
  // Symbol repair runs in the background so it never delays the board.
  const syncRequest = supabase.rpc('choir_sync_missing_symbols');
  const [aggregates, stack, pending, allPointsResult] = await Promise.all([
    supabase.from('choir_attendance_aggregate').select('*').order('name'),
    supabase.from('choir_attendance_stack').select('*').order('datefilled', { ascending: false }).limit(300),
    supabase.from('choir_profiles').select('id,full_name,email,phone_num,symbolnum').eq('status', 'pending').order('created_at'),
    supabase.from('choir_attendance_stack').select('user_id,point,datefilled').lte('datefilled', today)
  ]);
  if (aggregates.error || stack.error || pending.error) return toast(friendlyError(aggregates.error || stack.error || pending.error, 'We could not load the choir board. Please refresh and try again.'), 'error');
  void syncRequest.then(({ error }) => { if (error && error.code !== '42883') console.warn('Symbol sync will retry on the next refresh.', error); });
  const adminStackPointsByUser = {};
  (allPointsResult?.data || []).forEach(row => {
    adminStackPointsByUser[row.user_id] = (adminStackPointsByUser[row.user_id] || 0) + (Number(row.point) || 0);
  });
  const adminAggregates = (aggregates.data || []).map(r => {
    const calculatedPoints = adminStackPointsByUser[r.user_id];
    return {
      ...r,
      total_points: calculatedPoints !== undefined ? Math.max(Number(r.total_points) || 0, calculatedPoints) : (Number(r.total_points) || 0)
    };
  });
  $('stackRows').innerHTML = stack.data.map(r => `<tr><td>${escape(r.symbol)}</td><td>${escape(r.datefilled)}</td><td>${escape(r.name)}</td><td>${escape(r.reason || '—')}</td><td>${nptTime(r.time_filled)}</td><td>${r.point}/${r.holiday_used}/${r.attendance_on_time}</td><td><button type="button" data-delete-stack-row="${r.id}" class="rounded-lg bg-red-50 px-2 py-1 text-xs font-bold text-red-700 hover:bg-red-100">Delete</button></td></tr>`).join('') || '<tr><td colspan="7">No submissions yet.</td></tr>';
  $('aggregateRows').innerHTML = adminAggregates.map(r => { const isFine = Number(r.total_points) >= 10; return `<tr class="${isFine ? 'fine-row' : ''}"><td>${escape(r.name)}</td><td>${escape(r.symbolnum || '—')}</td><td class="font-bold">${r.total_points}</td><td>${r.total_holiday_used}</td><td>${r.total_attendance_on_time}</td><td class="whitespace-nowrap"><label class="sr-only" for="manual-points-${r.user_id}">Manual points for ${escape(r.name)}</label><input id="manual-points-${r.user_id}" data-manual-points-input="${r.user_id}" type="number" min="1" max="100" step="1" value="1" class="w-16 rounded-lg border border-sky-200 px-2 py-1 text-sm" aria-label="Manual points for ${escape(r.name)}"><button data-add-manual-points="${r.user_id}" class="ml-1 rounded-lg bg-ink px-2 py-1 text-xs font-bold text-white">Add</button></td><td>${isFine ? '<span class="fine-badge">Fine</span>' : '—'}</td></tr>`; }).join('') || '<tr><td colspan="7">No approved members.</td></tr>';
  const detailSelect = $('memberDetailSelect'); const previouslySelected = detailSelect.value;
  detailSelect.innerHTML = '<option value="">Choose a member</option>' + adminAggregates.map(r => `<option value="${r.user_id}">${escape(r.name)}${r.symbolnum ? ` (${escape(r.symbolnum)})` : ''}</option>`).join('');
  if (adminAggregates.some(r => r.user_id === previouslySelected)) detailSelect.value = previouslySelected;
  $('pendingRows').innerHTML = pending.data.map(r => `<tr><td>${escape(r.full_name)}</td><td>${escape(r.email)}</td><td>${escape(r.phone_num)}</td><td>${escape(r.symbolnum || 'Not provided')}</td><td class="whitespace-nowrap"><button data-approve="${r.id}" data-has-symbol="${r.symbolnum ? 'true' : 'false'}" class="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white">Approve</button> <button data-reject="${r.id}" class="rounded-lg bg-red-50 px-3 py-2 text-xs font-bold text-red-700">Reject</button></td></tr>`).join('') || '<tr><td colspan="5">No pending requests.</td></tr>';
  $('settingMonth').value = settings.month_name; $('settingDays').value = settings.working_days;
}

function attendanceLabel(row) {
  return row.attendance_status === 'manual' ? 'Manual point added' : row.attendance_status === 'not_filled' ? 'No form submitted' : row.attendance_status === 'absent' ? 'Absent' : 'Present';
}

async function showMemberDetail() {
  const memberId = $('memberDetailSelect').value;
  const result = $('memberDetailResult');
  if (!memberId) return toast('Choose a member first.', 'error');
  result.innerHTML = '<p class="text-sm text-slate-500">Loading member history…</p>';
  const { data: rows, error } = await supabase.from('choir_attendance_stack').select('datefilled,month_name,reason,time_filled,point,holiday_used,attendance_on_time,attendance_status').eq('user_id', memberId).order('datefilled', { ascending: false }).limit(1000);
  if (error) throw error;
  const memberName = $('memberDetailSelect').selectedOptions[0]?.textContent || 'Member';
  const totals = rows.reduce((sum, row) => ({ points: sum.points + Number(row.point), holidays: sum.holidays + Number(row.holiday_used), onTime: sum.onTime + Number(row.attendance_on_time) }), { points: 0, holidays: 0, onTime: 0 });
  result.innerHTML = `<div class="grid gap-3 sm:grid-cols-4"><div class="rounded-xl bg-sky-50 p-4"><p class="text-xs font-bold uppercase text-sky-700">Member</p><p class="mt-1 font-bold">${escape(memberName)}</p></div><div class="rounded-xl bg-sky-50 p-4"><p class="text-xs font-bold uppercase text-sky-700">Points received</p><p class="mt-1 text-2xl font-black">${totals.points}</p></div><div class="rounded-xl bg-sky-50 p-4"><p class="text-xs font-bold uppercase text-sky-700">Holidays used</p><p class="mt-1 text-2xl font-black">${totals.holidays}</p></div><div class="rounded-xl bg-sky-50 p-4"><p class="text-xs font-bold uppercase text-sky-700">On time</p><p class="mt-1 text-2xl font-black">${totals.onTime}</p></div></div><div class="table-wrap"><table><thead><tr><th>Date</th><th>Month</th><th>Attendance</th><th>Reason / point source</th><th>Time</th><th>Point</th><th>Holiday</th><th>On time</th></tr></thead><tbody>${rows.map(row => `<tr><td>${escape(row.datefilled)}</td><td>${escape(row.month_name)}</td><td>${escape(attendanceLabel(row))}</td><td>${escape(row.reason || '—')}</td><td>${nptTime(row.time_filled)}</td><td>${row.point}</td><td>${row.holiday_used}</td><td>${row.attendance_on_time}</td></tr>`).join('') || '<tr><td colspan="8">No attendance records for this member.</td></tr>'}</tbody></table></div>`;
}
$('markMissingBtn')?.addEventListener('click', async () => {
  if (!window.confirm('Check and mark missing attendance for approved members who did not submit attendance before Saturday 11:00 PM? Points will be assigned on the monthly holiday rule basis.')) return;
  try {
    await withLoader('Checking missing attendance', 'Recording missing attendance on the rule basis', async () => {
      const { data: count, error } = await supabase.rpc('choir_mark_missing_attendance');
      if (error) throw error;
      await loadAdmin();
      await loadMember();
      const num = Number(count) || 0;
      toast(num > 0 ? `Marked missing attendance for ${num} member${num === 1 ? '' : 's'} on the rule basis.` : 'No missing attendance records were needed for today.');
    });
  } catch (error) { toast(friendlyError(error, 'We could not mark missing attendance. Please try again.'), 'error'); }
});
$('syncDataBtn').addEventListener('click', async () => {
  try {
    await withLoader('Refreshing data', 'Loading the latest choir information', loadAdmin);
    toast('Data refreshed.');
  } catch (error) { toast(friendlyError(error, 'We could not refresh the choir board. Please try again.'), 'error'); }
});
$('memberDetailBtn').addEventListener('click', async () => {
  try { await showMemberDetail(); }
  catch (error) { $('memberDetailResult').innerHTML = '<p class="text-sm text-red-600">We could not load this member’s detail.</p>'; toast(friendlyError(error, 'We could not load this member’s detail. Please try again.'), 'error'); }
});
$('stackRows').addEventListener('click', async event => {
  const stackId = event.target.dataset.deleteStackRow;
  if (!stackId || !window.confirm('Delete this attendance record? This cannot be undone.')) return;
  event.target.disabled = true;
  try {
    await withLoader('Deleting attendance', 'Removing the selected attendance record', async () => {
      const { error } = await supabase.rpc('choir_admin_delete_stack_row', { p_stack_id: stackId });
      if (error) throw error;
      await loadAdmin();
      await loadMember();
    });
    toast('Attendance record deleted.');
  } catch (error) { toast(friendlyError(error, 'We could not delete that attendance record. Please try again.'), 'error'); }
  finally { event.target.disabled = false; }
});
$('aggregateRows').addEventListener('click', async event => {
  const memberId = event.target.dataset.addManualPoints;
  if (!memberId) return;
  const input = document.querySelector(`[data-manual-points-input="${memberId}"]`);
  const points = Number(input?.value);
  if (!Number.isInteger(points) || points < 1 || points > 100) return toast('Enter a whole number from 1 to 100.', 'error');
  event.target.disabled = true;
  try {
    await withLoader('Adding manual points', `Saving ${points} manual point${points === 1 ? '' : 's'} as stacking records`, async () => {
      const { data, error } = await supabase.rpc('choir_admin_add_manual_points', { p_user_id: memberId, p_points: points });
      if (error) throw error;
      if (Number(data) !== points) throw new Error('Not all manual points were saved. Please refresh and try again.');
      await loadAdmin();
    });
    toast(`${points} manual point${points === 1 ? '' : 's'} added.`);
  } catch (error) { toast(friendlyError(error, 'We could not add the points. Please try again.'), 'error'); }
  finally { event.target.disabled = false; }
});
$('pendingRows').addEventListener('click', async event => { const approve = event.target.dataset.approve; const reject = event.target.dataset.reject; if (!approve && !reject) return; if (approve && event.target.dataset.hasSymbol !== 'true') return toast('This member needs a symbol number before you can approve them.', 'error'); const id = approve || reject; const update = approve ? { status: 'approved' } : { status: 'rejected' }; try { await withLoader(approve ? 'Approving member' : 'Rejecting member', 'Updating the member request', async () => { const { error } = await supabase.from('choir_profiles').update(update).eq('id', id); if (error) throw error; const { error: rebuildError } = await supabase.rpc('choir_rebuild_aggregate'); if (rebuildError) throw rebuildError; await loadAdmin(); }); toast(approve ? 'Member approved.' : 'Member rejected.'); } catch (error) { toast(friendlyError(error, 'We could not update this member. Please try again.'), 'error'); } });
$('lawForm').addEventListener('submit', async event => { event.preventDefault(); const symbol = $('lawSymbol').value.trim(); try { await withLoader('Saving personal law', 'Updating member guidance', async () => { const { data: member, error } = await supabase.from('choir_profiles').select('id').eq('symbolnum', symbol).single(); if (error) throw new Error('No member was found for that symbol.'); const { error: saveError } = await supabase.from('choir_personal_laws').upsert({ user_id: member.id, personal_law: $('lawText').value.trim() }, { onConflict: 'user_id' }); if (saveError) throw saveError; }); event.target.reset(); toast('Personal law saved.'); } catch (error) { toast(friendlyError(error, 'We could not save the personal law. Please try again.'), 'error'); } });
$('settingsForm').addEventListener('submit', async event => { event.preventDefault(); const month = $('settingMonth').value.trim(); const days = Number($('settingDays').value); try { await withLoader('Saving month settings', 'Keeping aggregate totals unchanged', async () => { const { error } = await supabase.rpc('choir_admin_set_settings', { p_month: month, p_working_days: days }); if (error) throw error; settings.month_name = month; settings.working_days = days; await loadMember(); await loadAdmin(); }); toast('Month settings saved; aggregate totals were kept.'); } catch (error) { toast(friendlyError(error, 'We could not save the month settings. Please try again.'), 'error'); } });
$('csvExport').addEventListener('click', async () => { try { await withLoader('Preparing CSV', 'Collecting the active month attendance data', async () => { const { data, error } = await supabase.from('choir_attendance_stack').select('symbol,datefilled,month_name,name,reason,time_filled,point,holiday_used,attendance_on_time,attendance_status').eq('month_name', settings.month_name).order('datefilled'); if (error) throw error; const headers = ['Symbol','Datefilled','Month','Name','Reason','Time filled','Point','Holiday used','Attendance on time','Status']; const csv = [headers, ...data.map(Object.values)].map(row => row.map(v => `"${String(v ?? '').replaceAll('"','""')}"`).join(',')).join('\n'); const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); link.download = `${settings.month_name}-choir-attendance.csv`; link.click(); URL.revokeObjectURL(link.href); }); } catch (error) { toast(friendlyError(error, 'We could not prepare the download. Please try again.'), 'error'); } });
$('logoutBtn').addEventListener('click', async () => { try { showLoader('Signing you out', 'Closing your secure session'); await supabase.auth.signOut({ scope: 'local' }); location.replace(location.pathname); } catch (error) { hideLoader(); toast(friendlyError(error, 'We could not sign you out. Please try again.'), 'error'); } });
supabase.auth.getSession().then(async ({ data }) => {
  if (data.session) await withLoader('Opening your portal', 'Loading your choir account', boot);
}).catch(error => { hideLoader(); toast(friendlyError(error, 'We could not open your choir space. Please try again.'), 'error'); });
