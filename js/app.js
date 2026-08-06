import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const config = window.CHOIRPORTAL_CONFIG;
if (!config?.url || config.url.includes('YOUR_PROJECT') || !config?.anonKey) {
  document.body.innerHTML = '<main class="p-8 font-sans"><h1 class="text-2xl font-bold">Supabase setup needed</h1><p class="mt-3">Add your Supabase project URL and anonymous key in index.html before publishing.</p></main>';
  throw new Error('Supabase configuration is missing.');
}
const supabase = createClient(config.url, config.anonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
let user, profile, settings, selectedStatus = 'present', compressedSelfie;
const $ = id => document.getElementById(id);
const text = (id, value = '') => { $(id).textContent = value; };
function toast(message, type = 'ok') { const el = $('toast'); el.textContent = message; el.className = `fixed right-5 top-5 z-50 max-w-sm rounded-xl px-5 py-3 text-sm font-semibold text-white shadow-xl ${type === 'error' ? 'bg-red-600' : 'bg-emerald-600'}`; setTimeout(() => el.classList.add('hidden'), 4500); }
function escape(value = '') { const el = document.createElement('span'); el.textContent = value; return el.innerHTML; }
function nptNow() { return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kathmandu' })); }
function nptDate(value = new Date()) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kathmandu', year: 'numeric', month: '2-digit', day: '2-digit' }).format(value); }
function isAdmin() { return profile?.role === 'admin' && profile?.status === 'approved'; }

document.querySelectorAll('[data-auth-tab]').forEach(button => button.addEventListener('click', () => showAuth(button.dataset.authTab)));
function showAuth(tab) { document.querySelectorAll('.auth-form').forEach(el => el.classList.add('hidden')); $(`${tab}Form`).classList.remove('hidden'); document.querySelectorAll('.auth-tab').forEach(el => el.classList.toggle('bg-white', el.dataset.authTab === tab)); }
showAuth('login');

async function compressImage(file) {
  const image = await createImageBitmap(file); let quality = .76; let width = Math.min(image.width, 400); let height = Math.round(image.height * width / image.width);
  for (let pass = 0; pass < 10; pass++) {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; canvas.getContext('2d').drawImage(image, 0, 0, width, height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (blob && blob.size <= 10 * 1024) return blob;
    width = Math.round(width * .78); height = Math.round(height * .78); quality = Math.max(.25, quality - .07);
  }
  throw new Error('The photo could not be compressed below 10 KB. Please take a simpler, well-lit photo.');
}
function savePendingSelfie(blob) { const reader = new FileReader(); reader.onload = () => sessionStorage.setItem('choir_pending_selfie', reader.result); reader.readAsDataURL(blob); }
async function uploadPendingSelfie() {
  const encoded = sessionStorage.getItem('choir_pending_selfie'); if (!encoded || !user) return;
  const blob = await (await fetch(encoded)).blob(); const path = `${user.id}/selfie.jpg`;
  const { error } = await supabase.storage.from('choir-selfies').upload(path, blob, { upsert: true, contentType: 'image/jpeg' });
  if (error) throw error;
  const { error: profileError } = await supabase.rpc('choir_save_selfie', { p_path: path }); if (profileError) throw profileError;
  sessionStorage.removeItem('choir_pending_selfie');
}

$('signupSelfie').addEventListener('change', async event => { try { compressedSelfie = await compressImage(event.target.files[0]); } catch (error) { event.target.value = ''; toast(error.message, 'error'); } });
$('signupForm').addEventListener('submit', async event => {
  event.preventDefault(); const name = $('signupName').value.trim(); const phone = $('signupPhone').value.trim(); const email = $('signupEmail').value.trim(); const password = $('signupPassword').value;
  if (!/^9\d{9}$/.test(phone)) return toast('Use a valid 10-digit Nepali phone number beginning with 9.', 'error');
  if (!compressedSelfie) return toast('Please add a selfie; it will be compressed to a 10 KB JPG.', 'error');
  try { event.submitter.disabled = true; savePendingSelfie(compressedSelfie); const { error } = await supabase.auth.signUp({ email, password, options: { data: { full_name: name, phone_num: phone, accepted_laws: true } } }); if (error) throw error; $('verifyEmail').value = email; showAuth('verify'); toast('Verification email sent. After verifying, log in and wait for approval.'); }
  catch (error) { toast(error.message || 'Could not create the account.', 'error'); }
  finally { event.submitter.disabled = false; }
});
$('verifyForm').addEventListener('submit', async event => { event.preventDefault(); const { error } = await supabase.auth.verifyOtp({ email: $('verifyEmail').value.trim(), token: $('verifyCode').value.trim(), type: 'signup' }); if (error) return toast(error.message, 'error'); toast('Email verified. You can now log in.'); showAuth('login'); });
$('loginForm').addEventListener('submit', async event => { event.preventDefault(); const { error } = await supabase.auth.signInWithPassword({ email: $('loginEmail').value.trim(), password: $('loginPassword').value }); if (error) return toast(error.message, 'error'); await boot(); });
$('resetPassword').addEventListener('click', async () => { const email = $('loginEmail').value.trim(); if (!email) return toast('Enter your email first.', 'error'); const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.href }); toast(error ? error.message : 'Password-reset email sent.', error ? 'error' : 'ok'); });

function startClock() { const render = () => text('nepalClock', new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kathmandu', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format()); render(); setInterval(render, 1000); }
async function signedSelfie() { if (!profile.selfie_path) return; const { data } = await supabase.storage.from('choir-selfies').createSignedUrl(profile.selfie_path, 3600); if (data?.signedUrl) $('navSelfie').src = data.signedUrl; }
async function boot() {
  const { data: { user: activeUser } } = await supabase.auth.getUser(); if (!activeUser) return;
  user = activeUser; try { await uploadPendingSelfie(); } catch (error) { toast(`Selfie upload: ${error.message}`, 'error'); }
  const [{ data: nextProfile, error: profileError }, { data: nextSettings, error: settingsError }] = await Promise.all([
    supabase.from('choir_profiles').select('*').eq('id', user.id).single(), supabase.from('choir_settings').select('*').eq('id', 1).single()
  ]); if (profileError || settingsError) return toast((profileError || settingsError).message, 'error'); profile = nextProfile; settings = nextSettings;
  $('authView').classList.add('hidden'); $('appView').classList.remove('hidden'); text('navEmail', profile.email); text('navName', profile.full_name); text('monthLabel', `${settings.month_name} • ${settings.working_days} working Saturday${settings.working_days === 1 ? '' : 's'}`); await signedSelfie(); startClock();
  if (profile.status !== 'approved') $('pendingPanel').classList.remove('hidden'); await loadMember(); if (isAdmin()) { $('adminPanel').classList.remove('hidden'); await loadAdmin(); }
}
async function loadMember() {
  const [lawResult, aggregateResult, logsResult] = await Promise.all([
    supabase.from('choir_personal_laws').select('personal_law').eq('user_id', user.id).maybeSingle(),
    supabase.from('choir_attendance_aggregate').select('*').eq('user_id', user.id).maybeSingle(),
    supabase.from('choir_attendance_stack').select('datefilled,time_filled,point,holiday_used,attendance_on_time,attendance_status').eq('user_id', user.id).order('datefilled', { ascending: false }).limit(10)
  ]);
  if (lawResult.data) { $('personalLawCard').classList.remove('hidden'); text('personalLaw', lawResult.data.personal_law); }
  const agg = aggregateResult.data || { total_points: 0, total_holiday_used: 0, total_attendance_on_time: 0 }; const logs = logsResult.data || [];
  $('memberStats').innerHTML = `<tr><td class="p-3 font-semibold">${escape(profile.full_name)}</td><td class="p-3">${logs[0] ? `${escape(logs[0].datefilled)} ${new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kathmandu',hour:'2-digit',minute:'2-digit'}).format(new Date(logs[0].time_filled))}` : 'No attendance yet'}</td><td class="p-3">${agg.total_points}</td><td class="p-3">${agg.total_holiday_used}</td></tr>`;
  text('statsCaption', `${settings.month_name}: ${settings.working_days} working Saturdays • on-time attendance: ${agg.total_attendance_on_time}`);
  const npt = nptNow(); const inWindow = npt.getDay() === 6 && (npt.getHours() > 3 || (npt.getHours() === 3 && npt.getMinutes() >= 0)) && npt.getHours() < 23;
  text('attendanceState', inWindow && profile.status === 'approved' ? 'Form is open' : profile.status === 'approved' ? 'Form is closed' : 'Approval required'); $('attendanceSubmit').disabled = !inWindow || profile.status !== 'approved';
}
$('symbolInput').addEventListener('input', () => { text('symbolName', $('symbolInput').value.trim() === profile?.symbolnum ? profile.full_name : ''); });
document.querySelectorAll('.status-btn').forEach(button => button.addEventListener('click', () => { selectedStatus = button.dataset.status; document.querySelectorAll('.status-btn').forEach(el => el.classList.toggle('active', el === button)); $('reasonWrap').classList.toggle('hidden', selectedStatus !== 'absent'); }));
document.querySelector('[data-status="present"]').click();
$('attendanceForm').addEventListener('submit', async event => { event.preventDefault(); const reason = $('reasonInput').value.trim(); if (selectedStatus === 'absent' && reason.length < 3) return toast('Please enter a valid reason for absence.', 'error'); const button = $('attendanceSubmit'); button.disabled = true; const { error } = await supabase.rpc('choir_submit_attendance', { p_symbol: $('symbolInput').value.trim(), p_status: selectedStatus, p_reason: reason || null }); if (error) toast(error.message, 'error'); else { toast('Attendance submitted.'); event.target.reset(); selectedStatus = 'present'; document.querySelector('[data-status="present"]').click(); await loadMember(); } button.disabled = false; });

async function loadAdmin() {
  const [aggregates, stack, pending] = await Promise.all([supabase.from('choir_attendance_aggregate').select('*').order('name'), supabase.from('choir_attendance_stack').select('*').order('datefilled', { ascending: false }).limit(300), supabase.from('choir_profiles').select('id,full_name,email,phone_num').eq('status', 'pending').order('created_at')]);
  if (aggregates.error || stack.error || pending.error) return toast((aggregates.error || stack.error || pending.error).message, 'error');
  $('aggregateRows').innerHTML = aggregates.data.map(r => `<tr><td>${escape(r.name)}</td><td>${escape(r.symbolnum || '—')}</td><td>${r.total_points}</td><td>${r.total_holiday_used}</td><td>${r.total_attendance_on_time}</td></tr>`).join('') || '<tr><td colspan="5">No approved members.</td></tr>';
  $('stackRows').innerHTML = stack.data.map(r => `<tr><td>${escape(r.symbol)}</td><td>${escape(r.datefilled)}</td><td>${escape(r.name)}</td><td>${escape(r.reason || '—')}</td><td>${r.point}/${r.holiday_used}/${r.attendance_on_time}</td></tr>`).join('') || '<tr><td colspan="5">No submissions yet.</td></tr>';
  $('pendingRows').innerHTML = pending.data.map(r => `<tr><td>${escape(r.full_name)}</td><td>${escape(r.email)}</td><td>${escape(r.phone_num)}</td><td><input data-symbol-for="${r.id}" class="input min-w-32" placeholder="e.g. 1001"></td><td class="whitespace-nowrap"><button data-approve="${r.id}" class="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white">Approve</button> <button data-reject="${r.id}" class="rounded-lg bg-red-50 px-3 py-2 text-xs font-bold text-red-700">Reject</button></td></tr>`).join('') || '<tr><td colspan="5">No pending requests.</td></tr>';
  $('settingMonth').value = settings.month_name; $('settingDays').value = settings.working_days;
}
$('syncDataBtn').addEventListener('click', async () => { await loadAdmin(); toast('Data refreshed.'); });
$('pendingRows').addEventListener('click', async event => { const approve = event.target.dataset.approve; const reject = event.target.dataset.reject; if (!approve && !reject) return; const id = approve || reject; const update = approve ? { status: 'approved', symbolnum: document.querySelector(`[data-symbol-for="${id}"]`).value.trim() } : { status: 'rejected' }; if (approve && !update.symbolnum) return toast('Enter a unique symbol number before approval.', 'error'); const { error } = await supabase.from('choir_profiles').update(update).eq('id', id); if (error) return toast(error.message, 'error'); await supabase.rpc('choir_rebuild_aggregate'); await loadAdmin(); toast(approve ? 'Member approved.' : 'Member rejected.'); });
$('lawForm').addEventListener('submit', async event => { event.preventDefault(); const symbol = $('lawSymbol').value.trim(); const { data: member, error } = await supabase.from('choir_profiles').select('id').eq('symbolnum', symbol).single(); if (error) return toast('No member was found for that symbol.', 'error'); const { error: saveError } = await supabase.from('choir_personal_laws').upsert({ user_id: member.id, personal_law: $('lawText').value.trim() }, { onConflict: 'user_id' }); if (saveError) return toast(saveError.message, 'error'); event.target.reset(); toast('Personal law saved.'); });
$('settingsForm').addEventListener('submit', async event => { event.preventDefault(); const { error } = await supabase.rpc('choir_admin_set_settings', { p_month: $('settingMonth').value.trim(), p_working_days: Number($('settingDays').value) }); if (error) return toast(error.message, 'error'); settings.month_name = $('settingMonth').value.trim(); settings.working_days = Number($('settingDays').value); await loadMember(); await loadAdmin(); toast('Month settings saved; aggregate table refreshed.'); });
$('csvExport').addEventListener('click', async () => { const { data, error } = await supabase.from('choir_attendance_stack').select('symbol,datefilled,month_name,name,reason,time_filled,point,holiday_used,attendance_on_time,attendance_status').eq('month_name', settings.month_name).order('datefilled'); if (error) return toast(error.message, 'error'); const headers = ['Symbol','Datefilled','Month','Name','Reason','Time filled','Point','Holiday used','Attendance on time','Status']; const csv = [headers, ...data.map(Object.values)].map(row => row.map(v => `"${String(v ?? '').replaceAll('"','""')}"`).join(',')).join('\n'); const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); link.download = `${settings.month_name}-choir-attendance.csv`; link.click(); URL.revokeObjectURL(link.href); });
$('logoutBtn').addEventListener('click', async () => { await supabase.auth.signOut(); location.reload(); });
supabase.auth.getSession().then(({ data }) => { if (data.session) boot(); });
