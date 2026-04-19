// ═══════════════════════════════════════════════════════════════
// core/time.js — Canonical time, shift, and schedule logic
// ═══════════════════════════════════════════════════════════════
// Single source of truth for all time-related decisions.
// Every other module should import from here instead of
// reimplementing time checks.
// ═══════════════════════════════════════════════════════════════

// On-Call schedule: starts 07:30 and covers 24h (next day 07:30)
// If current time < 07:30 → we are still in YESTERDAY's schedule

function getScheduleDate(now) {
  const mins = now.getHours() * 60 + now.getMinutes();
  const cutoff = 7 * 60 + 30; // 07:30
  if (mins < cutoff) {
    const y = new Date(now.getTime() - 86400000);
    return { date: y, isOvernight: true };
  }
  return { date: now, isOvernight: false };
}

function fmtKey(d) {
  return String(d.getDate()).padStart(2,'0') + '/' + String(d.getMonth()+1).padStart(2,'0');
}

function getShiftLabel(now) {
  const mins = now.getHours() * 60 + now.getMinutes();
  if (mins < 7*60+30)  return '🌙 Night carry-over (07:30 tomorrow)';
  if (mins < 16*60+30) return '🌅 Day shift (07:30–16:30)';
  return '🌆 Evening/Night shift (16:30–07:30)';
}

// Helper: is it working hours (07:30–16:30)?
function isWorkHours(now) {
  const m = now.getHours() * 60 + now.getMinutes();
  return m >= 7 * 60 + 30 && m < 16 * 60 + 30;
}

function activeShiftMode(now) {
  return isWorkHours(now) ? 'on-duty' : 'on-call';
}

// Saudi weekend: Friday (5) and Saturday (6)
function isWeekend(now) {
  const day = now.getDay();
  return day === 5 || day === 6;
}

function timeRangeActive(now, startMinutes, endMinutes) {
  const mins = now.getHours() * 60 + now.getMinutes();
  if (endMinutes > startMinutes) return mins >= startMinutes && mins < endMinutes;
  return mins >= startMinutes || mins < endMinutes;
}

// ═══════════════════════════════════════════════════════════════
// SPECIALTY SCHEDULE RULES
// ═══════════════════════════════════════════════════════════════

const SPECIALTY_SCHEDULE_RULES = {
  radiology_oncall: {
    isActive(now=new Date()) {
      if (isWeekend(now)) return true; // Friday/Saturday full 24h
      return timeRangeActive(now, 16 * 60 + 30, 7 * 60 + 30);
    },
    currentShift(now=new Date()) {
      if (isWeekend(now)) return { label:'Current Shift', time:'07:30-07:30' };
      return { label:'Current Shift', time:'16:30-07:30' };
    },
  },
  radiology_duty: {
    isActive(now=new Date()) {
      if (isWeekend(now)) return false;
      return timeRangeActive(now, 7 * 60 + 30, 16 * 60 + 30);
    },
    currentShift() {
      return { label:'Current Shift', time:'07:30-16:30' };
    },
  },
};

function getSpecialtyScheduleRule(deptKey='') {
  return SPECIALTY_SCHEDULE_RULES[deptKey] || null;
}

function isSpecialtyActiveNow(deptKey='', now=new Date()) {
  const rule = getSpecialtyScheduleRule(deptKey);
  if (rule && typeof rule.isActive === 'function') return !!rule.isActive(now);
  return deptKey === 'radiology_oncall' ? !isWorkHours(now) : isWorkHours(now);
}

function getSpecialtyCurrentShiftMeta(deptKey='', now=new Date()) {
  const rule = getSpecialtyScheduleRule(deptKey);
  if (rule && typeof rule.currentShift === 'function') return rule.currentShift(now);
  return deptKey === 'radiology_oncall'
    ? { label:'Current Shift', time:'16:30-07:30' }
    : { label:'Current Shift', time:'07:30-16:30' };
}

function runSpecialtyScheduleRuleTests() {
  const makeDate = (iso) => new Date(`${iso}+03:00`);
  const tests = [
    { label:'Friday 10:00 AM', deptKey:'radiology_oncall', at:'2026-04-10T10:00:00', expected:true },
    { label:'Friday 11:00 PM', deptKey:'radiology_oncall', at:'2026-04-10T23:00:00', expected:true },
    { label:'Saturday 2:00 PM', deptKey:'radiology_oncall', at:'2026-04-11T14:00:00', expected:true },
    { label:'Saturday 11:30 PM', deptKey:'radiology_oncall', at:'2026-04-11T23:30:00', expected:true },
    { label:'Sunday 10:00 AM', deptKey:'radiology_oncall', at:'2026-04-12T10:00:00', expected:false },
    { label:'Sunday 5:00 PM', deptKey:'radiology_oncall', at:'2026-04-12T17:00:00', expected:true },
    { label:'Monday 3:00 AM', deptKey:'radiology_oncall', at:'2026-04-13T03:00:00', expected:true },
    { label:'Monday 10:00 AM', deptKey:'radiology_oncall', at:'2026-04-13T10:00:00', expected:false },
  ];
  return tests.map(test => {
    const actual = isSpecialtyActiveNow(test.deptKey, makeDate(test.at));
    return { ...test, actual, passed: actual === test.expected };
  });
}

// ═══════════════════════════════════════════════════════════════
// ShiftWindow — Unified time activation model
// ═══════════════════════════════════════════════════════════════
// Every entry should carry a ShiftWindow for unambiguous activation.
// {
//   start: '07:30',      // HH:MM
//   end:   '16:30',      // HH:MM (supports midnight wrap)
//   days:  [0,1,2,3,4],  // 0=Sun ... 6=Sat
//   type:  'day'          // 'day' | 'night' | '24h'
// }

function parseTimeToMinutes(timeStr) {
  if (!timeStr) return NaN;
  const [h, m='00'] = String(timeStr).split(':');
  return Number(h) * 60 + Number(m);
}

function isShiftWindowActive(shiftWindow, now) {
  if (!shiftWindow) return false;
  const day = now.getDay();
  if (shiftWindow.days && !shiftWindow.days.includes(day)) return false;
  if (shiftWindow.type === '24h') return true;
  const startMin = parseTimeToMinutes(shiftWindow.start);
  const endMin = parseTimeToMinutes(shiftWindow.end);
  if (Number.isNaN(startMin) || Number.isNaN(endMin)) {
    return shiftWindow.type === 'day' ? isWorkHours(now) : !isWorkHours(now);
  }
  return timeRangeActive(now, startMin, endMin);
}

// ═══════════════════════════════════════════════════════════════
// CLOCK (DOM-dependent — kept here as it's purely time logic)
// ═══════════════════════════════════════════════════════════════
const DAYS_AR = ['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];

function tick() {
  const now = new Date();
  const h = String(now.getHours()).padStart(2,'0');
  const m = String(now.getMinutes()).padStart(2,'0');
  const s = String(now.getSeconds()).padStart(2,'0');
  const dd = String(now.getDate()).padStart(2,'0');
  const mo = String(now.getMonth()+1).padStart(2,'0');
  document.getElementById('ldate').textContent = `${dd}/${mo}/${now.getFullYear()}`;
  document.getElementById('lday').textContent = DAYS_AR[now.getDay()];
  document.getElementById('ltime').textContent = `${h}:${m}:${s}`;
  const { isOvernight, date } = getScheduleDate(now);
  const warn = document.getElementById('shift-warn');
  if (isOvernight) {
    warn.textContent = `⚠️ الوقت الحالي ${h}:${m} — قبل 07:30. المناوب المعروض هو دكتور ${fmtKey(date)} (مناوبة بدأت 07:30 أمس ولا تزال سارية)`;
    warn.classList.add('show');
  } else {
    warn.classList.remove('show');
  }
}
