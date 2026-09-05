import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

// Configuration validation
const config = window.CHOIRPORTAL_CONFIG;
if (!config?.url || config.url.includes('YOUR_PROJECT') || !config?.anonKey) {
  document.body.innerHTML = '<main class="p-8 font-sans"><h1 class="text-2xl font-bold text-black">Supabase configuration missing</h1><p class="mt-3 text-black">Please provide your Supabase project URL and anonymous key in js/config.js before running.</p></main>';
  throw new Error('Supabase configuration is missing.');
}

const supabase = createClient(config.url, config.anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});

let user = null;
let profile = null;
let settings = null;
let selectedStatus = 'present';
let compressedSelfie = null;
let selfiePreparation = null;

const $ = id => document.getElementById(id);
const text = (id, value = '') => {
  const el = $(id);
  if (el) el.textContent = value;
};

// Remove any legacy theme storage (ensuring permanent clean light mode)
try {
  localStorage.removeItem('choir_theme');
  document.documentElement.classList.remove('dark-mode');
} catch {}

const SAVED_LOGIN_KEY = 'choir_saved_login';
function rememberLogin(email, password) {
  try {
    localStorage.setItem(SAVED_LOGIN_KEY, JSON.stringify({ email, password }));
  } catch {}
}

function restoreSavedLogin() {
  try {
    const saved = JSON.parse(localStorage.getItem(SAVED_LOGIN_KEY));
    if (saved?.email && saved?.password) {
      if ($('loginEmail')) $('loginEmail').value = saved.email;
      if ($('loginSymbol')) $('loginSymbol').value = saved.password;
    }
  } catch {
    localStorage.removeItem(SAVED_LOGIN_KEY);
  }
}

function toast(message, type = 'ok') {
  const el = $('toast');
  if (!el) return;
  el.textContent = message;
  el.className = `fixed right-5 top-5 z-50 max-w-sm rounded-2xl px-5 py-3.5 text-sm font-bold text-white shadow-2xl transition-all duration-300 ${type === 'error' ? 'bg-red-600 border border-red-700' : 'bg-emerald-600 border border-emerald-700'}`;
  el.classList.remove('hidden');
  clearTimeout(el._toastTimer);
  el._toastTimer = setTimeout(() => el.classList.add('hidden'), 4500);
}

function friendlyError(error, fallback = 'Something went wrong. Please try again.') {
  const message = String(error?.message || error || '').toLowerCase();
  if (error?.code === '23505' || message.includes('duplicate key') || message.includes('already submitted') || message.includes('unique')) {
    return 'You have already filled in attendance for today.';
  }
  if (message.includes('invalid login credentials')) return 'Your email or symbol number is not correct.';
  if (message.includes('already registered') || message.includes('already been registered')) return 'An account already exists for this email address.';
  if (message.includes('email not confirmed')) return 'Please confirm your email address, then try logging in again.';
  if (message.includes('invalid email')) return 'Please enter a valid email address.';
  if (message.includes('password should be') || message.includes('password must')) return 'Your symbol number must have at least 6 characters.';
  if (message.includes('rate limit') || message.includes('too many requests')) return 'Please wait a moment, then try again.';
  if (message.includes('network') || message.includes('fetch') || message.includes('connection')) return 'Network error. Please check your internet connection.';
  if (message.includes('permission') || message.includes('not allowed') || message.includes('row-level security') || message.includes('administrator access required')) {
    return 'You do not have permission to do that.';
  }
  if (message.includes('attendance opens only')) return 'Attendance can only be filled in on Saturday from 3:00 AM to 11:00 PM Nepal time.';
  if (message.includes('awaiting administrator approval') || message.includes('waiting for approval')) return 'Your account is waiting for approval.';
  if (message.includes('symbol number does not match')) return 'Your symbol number does not match this account.';
  if (message.includes('choose present or absent')) return 'Please choose Present or Absent.';
  if (message.includes('absence reason') || message.includes('tell us why you are absent')) return 'Please provide a valid reason for absence (at least 3 letters).';
  if (message.includes('no member was found') || message.includes('approved member not found')) return 'We could not find that choir member.';
  if (message.includes('attendance record not found')) return 'That attendance record has already been removed.';
  if (message.includes('manual points must')) return 'Enter a whole number between 1 and 100.';
  if (message.includes('not all manual points')) return 'We could not add all points. Please try again.';
  if (message.includes('invalid selfie path') || message.includes('photo')) return 'Could not process that photo. Please choose another image.';
  if (message.includes('missing attendance can only be marked')) return 'Missing attendance can only be marked after Saturday 11:00 PM Nepal time.';
  if (message.includes('specified date is not a saturday')) return 'Missing attendance can only be recorded for Saturdays.';
  if (message.includes('check constraint') || message.includes('invalid input')) return 'Please check the information entered and try again.';
  if (message.includes('delete requires a where clause')) return 'Database safe-update error. Please run the SQL migration in Supabase.';
  if (error?.code === 'PGRST116' || message.includes('0 rows')) return 'We could not locate your member account. Please log in again.';
  return fallback;
}

function showLoader(title = 'Please wait', message = 'Preparing your choir portal') {
  text('appLoaderTitle', title);
  text('appLoaderMessage', message);
  const loader = $('appLoader');
  if (loader) {
    loader.classList.remove('hidden');
    loader.classList.add('flex');
  }
}

function hideLoader() {
  const loader = $('appLoader');
  if (loader) {
    loader.classList.add('hidden');
    loader.classList.remove('flex');
  }
}

async function withLoader(title, message, action) {
  showLoader(title, message);
  try {
    return await action();
  } finally {
    hideLoader();
  }
}

const submitButton = form => form?.querySelector('button[type="submit"], button:not([type])');

function escape(value = '') {
  const el = document.createElement('span');
  el.textContent = value;
  return el.innerHTML;
}

function nptNow() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kathmandu' }));
}

function nptDate(value = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kathmandu',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(value);
}

function nptTime(value) {
  return value
    ? new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Kathmandu',
        hour: '2-digit',
        minute: '2-digit'
      }).format(new Date(value))
    : '—';
}

function isAdmin() {
  return profile?.role === 'admin' && profile?.status === 'approved';
}

function clearAttendanceResult() {
  $('attendanceResult')?.classList.add('hidden');
  $('retryAttendance')?.classList.add('hidden');
}

function showAttendanceResult(title, detail, type = 'success') {
  const result = $('attendanceResult');
  if (!result) return;
  result.className = `rounded-2xl border p-4 md:col-span-2 shadow-sm ${type === 'success' ? 'border-emerald-300 bg-emerald-50/90 text-black' : 'border-red-300 bg-red-50/90 text-black'}`;
  text('attendanceResultTitle', title);
  text('attendanceResultDetail', detail);
  result.classList.remove('hidden');
  $('retryAttendance')?.classList.toggle('hidden', type === 'success');
}

function attendanceResultMessage(record) {
  if (record.attendance_status === 'absent') {
    return record.point === 1
      ? 'Your absence has been recorded as 1 penalty point (your monthly free holiday was already used).'
      : 'Your absence has been recorded as 0 points (used your 1 monthly free holiday).';
  }
  const pointMessage = record.point === 1
    ? 'You received 1 penalty point because your monthly free holiday had already been used.'
    : record.holiday_used === 1
      ? 'You received no penalty point because this was your first holiday used this month.'
      : 'You received no penalty point because you were present on time.';
  const timeMessage = record.attendance_on_time === 1
    ? 'It was recorded on time (eligible for continuous streak!).'
    : 'It was recorded after the 9:50 AM on-time deadline.';
  return `${pointMessage} ${timeMessage}`;
}

function attendanceCompleteMessage(record) {
  if (record?.attendance_status === 'not_filled') {
    const pointText = Number(record?.point) === 1
      ? '1 penalty point was assigned because your monthly holiday was already used.'
      : '0 penalty points were assigned (used your 1 monthly free holiday).';
    return `You did not fill the form before Saturday 11:00 PM Nepal time. A missing record was automatically assigned (${pointText})`;
  }
  const time = nptTime(record?.time_filled);
  const completion = time === '—'
    ? 'You have successfully filled in attendance for this Saturday. The form is now closed for you.'
    : `You already submitted attendance today at ${time} Nepal time. The form is closed for you.`;
  return record?.attendance_status === 'present' && Number(record?.attendance_on_time) === 0
    ? `${completion} (Late submission recorded; be punctual next Saturday!)`
    : completion;
}

function closeAttendanceForm(message = 'You have successfully filled in attendance for this Saturday. The form is now closed for you.') {
  if ($('attendanceSubmit')) $('attendanceSubmit').disabled = true;
  if ($('reasonInput')) $('reasonInput').disabled = true;
  document.querySelectorAll('.status-btn').forEach(button => { button.disabled = true; });
  text('attendanceState', 'Already filled in');
  showAttendanceResult('Attendance recorded.', message);
}

// Auth Tabs Switching
document.querySelectorAll('[data-auth-tab]').forEach(button => {
  button.addEventListener('click', () => showAuth(button.dataset.authTab));
});

function showAuth(tab) {
  document.querySelectorAll('.auth-form').forEach(el => el.classList.add('hidden'));
  $(`${tab}Form`)?.classList.remove('hidden');
  document.querySelectorAll('.auth-tab').forEach(el => {
    el.classList.toggle('bg-white', el.dataset.authTab === tab);
  });
}
showAuth('login');
restoreSavedLogin();

// Image Compression (Targeting <= 10 KB JPG)
async function compressImage(file) {
  if (!file) throw new Error('Please choose a photo.');
  let source = file;
  const isHeic = /\.hei[cf]$/i.test(file.name) || /image\/hei[cf]/i.test(file.type);
  if (isHeic) {
    try {
      const { default: heic2any } = await import('https://cdn.jsdelivr.net/npm/heic2any@0.0.4/+esm');
      source = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.9 });
      if (Array.isArray(source)) source = source[0];
    } catch {
      throw new Error('This HEIC photo could not be read. Please convert it to JPG/PNG and try again.');
    }
  }
  let image;
  try {
    image = await createImageBitmap(source);
  } catch {
    const url = URL.createObjectURL(source);
    image = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => { URL.revokeObjectURL(url); resolve(el); };
      el.onerror = () => { URL.revokeObjectURL(url); reject(new Error('The photo could not be read.')); };
      el.src = url;
    });
  }
  let quality = 0.76;
  let width = Math.min(image.width, 400);
  let height = Math.round(image.height * width / image.width);
  for (let pass = 0; pass < 10; pass++) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').drawImage(image, 0, 0, width, height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (blob && blob.size <= 10 * 1024) return blob;
    width = Math.round(width * 0.78);
    height = Math.round(height * 0.78);
    quality = Math.max(0.25, quality - 0.07);
  }
  throw new Error('The photo could not be compressed below 10 KB. Please choose a well-lit photo.');
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
  const encoded = sessionStorage.getItem('choir_pending_selfie');
  if (!encoded || !user) return;
  const blob = await (await fetch(encoded)).blob();
  const path = `${user.id}/selfie.jpg`;
  const { error } = await supabase.storage.from('choir-selfies').upload(path, blob, { upsert: true, contentType: 'image/jpeg' });
  if (error) throw error;
  const { error: profileError } = await supabase.rpc('choir_save_selfie', { p_path: path });
  if (profileError) throw profileError;
  sessionStorage.removeItem('choir_pending_selfie');
}

// Profile picture listeners
$('signupSelfie')?.addEventListener('change', event => {
  const form = $('signupForm');
  const button = submitButton(form);
  compressedSelfie = null;
  selfiePreparation = withLoader('Preparing selfie', 'Compressing safely for upload', async () => {
    compressedSelfie = await compressImage(event.target.files[0]);
  });
  if (button) button.disabled = true;
  selfiePreparation
    .catch(error => {
      event.target.value = '';
      toast(friendlyError(error, 'Could not use that photo. Please choose another.'), 'error');
    })
    .finally(() => {
      selfiePreparation = null;
      if (button) button.disabled = false;
    });
});

$('profilePictureInput')?.addEventListener('change', async event => {
  const input = event.target;
  if (!input.files?.[0] || !user) return;
  input.disabled = true;
  try {
    await withLoader('Updating profile picture', 'Compressing and saving your new photo', async () => {
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
  } catch (error) {
    toast(friendlyError(error, 'Could not update your profile picture. Please try again.'), 'error');
  } finally {
    input.value = '';
    input.disabled = false;
  }
});

// Signup Form Submission
$('signupForm')?.addEventListener('submit', async event => {
  event.preventDefault();
  const name = $('signupName').value.trim();
  const phone = $('signupPhone').value.trim();
  const email = $('signupEmail').value.trim();
  const symbol = $('signupSymbol').value.trim();
  if (!/^9\d{9}$/.test(phone)) return toast('Use a valid 10-digit Nepali phone number beginning with 9.', 'error');
  if (!symbol) return toast('Please choose a symbol number.', 'error');
  if (selfiePreparation) return toast('Your selfie is still compressing. Please wait a moment.', 'error');
  if (!compressedSelfie) return toast('Please add a selfie; it will be compressed to a safe 10 KB JPG.', 'error');
  const button = submitButton(event.currentTarget);
  if (button) button.disabled = true;
  try {
    await withLoader('Creating account', 'Saving your choir member profile', async () => {
      const { data: available, error: availabilityError } = await supabase.rpc('choir_symbol_available', { p_symbol: symbol });
      if (availabilityError) throw availabilityError;
      if (!available) throw new Error('That symbol number is already in use. Please choose another.');
      await savePendingSelfie(compressedSelfie);
      const { error } = await supabase.auth.signUp({
        email,
        password: symbol,
        options: {
          data: {
            full_name: name,
            phone_num: phone,
            symbolnum: symbol,
            accepted_laws: true
          }
        }
      });
      if (error) throw error;
    });
    rememberLogin(email, symbol);
    toast('Account created. Please log in with your email and symbol number.');
    showAuth('login');
    if ($('loginEmail')) $('loginEmail').value = email;
    if ($('loginSymbol')) $('loginSymbol').value = symbol;
  } catch (error) {
    toast(friendlyError(error, 'Could not create your account. Please try again.'), 'error');
  } finally {
    if (button) button.disabled = false;
  }
});

// Login Form Submission
$('loginForm')?.addEventListener('submit', async event => {
  event.preventDefault();
  const button = submitButton(event.currentTarget);
  const email = $('loginEmail').value.trim();
  const symbol = $('loginSymbol').value.trim();
  if (button) button.disabled = true;
  try {
    await withLoader('Signing you in', 'Opening your choir space', async () => {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password: symbol });
      if (error) throw error;
      rememberLogin(email, symbol);
      await boot(data.user);
    });
  } catch (error) {
    toast(friendlyError(error, 'Could not log you in. Please check your credentials.'), 'error');
  } finally {
    if (button) button.disabled = false;
  }
});

// Live Nepal Clock
function startClock() {
  const render = () => {
    text('nepalClock', new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kathmandu',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    }).format(new Date()));
  };
  render();
  setInterval(render, 1000);
}

// Attendance Rules Slider
let rulesSliderInitialized = false;
function initRulesSlider() {
  if (rulesSliderInitialized) return;
  const track = $('rulesSliderTrack');
  const prevBtn = $('sliderPrevBtn');
  const nextBtn = $('sliderNextBtn');
  const counter = $('sliderCounter');
  const dotsContainer = $('sliderDots');
  if (!track || !prevBtn || !nextBtn || !dotsContainer) return;
  rulesSliderInitialized = true;

  const slides = track.children;
  const totalSlides = slides.length;
  let currentSlide = 0;
  let autoTimer = null;

  dotsContainer.innerHTML = Array.from({ length: totalSlides }).map((_, i) =>
    `<button type="button" data-slide-index="${i}" aria-label="Go to rule ${i + 1}" class="h-2 rounded-full transition-all duration-300 ${i === 0 ? 'w-6 bg-blue-600' : 'w-2 bg-slate-300 hover:bg-slate-400'}"></button>`
  ).join('');

  function updateSlider() {
    track.style.transform = `translateX(-${currentSlide * 100}%)`;
    if (counter) counter.textContent = `${currentSlide + 1} / ${totalSlides}`;
    const dots = dotsContainer.querySelectorAll('button');
    dots.forEach((dot, i) => {
      if (i === currentSlide) {
        dot.className = 'h-2 w-6 rounded-full bg-blue-600 transition-all duration-300';
      } else {
        dot.className = 'h-2 w-2 rounded-full bg-slate-300 hover:bg-slate-400 transition-all duration-300';
      }
    });
  }

  function nextSlide() {
    currentSlide = (currentSlide + 1) % totalSlides;
    updateSlider();
  }

  function prevSlide() {
    currentSlide = (currentSlide - 1 + totalSlides) % totalSlides;
    updateSlider();
  }

  function startAutoSlide() {
    stopAutoSlide();
    autoTimer = setInterval(nextSlide, 7000);
  }

  function stopAutoSlide() {
    if (autoTimer) {
      clearInterval(autoTimer);
      autoTimer = null;
    }
  }

  nextBtn.addEventListener('click', () => {
    nextSlide();
    startAutoSlide();
  });

  prevBtn.addEventListener('click', () => {
    prevSlide();
    startAutoSlide();
  });

  dotsContainer.addEventListener('click', e => {
    const btn = e.target.closest('[data-slide-index]');
    if (!btn) return;
    currentSlide = Number(btn.dataset.slideIndex);
    updateSlider();
    startAutoSlide();
  });

  const section = $('rulesSliderSection');
  if (section) {
    section.addEventListener('mouseenter', stopAutoSlide);
    section.addEventListener('mouseleave', startAutoSlide);
    let touchStartX = 0;
    section.addEventListener('touchstart', e => {
      touchStartX = e.changedTouches[0].screenX;
      stopAutoSlide();
    }, { passive: true });
    section.addEventListener('touchend', e => {
      const touchEndX = e.changedTouches[0].screenX;
      if (touchStartX - touchEndX > 50) nextSlide();
      else if (touchEndX - touchStartX > 50) prevSlide();
      startAutoSlide();
    }, { passive: true });
  }

  updateSlider();
  startAutoSlide();
}

async function signedSelfie() {
  const storedPath = profile?.selfie_path?.trim();
  if (!user) return;
  const paths = [...new Set([
    ...(storedPath ? (storedPath.includes('/') ? [storedPath] : [`${user.id}/${storedPath}`, storedPath]) : []),
    `${user.id}/selfie.jpg`
  ])];
  for (const path of paths) {
    const { data, error } = await supabase.storage.from('choir-selfies').createSignedUrl(path, 3600);
    if (!error && data?.signedUrl) {
      const img = $('navSelfie');
      if (img) {
        img.removeAttribute('src');
        img.src = data.signedUrl;
      }
      return;
    }
  }
  const img = $('navSelfie');
  if (img) {
    img.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(profile?.full_name || 'Member')}&background=e0f2fe&color=0c4a6e&bold=true`;
  }
}

// Boot Portal on Authentication
async function boot(activeUser) {
  if (!activeUser) {
    const { data } = await supabase.auth.getUser();
    activeUser = data?.user;
  }
  if (!activeUser) return;
  user = activeUser;

  const [{ data: nextProfile, error: profileError }, { data: nextSettings, error: settingsError }] = await Promise.all([
    supabase.from('choir_profiles').select('id,full_name,email,symbolnum,selfie_path,status,role').eq('id', user.id).single(),
    supabase.from('choir_settings').select('month_name,working_days').eq('id', 1).single()
  ]);

  if (profileError || settingsError) {
    return toast(friendlyError(profileError || settingsError, 'Could not open your choir portal. Please try again.'), 'error');
  }

  profile = nextProfile;
  settings = nextSettings;

  $('authView')?.classList.add('hidden');
  $('appView')?.classList.remove('hidden');
  text('navEmail', profile.email);
  text('navName', profile.full_name);
  text('monthLabel', `${settings.month_name} • ${settings.working_days} working Saturday${settings.working_days === 1 ? '' : 's'}`);
  
  startClock();
  initRulesSlider();

  if (profile.status !== 'approved') {
    $('pendingPanel')?.classList.remove('hidden');
  }

  void signedSelfie();
  void uploadPendingSelfie().then(() => signedSelfie()).catch(err => console.warn('Selfie sync notice:', err));
  void loadMember().catch(error => {
    console.error('loadMember error:', error);
    toast(friendlyError(error, 'Could not load your attendance details. Please refresh.'), 'error');
  });

  if (isAdmin()) {
    $('adminPanel')?.classList.remove('hidden');
    void loadAdmin();
  }
}

// Active Saturday Date in Nepal Time
function getActiveSaturdayDate() {
  const npt = nptNow();
  const day = npt.getDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat
  const diffToSat = (day + 1) % 7; // Sat: 0, Sun: 1, Mon: 2, etc.
  const sat = new Date(npt.getTime() - diffToSat * 86400000);
  return nptDate(sat);
}

// Load Member Dashboard Data
async function loadMember() {
  text('memberSymbol', profile?.symbolnum || 'Not assigned yet');
  const today = nptDate();

  const [lawResult, aggregateResult, attendanceResult, stackPointsResult, streakRpcResult] = await Promise.all([
    supabase.from('choir_personal_laws').select('personal_law').eq('user_id', user.id).limit(1),
    supabase.from('choir_attendance_aggregate').select('*').order('name'),
    supabase.from('choir_attendance_stack').select('attendance_status,attendance_on_time,time_filled').eq('user_id', user.id).eq('datefilled', today).neq('attendance_status', 'manual').order('time_filled', { ascending: false }).limit(1),
    supabase.from('choir_attendance_stack').select('user_id,point,datefilled,attendance_on_time,attendance_status').lte('datefilled', today).order('datefilled', { ascending: false }).limit(5000),
    Promise.resolve(supabase.rpc('choir_get_member_streaks')).catch(err => { console.warn('Streak RPC notice:', err); return { data: null }; })
  ]);

  if (aggregateResult.error) {
    console.error('Error fetching choir_attendance_aggregate:', aggregateResult.error);
    throw aggregateResult.error;
  }

  const personalLaw = (Array.isArray(lawResult?.data) ? lawResult.data[0]?.personal_law : lawResult?.data?.personal_law) || null;
  if (personalLaw) {
    $('personalLawCard')?.classList.remove('hidden');
    text('personalLaw', personalLaw);
  }

  const stackPointsByUser = {};
  const userAttendanceRecords = {};
  (stackPointsResult?.data || []).forEach(row => {
    stackPointsByUser[row.user_id] = (stackPointsByUser[row.user_id] || 0) + (Number(row.point) || 0);
    if (row.attendance_status !== 'manual') {
      if (!userAttendanceRecords[row.user_id]) userAttendanceRecords[row.user_id] = [];
      userAttendanceRecords[row.user_id].push(row);
    }
  });

  const activeSatStr = getActiveSaturdayDate();
  const activeSatDate = new Date(activeSatStr + 'T12:00:00Z');
  const streakByUser = {};

  // Streaks from database security-definer RPC
  (streakRpcResult?.data || []).forEach(item => {
    if (item.user_id && item.streak !== undefined) {
      streakByUser[item.user_id] = Number(item.streak) || 0;
    }
  });

  // Client-side fallback continuous calculation
  Object.entries(userAttendanceRecords).forEach(([userId, records]) => {
    records.sort((a, b) => b.datefilled.localeCompare(a.datefilled));
    if (records.length === 0) return;

    const mostRecent = records[0];
    const mostRecentDate = new Date(mostRecent.datefilled + 'T12:00:00Z');
    const daysSinceActive = Math.round((activeSatDate - mostRecentDate) / (1000 * 60 * 60 * 24));

    if (Number(mostRecent.attendance_on_time) !== 1 || daysSinceActive > 7) {
      streakByUser[userId] = 0;
      return;
    }

    let streak = 0;
    let prevDate = null;
    for (const row of records) {
      if (Number(row.attendance_on_time) !== 1) break;
      const rowDate = new Date(row.datefilled + 'T12:00:00Z');
      if (prevDate !== null) {
        const diffDays = Math.round((prevDate - rowDate) / (1000 * 60 * 60 * 24));
        if (diffDays > 7) break;
      }
      streak++;
      prevDate = rowDate;
    }
    streakByUser[userId] = streak;
  });

  const workingDays = Number(settings?.working_days) || 4;
  const aggregates = (aggregateResult.data || []).map(row => {
    const rawStackPoints = stackPointsByUser[row.user_id];
    const onTime = Number(row.total_attendance_on_time) || 0;
    const onTimeBonus = onTime >= workingDays ? 1 : 0;
    const basePoints = rawStackPoints !== undefined ? rawStackPoints : (Number(row.total_points) || 0);
    const totalPoints = rawStackPoints !== undefined ? (basePoints - onTimeBonus) : basePoints;
    return {
      ...row,
      total_points: totalPoints
    };
  });

  const agg = aggregates.find(row => row.user_id === user.id) || { total_points: 0, total_holiday_used: 0, total_attendance_on_time: 0 };
  if (stackPointsByUser[user.id] !== undefined) {
    const myOnTime = Number(agg.total_attendance_on_time) || 0;
    const myBonus = myOnTime >= workingDays ? 1 : 0;
    agg.total_points = stackPointsByUser[user.id] - myBonus;
  }

  const bonusNote = Number(agg.total_attendance_on_time) >= workingDays ? ' (on-time bonus: -1 point applied)' : '';
  const myStreak = (agg.on_time_streak !== undefined && agg.on_time_streak !== null && Number(agg.on_time_streak) > 0)
    ? Number(agg.on_time_streak)
    : (streakByUser[user.id] || 0);
  const streakNote = myStreak > 0 ? ` • active on-time streak: 🔥 ${myStreak}` : '';

  // Render Member Statistics (5 Columns)
  $('memberStats').innerHTML = aggregates.map(row => {
    const isFine = Number(row.total_points) >= 10;
    const streak = (row.on_time_streak !== undefined && row.on_time_streak !== null && Number(row.on_time_streak) > 0)
      ? Number(row.on_time_streak)
      : (streakByUser[row.user_id] || 0);
    const onTimeCount = Number(row.total_attendance_on_time) || 0;
    const streakBadge = streak > 0
      ? `<span class="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-amber-500 to-orange-500 px-2.5 py-0.5 text-xs font-black text-white shadow-sm" title="Active on-time streak: ${streak} continuous Saturdays">🔥 ${streak}</span>`
      : '';
    return `<tr class="${isFine ? 'fine-row' : 'hover:bg-slate-50 transition-colors'}">
      <td class="p-3.5 font-bold text-black">${escape(row.name)}</td>
      <td class="p-3.5 font-extrabold text-black">${row.total_points}</td>
      <td class="p-3.5 font-semibold text-black">${row.total_holiday_used}</td>
      <td class="p-3.5">
        <div class="inline-flex items-center gap-2 font-bold text-black" title="Month on-time: ${onTimeCount}${streak > 0 ? ` • Active streak: 🔥 ${streak}` : ''}">
          <span class="font-extrabold">${onTimeCount}</span>
          ${streakBadge}
        </div>
      </td>
      <td class="p-3.5">${isFine ? '<span class="fine-badge">Fine</span>' : '<span class="text-black font-bold">—</span>'}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="5" class="py-6 text-center font-bold text-black">No member statistics yet.</td></tr>';

  text('statsCaption', `All-time aggregate totals • ${settings.month_name}: ${settings.working_days} working Saturdays • your on-time: ${agg.total_attendance_on_time}${bonusNote}${streakNote}`);

  const npt = nptNow();
  const inWindow = npt.getDay() === 6 && (npt.getHours() > 3 || (npt.getHours() === 3 && npt.getMinutes() >= 0)) && npt.getHours() < 23;
  const todayAttendance = (Array.isArray(attendanceResult?.data) ? attendanceResult.data[0] : attendanceResult?.data) || null;
  const alreadySubmitted = Boolean(todayAttendance);

  text('attendanceState', alreadySubmitted ? 'Already filled in' : inWindow && profile.status === 'approved' ? 'Form is open' : profile.status === 'approved' ? 'Form is closed' : 'Approval required');

  const formClosed = alreadySubmitted || !inWindow || profile.status !== 'approved';
  if ($('attendanceSubmit')) $('attendanceSubmit').disabled = formClosed;
  if ($('reasonInput')) $('reasonInput').disabled = formClosed;
  document.querySelectorAll('.status-btn').forEach(button => { button.disabled = formClosed; });

  if (alreadySubmitted) closeAttendanceForm(attendanceCompleteMessage(todayAttendance));
}

// Attendance Submission Event Handlers
$('retryAttendance')?.addEventListener('click', () => $('attendanceForm')?.requestSubmit());

document.querySelectorAll('.status-btn').forEach(button => {
  button.addEventListener('click', () => {
    selectedStatus = button.dataset.status;
    document.querySelectorAll('.status-btn').forEach(el => el.classList.toggle('active', el === button));
    $('reasonWrap')?.classList.toggle('hidden', selectedStatus !== 'absent');
    clearAttendanceResult();
  });
});
document.querySelector('[data-status="present"]')?.click();

$('attendanceForm')?.addEventListener('submit', async event => {
  event.preventDefault();
  const reason = $('reasonInput').value.trim();
  if (selectedStatus === 'absent' && reason.length < 3) {
    return toast('Please enter a valid reason for absence (at least 3 characters).', 'error');
  }
  const button = $('attendanceSubmit');
  if (button) button.disabled = true;
  clearAttendanceResult();

  let data, error;
  try {
    ({ data, error } = await withLoader('Saving attendance', 'Recording your Saturday attendance', () =>
      supabase.rpc('choir_submit_attendance', {
        p_symbol: profile.symbolnum,
        p_status: selectedStatus,
        p_reason: reason || null
      })
    ));
  } catch (requestError) {
    error = requestError;
  }
  if (button) button.disabled = false;

  if (error) {
    console.error('Attendance submission error:', error);
    if (error.code === '23505' || String(error.message || '').toLowerCase().includes('duplicate key')) {
      await loadMember();
      return toast('You have already filled in attendance for today.');
    }
    const message = friendlyError(error, 'Could not save attendance. Please try again.');
    showAttendanceResult('Attendance not saved.', message, 'error');
    return toast(message, 'error');
  }

  showAttendanceResult('Attendance complete.', attendanceCompleteMessage(data));
  toast('You have successfully filled in attendance for this Saturday.');
  event.target.reset();
  selectedStatus = 'present';
  document.querySelectorAll('.status-btn').forEach(el => el.classList.toggle('active', el.dataset.status === 'present'));
  $('reasonWrap')?.classList.add('hidden');
  closeAttendanceForm(attendanceCompleteMessage(data));
  await loadMember();
});

// Admin Unsubmitted Saturday Attendance Table
async function loadUnsubmittedSaturday(targetDate) {
  const satDate = targetDate || $('saturdayDateSelect')?.value || getActiveSaturdayDate();
  if ($('saturdayDateSelect') && $('saturdayDateSelect').value !== satDate) {
    $('saturdayDateSelect').value = satDate;
  }
  const captionEl = $('unsubmittedCaption');
  if (captionEl) captionEl.textContent = `Approved members who have not yet submitted attendance for Saturday (${satDate}).`;

  const [approvedRes, stackRes] = await Promise.all([
    supabase.from('choir_profiles').select('id,full_name,symbolnum,email,phone_num').eq('status', 'approved').order('full_name'),
    supabase.from('choir_attendance_stack').select('user_id,attendance_status').eq('datefilled', satDate)
  ]);

  if (approvedRes.error || stackRes.error) {
    console.error('Error loading unsubmitted Saturday attendance:', approvedRes.error || stackRes.error);
    return;
  }

  const submittedUserIds = new Set();
  const autoMarkedUserIds = new Set();
  (stackRes.data || []).forEach(row => {
    if (row.attendance_status === 'present' || row.attendance_status === 'absent') {
      submittedUserIds.add(row.user_id);
    } else if (row.attendance_status === 'not_filled') {
      autoMarkedUserIds.add(row.user_id);
    }
  });

  const unsubmitted = (approvedRes.data || []).filter(m => !submittedUserIds.has(m.id));
  const countEl = $('unsubmittedCount');
  if (countEl) {
    if (unsubmitted.length === 0) {
      countEl.textContent = 'All submitted';
      countEl.className = 'rounded-full bg-emerald-100 px-3 py-0.5 text-xs font-black text-emerald-900 border border-emerald-200';
    } else {
      countEl.textContent = `${unsubmitted.length} pending`;
      countEl.className = 'rounded-full bg-amber-100 px-3 py-0.5 text-xs font-black text-amber-900 border border-amber-200';
    }
  }

  const rowsEl = $('unsubmittedRows');
  if (rowsEl) {
    if (unsubmitted.length === 0) {
      rowsEl.innerHTML = '<tr><td colspan="5" class="py-6 text-center font-bold text-black">All approved choir members have filled attendance for this Saturday! 🎉</td></tr>';
    } else {
      rowsEl.innerHTML = unsubmitted.map(m => {
        const isAutoMarked = autoMarkedUserIds.has(m.id);
        const statusBadge = isAutoMarked
          ? '<span class="rounded-full bg-rose-100 border border-rose-200 px-2.5 py-0.5 text-xs font-black text-rose-800">Auto-marked missing</span>'
          : '<span class="rounded-full bg-amber-100 border border-amber-200 px-2.5 py-0.5 text-xs font-black text-amber-900">Not submitted yet</span>';
        return `<tr class="hover:bg-slate-50 transition-colors">
          <td class="p-3 font-bold text-black">${escape(m.full_name)}</td>
          <td class="p-3"><span class="font-extrabold text-black">${escape(m.symbolnum || '—')}</span></td>
          <td class="p-3 font-medium text-black">${escape(m.email || '—')}</td>
          <td class="p-3 font-medium text-black">${escape(m.phone_num || '—')}</td>
          <td class="p-3">${statusBadge}</td>
        </tr>`;
      }).join('');
    }
  }
}

// Admin Board Data Loader
async function loadAdmin() {
  const today = nptDate();
  const npt = nptNow();
  if ((npt.getDay() === 6 && npt.getHours() >= 23) || npt.getDay() === 0) {
    void Promise.resolve(supabase.rpc('choir_mark_missing_attendance')).catch(() => {});
  }
  const syncRequest = supabase.rpc('choir_sync_missing_symbols');

  const [aggregates, pending, allPointsResult] = await Promise.all([
    supabase.from('choir_attendance_aggregate').select('*').order('name'),
    supabase.from('choir_profiles').select('id,full_name,email,phone_num,symbolnum').eq('status', 'pending').order('created_at'),
    supabase.from('choir_attendance_stack').select('user_id,point,datefilled').lte('datefilled', today)
  ]);

  if (aggregates.error || pending.error) {
    return toast(friendlyError(aggregates.error || pending.error, 'Could not load the choir board. Please refresh.'), 'error');
  }

  void Promise.resolve(syncRequest).then(res => {
    if (res?.error && res.error.code !== '42883') console.warn('Symbol sync notice:', res.error);
  }).catch(() => {});

  const adminStackPointsByUser = {};
  (allPointsResult?.data || []).forEach(row => {
    adminStackPointsByUser[row.user_id] = (adminStackPointsByUser[row.user_id] || 0) + (Number(row.point) || 0);
  });

  const workingDays = Number(settings?.working_days) || 4;
  const adminAggregates = (aggregates.data || []).map(r => {
    const rawStackPoints = adminStackPointsByUser[r.user_id];
    const onTime = Number(r.total_attendance_on_time) || 0;
    const onTimeBonus = onTime >= workingDays ? 1 : 0;
    const basePoints = rawStackPoints !== undefined ? rawStackPoints : (Number(r.total_points) || 0);
    const totalPoints = rawStackPoints !== undefined ? (basePoints - onTimeBonus) : basePoints;
    return {
      ...r,
      total_points: totalPoints
    };
  });

  await loadUnsubmittedSaturday($('saturdayDateSelect')?.value);

  const detailSelect = $('memberDetailSelect');
  const previouslySelected = detailSelect?.value;
  if (detailSelect) {
    detailSelect.innerHTML = '<option value="">Choose a member</option>' + adminAggregates.map(r =>
      `<option value="${r.user_id}">${escape(r.name)}${r.symbolnum ? ` (${escape(r.symbolnum)})` : ''}</option>`
    ).join('');
    if (adminAggregates.some(r => r.user_id === previouslySelected)) {
      detailSelect.value = previouslySelected;
    }
  }

  const pendingRows = $('pendingRows');
  if (pendingRows) {
    pendingRows.innerHTML = pending.data.map(r => `<tr>
      <td class="p-3 font-bold text-black">${escape(r.full_name)}</td>
      <td class="p-3 font-medium text-black">${escape(r.email)}</td>
      <td class="p-3 font-medium text-black">${escape(r.phone_num)}</td>
      <td class="p-3 font-bold text-black">${escape(r.symbolnum || 'Not provided')}</td>
      <td class="p-3 whitespace-nowrap">
        <button data-approve="${r.id}" data-has-symbol="${r.symbolnum ? 'true' : 'false'}" class="rounded-xl bg-emerald-600 px-3.5 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-emerald-700 transition">Approve</button>
        <button data-reject="${r.id}" class="rounded-xl bg-red-50 border border-red-200 px-3.5 py-1.5 text-xs font-bold text-red-700 hover:bg-red-100 transition">Reject</button>
      </td>
    </tr>`).join('') || '<tr><td colspan="5" class="p-4 text-center font-bold text-black">No pending member requests.</td></tr>';
  }

  if ($('settingMonth')) $('settingMonth').value = settings.month_name;
  if ($('settingDays')) $('settingDays').value = settings.working_days;
}

function attendanceLabel(row) {
  return row.attendance_status === 'manual'
    ? 'Manual point added'
    : row.attendance_status === 'not_filled'
      ? 'No form submitted'
      : row.attendance_status === 'absent'
        ? 'Absent'
        : 'Present';
}

// Show Member Drilldown Detail
async function showMemberDetail(targetMemberId = null) {
  const memberId = targetMemberId || $('memberDetailSelect')?.value;
  const result = $('memberDetailResult');
  if (!memberId) return toast('Choose a member first.', 'error');
  if ($('memberDetailSelect') && $('memberDetailSelect').value !== memberId) {
    $('memberDetailSelect').value = memberId;
  }
  result.innerHTML = '<p class="text-sm font-bold text-black">Loading member history…</p>';

  const { data: rows, error } = await supabase.from('choir_attendance_stack')
    .select('id,datefilled,month_name,reason,time_filled,point,holiday_used,attendance_on_time,attendance_status')
    .eq('user_id', memberId)
    .order('datefilled', { ascending: false })
    .limit(1000);

  if (error) throw error;

  const memberName = $('memberDetailSelect')?.selectedOptions[0]?.textContent || 'Member';
  const totals = (rows || []).reduce((sum, row) => ({
    points: sum.points + Number(row.point || 0),
    holidays: sum.holidays + Number(row.holiday_used || 0),
    onTime: sum.onTime + Number(row.attendance_on_time || 0)
  }), { points: 0, holidays: 0, onTime: 0 });

  const nonManualRows = (rows || []).filter(r => r.attendance_status !== 'manual').sort((a, b) => b.datefilled.localeCompare(a.datefilled));
  let detailStreak = 0;
  if (nonManualRows.length > 0) {
    const activeSatStr = getActiveSaturdayDate();
    const activeSatDate = new Date(activeSatStr + 'T12:00:00Z');
    const mostRecent = nonManualRows[0];
    const mostRecentDate = new Date(mostRecent.datefilled + 'T12:00:00Z');
    const daysSinceActive = Math.round((activeSatDate - mostRecentDate) / (1000 * 60 * 60 * 24));
    if (Number(mostRecent.attendance_on_time) === 1 && daysSinceActive <= 7) {
      let prevDate = null;
      for (const r of nonManualRows) {
        if (Number(r.attendance_on_time) !== 1) break;
        const rDate = new Date(r.datefilled + 'T12:00:00Z');
        if (prevDate !== null) {
          const diffDays = Math.round((prevDate - rDate) / (1000 * 60 * 60 * 24));
          if (diffDays > 7) break;
        }
        detailStreak++;
        prevDate = rDate;
      }
    }
  }

  result.innerHTML = `
    <div class="grid gap-3 sm:grid-cols-4">
      <div class="rounded-2xl border border-sky-100 bg-sky-50/80 p-4 shadow-sm">
        <p class="text-xs font-black uppercase text-blue-900">Member</p>
        <p class="mt-1 font-extrabold text-black truncate">${escape(memberName)}</p>
      </div>
      <div class="rounded-2xl border border-sky-100 bg-sky-50/80 p-4 shadow-sm">
        <p class="text-xs font-black uppercase text-blue-900">Points received</p>
        <p class="mt-1 text-2xl font-black text-black">${totals.points}</p>
      </div>
      <div class="rounded-2xl border border-sky-100 bg-sky-50/80 p-4 shadow-sm">
        <p class="text-xs font-black uppercase text-blue-900">Holidays used</p>
        <p class="mt-1 text-2xl font-black text-black">${totals.holidays}</p>
      </div>
      <div class="rounded-2xl border border-sky-100 bg-sky-50/80 p-4 shadow-sm">
        <p class="text-xs font-black uppercase text-blue-900">On time</p>
        <div class="mt-1 flex items-center gap-2">
          <span class="text-2xl font-black text-black">${totals.onTime}</span>
          ${detailStreak > 0 ? `<span class="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-amber-500 to-orange-500 px-2.5 py-0.5 text-xs font-black text-white shadow-sm" title="Active continuous streak: ${detailStreak}">🔥 ${detailStreak}</span>` : ''}
        </div>
      </div>
    </div>

    <!-- Manual Point Entry -->
    <div class="mt-4 rounded-2xl border border-sky-200 bg-sky-50/90 p-4 shadow-sm">
      <form id="detailManualPointsForm" data-member-id="${memberId}" class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 class="text-sm font-black text-black">Give manual points</h3>
          <p class="text-xs font-semibold text-black">Add manual point(s) to this member as stacking records.</p>
        </div>
        <div class="flex items-center gap-2">
          <label for="detailPointsInput" class="text-xs font-black uppercase text-black">Points:</label>
          <input id="detailPointsInput" type="number" min="1" max="100" step="1" value="1" required class="input w-20 py-1.5 px-3 text-center text-sm font-black" aria-label="Manual points to add">
          <button id="detailAddPointsSubmit" type="submit" class="primary-btn py-1.5 px-4 text-xs font-black whitespace-nowrap shadow-sm">
            <i class="fa-solid fa-plus mr-1"></i> Add points
          </button>
        </div>
      </form>
    </div>

    <!-- Attendance Stack History Table -->
    <div class="table-wrap mt-4">
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Month</th>
            <th>Attendance</th>
            <th>Reason / Point source</th>
            <th>Time</th>
            <th>Point</th>
            <th>Holiday</th>
            <th>On time</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          ${(rows || []).map(row => `
            <tr class="hover:bg-slate-50 transition-colors">
              <td class="font-medium text-black">${escape(row.datefilled)}</td>
              <td class="font-medium text-black">${escape(row.month_name)}</td>
              <td><span class="font-bold text-black">${escape(attendanceLabel(row))}</span></td>
              <td class="font-medium text-black">${escape(row.reason || '—')}</td>
              <td class="font-medium text-black">${nptTime(row.time_filled)}</td>
              <td class="font-black text-black">${row.point}</td>
              <td class="font-bold text-black">${row.holiday_used}</td>
              <td class="font-bold text-black">${row.attendance_on_time}</td>
              <td>
                <button type="button" data-delete-detail-record="${row.id}" data-member-id="${memberId}" class="rounded-xl bg-red-50 border border-red-200 px-3 py-1 text-xs font-bold text-red-700 hover:bg-red-100 transition">
                  Delete
                </button>
              </td>
            </tr>
          `).join('') || '<tr><td colspan="9" class="py-5 text-center font-bold text-black">No attendance records for this member.</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
}

// Admin Action Buttons
$('markMissingBtn')?.addEventListener('click', async () => {
  if (!window.confirm('Check and mark missing attendance for approved members who did not submit attendance before Saturday 11:00 PM? Points will be assigned on the monthly holiday rule basis.')) return;
  try {
    await withLoader('Checking missing attendance', 'Recording missing attendance on the rule basis', async () => {
      const { data: count, error } = await supabase.rpc('choir_mark_missing_attendance');
      if (error) throw error;
      await loadAdmin();
      await loadMember();
      const num = Number(count) || 0;
      toast(num > 0 ? `Marked missing attendance for ${num} member${num === 1 ? '' : 's'}.` : 'No missing attendance records were needed for today.');
    });
  } catch (error) {
    toast(friendlyError(error, 'Could not mark missing attendance. Please try again.'), 'error');
  }
});

$('syncDataBtn')?.addEventListener('click', async () => {
  try {
    await withLoader('Refreshing data', 'Loading latest choir information', loadAdmin);
    toast('Data refreshed.');
  } catch (error) {
    toast(friendlyError(error, 'Could not refresh the choir board. Please try again.'), 'error');
  }
});

$('memberDetailBtn')?.addEventListener('click', async () => {
  try {
    await showMemberDetail();
  } catch (error) {
    $('memberDetailResult').innerHTML = '<p class="text-sm font-bold text-red-600">Could not load this member’s detail.</p>';
    toast(friendlyError(error, 'Could not load member details. Please try again.'), 'error');
  }
});

$('memberDetailSelect')?.addEventListener('change', () => {
  if ($('memberDetailSelect').value) {
    showMemberDetail().catch(err => console.error(err));
  }
});

$('saturdayDateSelect')?.addEventListener('change', async () => {
  try {
    await withLoader('Loading status', 'Updating Saturday attendance status', () => loadUnsubmittedSaturday($('saturdayDateSelect').value));
  } catch (error) {
    toast(friendlyError(error, 'Could not load attendance for that date.'), 'error');
  }
});

$('refreshUnsubmittedBtn')?.addEventListener('click', async () => {
  try {
    await withLoader('Refreshing status', 'Checking latest Saturday attendance', () => loadUnsubmittedSaturday($('saturdayDateSelect')?.value));
    toast('Saturday attendance status refreshed.');
  } catch (error) {
    toast(friendlyError(error, 'Could not refresh attendance status.'), 'error');
  }
});

// Manual points form submission
$('memberDetailResult')?.addEventListener('submit', async event => {
  if (event.target.id !== 'detailManualPointsForm') return;
  event.preventDefault();
  const form = event.target;
  const memberId = form.dataset.memberId;
  const pointsInput = $('detailPointsInput');
  const submitBtn = $('detailAddPointsSubmit') || submitButton(form);
  const points = Number(pointsInput?.value);
  if (!memberId) return toast('No member selected.', 'error');
  if (!Number.isInteger(points) || points < 1 || points > 100) return toast('Enter a whole number from 1 to 100.', 'error');
  if (submitBtn) submitBtn.disabled = true;
  try {
    await withLoader('Adding manual points', `Saving ${points} manual point${points === 1 ? '' : 's'}`, async () => {
      const { data, error } = await supabase.rpc('choir_admin_add_manual_points', { p_user_id: memberId, p_points: points });
      if (error) throw error;
      if (Number(data) !== points) throw new Error('Not all manual points were saved. Please refresh and try again.');
      await showMemberDetail(memberId);
      await loadAdmin();
      await loadMember();
    });
    toast(`${points} manual point${points === 1 ? '' : 's'} added.`);
  } catch (error) {
    toast(friendlyError(error, 'Could not add manual points. Please try again.'), 'error');
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
});

// Row deletion in member detail
$('memberDetailResult')?.addEventListener('click', async event => {
  const deleteBtn = event.target.closest('[data-delete-detail-record]');
  if (!deleteBtn) return;
  const recordId = deleteBtn.dataset.deleteDetailRecord;
  const memberId = deleteBtn.dataset.memberId || $('memberDetailSelect')?.value;
  if (!recordId || !window.confirm('Delete this attendance record? This cannot be undone.')) return;
  deleteBtn.disabled = true;
  try {
    await withLoader('Deleting record', 'Removing the selected attendance record', async () => {
      const { error } = await supabase.rpc('choir_admin_delete_stack_row', { p_stack_id: recordId });
      if (error) throw error;
      await showMemberDetail(memberId);
      await loadAdmin();
      await loadMember();
    });
    toast('Record deleted.');
  } catch (error) {
    toast(friendlyError(error, 'Could not delete that record. Please try again.'), 'error');
  } finally {
    deleteBtn.disabled = false;
  }
});

// Member Request Approval / Rejection
$('pendingRows')?.addEventListener('click', async event => {
  const approve = event.target.dataset.approve;
  const reject = event.target.dataset.reject;
  if (!approve && !reject) return;
  if (approve && event.target.dataset.hasSymbol !== 'true') return toast('This member needs a symbol number before you can approve them.', 'error');
  const id = approve || reject;
  const update = approve ? { status: 'approved' } : { status: 'rejected' };
  try {
    await withLoader(approve ? 'Approving member' : 'Rejecting member', 'Updating the member request', async () => {
      const { error } = await supabase.from('choir_profiles').update(update).eq('id', id);
      if (error) throw error;
      const { error: rebuildError } = await supabase.rpc('choir_rebuild_aggregate');
      if (rebuildError) throw rebuildError;
      await loadAdmin();
    });
    toast(approve ? 'Member approved.' : 'Member rejected.');
  } catch (error) {
    toast(friendlyError(error, 'Could not update this member. Please try again.'), 'error');
  }
});

// Personal Law Form Submission
$('lawForm')?.addEventListener('submit', async event => {
  event.preventDefault();
  const symbol = $('lawSymbol').value.trim();
  try {
    await withLoader('Saving personal law', 'Updating pastoral guidance', async () => {
      const { data: member, error } = await supabase.from('choir_profiles').select('id').eq('symbolnum', symbol).single();
      if (error) throw new Error('No member was found for that symbol number.');
      const { error: saveError } = await supabase.from('choir_personal_laws').upsert({
        user_id: member.id,
        personal_law: $('lawText').value.trim()
      }, { onConflict: 'user_id' });
      if (saveError) throw saveError;
    });
    event.target.reset();
    toast('Personal law saved.');
  } catch (error) {
    toast(friendlyError(error, 'Could not save personal law. Please try again.'), 'error');
  }
});

// Working Month Settings Submission
$('settingsForm')?.addEventListener('submit', async event => {
  event.preventDefault();
  const month = $('settingMonth').value.trim();
  const days = Number($('settingDays').value);
  try {
    await withLoader('Saving month settings', 'Preserving aggregate totals', async () => {
      const { error } = await supabase.rpc('choir_admin_set_settings', { p_month: month, p_working_days: days });
      if (error) throw error;
      settings.month_name = month;
      settings.working_days = days;
      await loadMember();
      await loadAdmin();
    });
    toast('Month settings saved; aggregate totals preserved.');
  } catch (error) {
    toast(friendlyError(error, 'Could not save month settings. Please try again.'), 'error');
  }
});

// CSV Export
$('csvExport')?.addEventListener('click', async () => {
  try {
    await withLoader('Preparing CSV', 'Collecting active month attendance data', async () => {
      const { data, error } = await supabase.from('choir_attendance_stack')
        .select('symbol,datefilled,month_name,name,reason,time_filled,point,holiday_used,attendance_on_time,attendance_status')
        .eq('month_name', settings.month_name)
        .order('datefilled');
      if (error) throw error;
      const headers = ['Symbol', 'Datefilled', 'Month', 'Name', 'Reason', 'Time filled', 'Point', 'Holiday used', 'Attendance on time', 'Status'];
      const csv = [headers, ...data.map(Object.values)].map(row => row.map(v => `"${String(v ?? '').replaceAll('"', '""')}"`).join(',')).join('\n');
      const link = document.createElement('a');
      link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
      link.download = `${settings.month_name}-choir-attendance.csv`;
      link.click();
      URL.revokeObjectURL(link.href);
    });
  } catch (error) {
    toast(friendlyError(error, 'Could not prepare CSV export. Please try again.'), 'error');
  }
});

// Logout
$('logoutBtn')?.addEventListener('click', async () => {
  try {
    showLoader('Signing you out', 'Closing your session');
    await supabase.auth.signOut({ scope: 'local' });
    location.replace(location.pathname);
  } catch (error) {
    hideLoader();
    toast(friendlyError(error, 'Could not sign you out. Please try again.'), 'error');
  }
});

// Session initialization
supabase.auth.getSession().then(async ({ data }) => {
  if (data?.session) {
    await withLoader('Opening portal', 'Loading your choir account', boot);
  }
}).catch(error => {
  hideLoader();
  toast(friendlyError(error, 'Could not open your choir portal. Please refresh.'), 'error');
});
