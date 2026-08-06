/**
 * Sugam Choir companion script.
 * Bind this script to the supplied Google Sheet, then set Script Properties:
 * SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, APP_URL
 *
 * Never put the service-role key in the website.  Script Properties are only
 * visible to spreadsheet/script editors.
 */
const TZ = 'Asia/Kathmandu';
const HEADERS = {
  Aggregate: ['Name', 'Email', 'Symbolnum', 'Phone num', 'Total Points', 'Total Holiday Used', 'Total Attendance On Time'],
  'Attendance Stack': ['Symbol', 'Datefilled', 'Month', 'Name', 'Reason', 'Time filled', 'Point (0/1)', 'Holiday used (0/1)', 'Attendance on time (0/1)', 'Status'],
  'Personal Laws': ['Symbol', 'Personal law'],
  Settings: ['Month name', 'Number of working days']
};

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Sugam Choir')
    .addItem('Set up / repair tabs', 'setupWorkbook')
    .addItem('Sync data from Supabase', 'syncWorkbook')
    .addItem('Create Excel export in Drive', 'exportWorkbookXlsx')
    .addItem('Create CSV export in Drive', 'exportAttendanceCsv')
    .addItem('Install Saturday schedule', 'installSchedule')
    .addToUi();
}

function setupWorkbook() {
  const book = SpreadsheetApp.getActive();
  Object.keys(HEADERS).forEach(name => {
    const sheet = book.getSheetByName(name) || book.insertSheet(name);
    sheet.clear();
    sheet.getRange(1, 1, 1, HEADERS[name].length).setValues([HEADERS[name]]);
    sheet.getRange(1, 1, 1, HEADERS[name].length).setFontWeight('bold').setBackground('#1f2937').setFontColor('#ffffff');
    sheet.setFrozenRows(1);
    sheet.autoResizeColumns(1, HEADERS[name].length);
  });
  SpreadsheetApp.getUi().alert('Tabs are ready. Use “Sync data from Supabase” after the database is set up.');
}

/** Install once. Apps Script time triggers are approximate, so the minute runner
 * checks Kathmandu time and calls each action once per date. */
function installSchedule() {
  ScriptApp.getProjectTriggers().forEach(t => { if (t.getHandlerFunction() === 'runSaturdaySchedule') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('runSaturdaySchedule').timeBased().everyMinutes(5).create();
  SpreadsheetApp.getUi().alert('Schedule installed. It checks every five minutes and only acts on Saturdays in Nepal time.');
}

function runSaturdaySchedule() {
  const now = new Date();
  const weekday = Utilities.formatDate(now, TZ, 'u'); // 6 = Saturday
  if (weekday !== '6') return;
  const date = Utilities.formatDate(now, TZ, 'yyyy-MM-dd');
  const clock = Utilities.formatDate(now, TZ, 'HH:mm');
  if (clock >= '09:40' && clock < '09:50') sendReminderOnce_(date, '0940', 'Attendance window closes at 9:50 AM',
    'Please fill in your choir attendance now. The on-time window closes at 9:50 AM Nepal time.');
  if (clock >= '15:00' && clock < '15:10') sendReminderOnce_(date, '1500', 'Please complete today’s attendance',
    'You have not filled attendance today. If you are absent, please choose Absent and enter a valid reason before 11:00 PM.');
  if (clock >= '21:30' && clock < '21:40') sendReminderOnce_(date, '2130', 'Final attendance reminder',
    'Today’s attendance form closes at 11:00 PM Nepal time. Please submit now.');
  if (clock >= '23:01' && clock < '23:15') markMissingOnce_(date);
}

function sendReminderOnce_(date, label, subject, message) {
  const key = `sent_${date}_${label}`;
  if (PropertiesService.getScriptProperties().getProperty(key)) return;
  const outstanding = outstandingMembers_(date);
  if (!outstanding.length) { PropertiesService.getScriptProperties().setProperty(key, 'none'); return; }
  const appUrl = config_().APP_URL;
  outstanding.forEach(member => GmailApp.sendEmail(member.email, subject, `${message}\n\nOpen Sugam Choir: ${appUrl}`, { name: 'Sugam Prathana Bhawan' }));
  PropertiesService.getScriptProperties().setProperty(key, String(outstanding.length));
}

function markMissingOnce_(date) {
  const key = `missing_${date}`;
  if (PropertiesService.getScriptProperties().getProperty(key)) return;
  // This protected Postgres function creates the required 1/1/0 rows only for members without a row.
  supabaseRpc_('choir_mark_missing_attendance', {});
  PropertiesService.getScriptProperties().setProperty(key, 'done');
  syncWorkbook();
}

function outstandingMembers_(date) {
  const members = supabaseGet_('choir_profiles?status=eq.approved&select=id,email,full_name');
  const logged = supabaseGet_(`choir_attendance_stack?datefilled=eq.${date}&select=user_id`);
  const loggedIds = new Set(logged.map(r => r.user_id));
  return members.filter(member => member.email && !loggedIds.has(member.id));
}

/** Refreshes the sheet as a read-only reporting/export copy of Supabase. */
function syncWorkbook() {
  setupTabsIfNeeded_();
  const aggregate = supabaseGet_('choir_attendance_aggregate?select=name,email,symbolnum,phone_num,total_points,total_holiday_used,total_attendance_on_time&order=name');
  const stack = supabaseGet_('choir_attendance_stack?select=symbol,datefilled,month_name,name,reason,time_filled,point,holiday_used,attendance_on_time,attendance_status&order=datefilled.desc');
  const laws = supabaseGet_('choir_personal_laws?select=personal_law,choir_profiles(symbolnum)&order=updated_at.desc');
  const settings = supabaseGet_('choir_settings?id=eq.1&select=month_name,working_days');
  writeRows_('Aggregate', aggregate.map(r => [r.name,r.email,r.symbolnum,r.phone_num,r.total_points,r.total_holiday_used,r.total_attendance_on_time]));
  writeRows_('Attendance Stack', stack.map(r => [r.symbol,r.datefilled,r.month_name,r.name,r.reason,r.time_filled,r.point,r.holiday_used,r.attendance_on_time,r.attendance_status]));
  writeRows_('Personal Laws', laws.map(r => [r.choir_profiles ? r.choir_profiles.symbolnum : '',r.personal_law]));
  writeRows_('Settings', settings.map(r => [r.month_name,r.working_days]));
}

function setupTabsIfNeeded_() {
  const book = SpreadsheetApp.getActive();
  Object.keys(HEADERS).forEach(name => {
    const sheet = book.getSheetByName(name) || book.insertSheet(name);
    if (sheet.getLastRow() === 0) sheet.getRange(1, 1, 1, HEADERS[name].length).setValues([HEADERS[name]]).setFontWeight('bold');
  });
}

function writeRows_(tab, rows) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(tab);
  const width = HEADERS[tab].length;
  if (sheet.getLastRow() > 1) sheet.getRange(2, 1, sheet.getLastRow() - 1, width).clearContent();
  if (rows.length) sheet.getRange(2, 1, rows.length, width).setValues(rows);
  sheet.autoResizeColumns(1, width);
}

// These exports are generated by Apps Script after a fresh Supabase sync.
// The created files appear in the script owner's Google Drive.
function exportWorkbookXlsx() {
  syncWorkbook();
  const book = SpreadsheetApp.getActive();
  const token = ScriptApp.getOAuthToken();
  const response = UrlFetchApp.fetch(`https://docs.google.com/spreadsheets/d/${book.getId()}/export?format=xlsx`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const month = supabaseGet_('choir_settings?id=eq.1&select=month_name')[0].month_name;
  const file = DriveApp.createFile(response.getBlob().setName(`Sugam-Choir-${month}.xlsx`));
  SpreadsheetApp.getUi().alert(`Excel export created in Drive:\n${file.getUrl()}`);
}

function exportAttendanceCsv() {
  syncWorkbook();
  const sheet = SpreadsheetApp.getActive().getSheetByName('Attendance Stack');
  const csv = sheet.getDataRange().getDisplayValues().map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
  const month = supabaseGet_('choir_settings?id=eq.1&select=month_name')[0].month_name;
  const file = DriveApp.createFile(`Sugam-Choir-${month}.csv`, csv, MimeType.CSV);
  SpreadsheetApp.getUi().alert(`CSV export created in Drive:\n${file.getUrl()}`);
}

function config_() {
  const props = PropertiesService.getScriptProperties().getProperties();
  ['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','APP_URL'].forEach(k => { if (!props[k]) throw new Error(`Missing Script Property: ${k}`); });
  return props;
}

function supabaseGet_(path) {
  const cfg = config_();
  const response = UrlFetchApp.fetch(`${cfg.SUPABASE_URL}/rest/v1/${path}`, { headers: supabaseHeaders_(cfg) });
  return JSON.parse(response.getContentText());
}

function supabaseRpc_(functionName, body) {
  const cfg = config_();
  const response = UrlFetchApp.fetch(`${cfg.SUPABASE_URL}/rest/v1/rpc/${functionName}`, {
    method: 'post', contentType: 'application/json', payload: JSON.stringify(body), headers: supabaseHeaders_(cfg), muteHttpExceptions: true
  });
  if (response.getResponseCode() >= 300) throw new Error(`Supabase job failed: ${response.getContentText()}`);
  return JSON.parse(response.getContentText());
}

function supabaseHeaders_(cfg) { return { apikey: cfg.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${cfg.SUPABASE_SERVICE_ROLE_KEY}` }; }
