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
function toast(message, type = 'ok') { const el = $('toast'); el.textContent = message; el.className = `fixed right-5 top-5 z-50 max-w-sm rounded-xl px-5 py-3 text-sm font-semibold text-white shadow-xl ${type === 'error' ? 'bg-red-600' : 'bg-emerald-600'}`; setTimeout(() => el.classList.add('hidden'), 4500); }
function showLoader(title = 'Please wait', message = 'Preparing your choir portal') { text('appLoaderTitle', title); text('appLoaderMessage', message); $('appLoader').classList.remove('hidden'); $('appLoader').classList.add('flex'); }
function hideLoader() { $('appLoader').classList.add('hidden'); $('appLoader').classList.remove('flex'); }
async function withLoader(title, message, action) { showLoader(title, message); try { return await action(); } finally { hideLoader(); } }
const submitButton = form => form.querySelector('button[type="submit"], button:not([type])');
function escape(value = '') { const el = document.createElement('span'); el.textContent = value; return el.innerHTML; }
function nptNow() { return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kathmandu' })); }
function nptDate(value = new Date()) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kathmandu', year: 'numeric', month: '2-digit', day: '2-digit' }).format(value); }
function isAdmin() { return profile?.role === 'admin' && profile?.status === 'approved'; }
function clearAttendanceResult() { $('attendanceResult').classList.add('hidden'); $('retryAttendance').classList.add('hidden'); }
function showAttendanceResult(title, detail, type = 'success') {
  const result = $('attendanceResult');
  result.className = `rounded-xl border p-4 md:col-span-2 ${type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-red-200 bg-red-50 text-red-900'}`;
  text('attendanceResultTitle', title); text('attendanceResultDetail', detail);
  $('retryAttendance').classList.toggle('hidden', type === 'success');
}
function attendanceResultMessage(record) {
  const pointMessage = record.point === 1
    ? 'You received 1 point because your monthly holiday had already been used.'
    : record.holiday_used === 1
      ? 'You received no point because this is the first holiday used this month.'
      : 'You received no point because you were present on time.';
  const timeMessage = record.attendance_on_time === 1 ? 'It was recorded on time.' : 'It was recorded after the 9:50 AM on-time deadline.';
  return `${pointMessage} ${timeMessage}`;
}

document.querySelectorAll('[data-auth-tab]').forEach(button => button.addEventListener('click', () => showAuth(button.dataset.authTab)));
function showAuth(tab) { document.querySelectorAll('.auth-form').forEach(el => el.classList.add('hidden')); $(`${tab}Form`).classList.remove('hidden'); document.querySelectorAll('.auth-tab').forEach(el => el.classList.toggle('bg-white', el.dataset.authTab === tab)); }
showAuth('login');
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
  selfiePreparation.catch(error => { event.target.value = ''; toast(error.message, 'error'); }).finally(() => { selfiePreparation = null; button.disabled = false; });
});
$('signupForm').addEventListener('submit', async event => {
  event.preventDefault(); const name = $('signupName').value.trim(); const phone = $('signupPhone').value.trim(); const email = $('signupEmail').value.trim(); const symbol = $('signupSymbol').value.trim();
  if (!/^9\d{9}$/.test(phone)) return toast('Use a valid 10-digit Nepali phone number beginning with 9.', 'error');
  if (!symbol) return toast('Please choose a symbol.', 'error');
  if (selfiePreparation) return toast('Your selfie is still being prepared. Please wait a moment.', 'error');
  if (!compressedSelfie) return toast('Please add a selfie; it will be compressed to a 10 KB JPG.', 'error');
  const button = submitButton(event.currentTarget); button.disabled = true;
  try { await withLoader('Creating your account', 'Saving your secure member profile', async () => { const { data: available, error: availabilityError } = await supabase.rpc('choir_symbol_available', { p_symbol: symbol }); if (availabilityError) throw availabilityError; if (!available) throw new Error('That symbol is already in use. Please choose another.'); await savePendingSelfie(compressedSelfie); const { error } = await supabase.auth.signUp({ email, password: symbol, options: { data: { full_name: name, phone_num: phone, symbolnum: symbol, accepted_laws: true } } }); if (error) throw error; }); toast('Account created. Log in with your email and symbol number.'); showAuth('login'); $('loginEmail').value = email; $('loginSymbol').value = symbol; }
  catch (error) { toast(error.message || 'Could not create the account.', 'error'); }
  finally { button.disabled = false; }
});
$('loginForm').addEventListener('submit', async event => { event.preventDefault(); const button = submitButton(event.currentTarget); const email = $('loginEmail').value.trim(); const symbol = $('loginSymbol').value; button.disabled = true; loginProgress.classList.remove('hidden'); try { await withLoader('Signing you in', 'Opening your choir space', async () => { const { data, error } = await supabase.auth.signInWithPassword({ email, password: symbol }); if (error) throw new Error(error.message === 'Invalid login credentials' ? 'Email and symbol number do not match.' : error.message); await boot(data.user); }); } catch (error) { toast(error.message || 'Could not log in.', 'error'); } finally { loginProgress.classList.add('hidden'); button.disabled = false; } });

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
    supabase.from('choir_profiles').select('*').eq('id', user.id).single(), supabase.from('choir_settings').select('*').eq('id', 1).single()
  ]); if (profileError || settingsError) return toast((profileError || settingsError).message, 'error'); profile = nextProfile; settings = nextSettings;
  $('authView').classList.add('hidden'); $('appView').classList.remove('hidden'); text('navEmail', profile.email); text('navName', profile.full_name); text('monthLabel', `${settings.month_name} • ${settings.working_days} working Saturday${settings.working_days === 1 ? '' : 's'}`); startClock();
  if (profile.status !== 'approved') $('pendingPanel').classList.remove('hidden');
  // The portal is ready now. Load non-essential data without holding up sign-in.
  void signedSelfie();
  void uploadPendingSelfie().then(() => signedSelfie()).catch(error => console.warn('Selfie upload will retry automatically on the next sign-in.', error));
  void loadMember();
  if (isAdmin()) { $('adminPanel').classList.remove('hidden'); void loadAdmin(); }
}
async function loadMember() {
  text('memberSymbol', profile?.symbolnum || 'Not assigned yet');
  const [lawResult, aggregateResult] = await Promise.all([
    supabase.from('choir_personal_laws').select('personal_law').eq('user_id', user.id).maybeSingle(),
    supabase.from('choir_attendance_aggregate').select('*').order('name')
  ]);
  if (lawResult.data) { $('personalLawCard').classList.remove('hidden'); text('personalLaw', lawResult.data.personal_law); }
  const aggregates = aggregateResult.data || []; const agg = aggregates.find(row => row.user_id === user.id) || { total_points: 0, total_holiday_used: 0, total_attendance_on_time: 0 };
  $('memberStats').innerHTML = aggregates.map(row => { const isFine = Number(row.total_points) >= 10; return `<tr class="${isFine ? 'fine-row' : ''}"><td class="p-3 font-semibold">${escape(row.name)}</td><td class="p-3">${row.total_points}</td><td class="p-3">${row.total_holiday_used}</td><td class="p-3">${isFine ? '<span class="fine-badge">Fine</span>' : '—'}</td></tr>`; }).join('') || '<tr><td colspan="4">No member statistics yet.</td></tr>';
  text('statsCaption', `${settings.month_name}: ${settings.working_days} working Saturdays • on-time attendance: ${agg.total_attendance_on_time}`);
  const npt = nptNow(); const inWindow = npt.getDay() === 6 && (npt.getHours() > 3 || (npt.getHours() === 3 && npt.getMinutes() >= 0)) && npt.getHours() < 23;
  text('attendanceState', inWindow && profile.status === 'approved' ? 'Form is open' : profile.status === 'approved' ? 'Form is closed' : 'Approval required'); $('attendanceSubmit').disabled = !inWindow || profile.status !== 'approved';
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
    showAttendanceResult('Attendance was not saved.', `${error.message} Please check your connection and retry.`, 'error');
    return toast(error.message, 'error');
  }
  showAttendanceResult('Attendance logged successfully.', attendanceResultMessage(data));
  toast('Attendance submitted successfully.'); event.target.reset(); selectedStatus = 'present';
  document.querySelectorAll('.status-btn').forEach(el => el.classList.toggle('active', el.dataset.status === 'present'));
  $('reasonWrap').classList.add('hidden'); await loadMember();
});

async function loadAdmin() {
  const { error: syncError } = await supabase.rpc('choir_sync_missing_symbols');
  if (syncError && syncError.code !== '42883') return toast(syncError.message, 'error');
  const [aggregates, stack, pending] = await Promise.all([supabase.from('choir_attendance_aggregate').select('*').order('name'), supabase.from('choir_attendance_stack').select('*').order('datefilled', { ascending: false }).limit(300), supabase.from('choir_profiles').select('id,full_name,email,phone_num,symbolnum').eq('status', 'pending').order('created_at')]);
  if (aggregates.error || stack.error || pending.error) return toast((aggregates.error || stack.error || pending.error).message, 'error');
  $('aggregateRows').innerHTML = aggregates.data.map(r => { const isFine = Number(r.total_points) >= 10; return `<tr class="${isFine ? 'fine-row' : ''}"><td>${escape(r.name)}</td><td>${escape(r.symbolnum || '—')}</td><td>${r.total_points}</td><td>${r.total_holiday_used}</td><td>${r.total_attendance_on_time}</td><td>${isFine ? '<span class="fine-badge">Fine</span>' : '—'}</td></tr>`; }).join('') || '<tr><td colspan="6">No approved members.</td></tr>';
  $('stackRows').innerHTML = stack.data.map(r => `<tr><td>${escape(r.symbol)}</td><td>${escape(r.datefilled)}</td><td>${escape(r.name)}</td><td>${escape(r.reason || '—')}</td><td>${r.point}/${r.holiday_used}/${r.attendance_on_time}</td></tr>`).join('') || '<tr><td colspan="5">No submissions yet.</td></tr>';
  $('pendingRows').innerHTML = pending.data.map(r => `<tr><td>${escape(r.full_name)}</td><td>${escape(r.email)}</td><td>${escape(r.phone_num)}</td><td>${escape(r.symbolnum || 'Not provided')}</td><td class="whitespace-nowrap"><button data-approve="${r.id}" data-has-symbol="${r.symbolnum ? 'true' : 'false'}" class="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white">Approve</button> <button data-reject="${r.id}" class="rounded-lg bg-red-50 px-3 py-2 text-xs font-bold text-red-700">Reject</button></td></tr>`).join('') || '<tr><td colspan="5">No pending requests.</td></tr>';
  $('settingMonth').value = settings.month_name; $('settingDays').value = settings.working_days;
}
$('syncDataBtn').addEventListener('click', async () => { await withLoader('Refreshing data', 'Loading the latest choir information', loadAdmin); toast('Data refreshed.'); });
$('pendingRows').addEventListener('click', async event => { const approve = event.target.dataset.approve; const reject = event.target.dataset.reject; if (!approve && !reject) return; if (approve && event.target.dataset.hasSymbol !== 'true') return toast('This member did not submit a symbol number. Add it directly in the database before approval.', 'error'); const id = approve || reject; const update = approve ? { status: 'approved' } : { status: 'rejected' }; try { await withLoader(approve ? 'Approving member' : 'Rejecting member', 'Updating the member request', async () => { const { error } = await supabase.from('choir_profiles').update(update).eq('id', id); if (error) throw error; const { error: rebuildError } = await supabase.rpc('choir_rebuild_aggregate'); if (rebuildError) throw rebuildError; await loadAdmin(); }); toast(approve ? 'Member approved.' : 'Member rejected.'); } catch (error) { toast(error.message || 'Could not update this member.', 'error'); } });
$('lawForm').addEventListener('submit', async event => { event.preventDefault(); const symbol = $('lawSymbol').value.trim(); try { await withLoader('Saving personal law', 'Updating member guidance', async () => { const { data: member, error } = await supabase.from('choir_profiles').select('id').eq('symbolnum', symbol).single(); if (error) throw new Error('No member was found for that symbol.'); const { error: saveError } = await supabase.from('choir_personal_laws').upsert({ user_id: member.id, personal_law: $('lawText').value.trim() }, { onConflict: 'user_id' }); if (saveError) throw saveError; }); event.target.reset(); toast('Personal law saved.'); } catch (error) { toast(error.message || 'Could not save personal law.', 'error'); } });
$('settingsForm').addEventListener('submit', async event => { event.preventDefault(); const month = $('settingMonth').value.trim(); const days = Number($('settingDays').value); try { await withLoader('Saving month settings', 'Refreshing the monthly totals', async () => { const { error } = await supabase.rpc('choir_admin_set_settings', { p_month: month, p_working_days: days }); if (error) throw error; settings.month_name = month; settings.working_days = days; await loadMember(); await loadAdmin(); }); toast('Month settings saved; aggregate table refreshed.'); } catch (error) { toast(error.message || 'Could not save month settings.', 'error'); } });
$('csvExport').addEventListener('click', async () => { try { await withLoader('Preparing CSV', 'Collecting the active month attendance data', async () => { const { data, error } = await supabase.from('choir_attendance_stack').select('symbol,datefilled,month_name,name,reason,time_filled,point,holiday_used,attendance_on_time,attendance_status').eq('month_name', settings.month_name).order('datefilled'); if (error) throw error; const headers = ['Symbol','Datefilled','Month','Name','Reason','Time filled','Point','Holiday used','Attendance on time','Status']; const csv = [headers, ...data.map(Object.values)].map(row => row.map(v => `"${String(v ?? '').replaceAll('"','""')}"`).join(',')).join('\n'); const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); link.download = `${settings.month_name}-choir-attendance.csv`; link.click(); URL.revokeObjectURL(link.href); }); } catch (error) { toast(error.message || 'Could not prepare the CSV.', 'error'); } });
$('logoutBtn').addEventListener('click', async () => { try { showLoader('Signing you out', 'Closing your secure session'); await supabase.auth.signOut({ scope: 'local' }); location.replace(location.pathname); } catch (error) { hideLoader(); toast(error.message || 'Could not sign out.', 'error'); } });
supabase.auth.getSession().then(async ({ data }) => { if (data.session) await withLoader('Opening your portal', 'Loading your choir account', boot); });
