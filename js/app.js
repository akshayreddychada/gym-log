import { firebaseConfig } from './config.js';
import {
  DEFAULT_SETTINGS, PLATE, ymd, parseYmd, addDays, daysBetween, nextDay, bySessionTime, convert, fmtW, e1rm,
  doneSets, sessionStats, exerciseHistory, lastSetsFor, bestE1rm, newSession, weekStart, streakDays, slug, uid,
  muscleLastTrained, setsByMuscle,
} from './data.js';
import { lineChart, barChart } from './charts.js';
import { FOODS, FOOD_CATS, foodById, macrosFor } from './foods.js';
import { MUSCLES, muscleById, LIBRARY, libById, muscleOf, DAY_MUSCLES, DEFAULT_SUPPS } from './library.js';
import { MEALS, ML_PER_OZ, DEFAULT_PROFILE, DEFAULT_TARGETS, dayTotals, calcTargets } from './nutrition.js';
import { bodyMap } from './body.js';
import {
  JOURNEY_DEFAULTS, planFor, buildMeals, MEAL_OPTIONS, inJourney, totalDays, targetKg, groceries, checkinAdvice, CHECKIN_DAYS,
  routineFromSplit, prescription, setsFor, phaseOf, itemName, itemAmount, daysToGo, WHEY, FLEX_TREAT, KCAL, PROTEIN, FAT,
} from './journey.js';

const $app = document.getElementById('app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (v) => { const n = parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) ? n : ''; };
const fmtInt = (n) => Math.round(n || 0).toLocaleString();
const r1 = (n) => Math.round((n || 0) * 10) / 10;
const longDate = (s) => parseYmd(s).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
const shortDate = (s) => parseYmd(s).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const mdDate = (s) => parseYmd(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const plate = (c) => PLATE[c] || PLATE.yellow;
// "150 g", "2 × large egg · 100 g", "1 × ½ cup (40 g)"
const qtyLabel = (f) => (f.unit === 'g' ? `${fmtInt(f.qty)} g` : f.unit === 'oz' ? `${r1(f.qty)} oz · ${fmtInt(f.g)} g` : `${r1(f.qty)} × ${f.unit}${/\d\s*g\)/.test(f.unit) ? '' : ` · ${fmtInt(f.g)} g`}`);
const C = { kcal: '#E7B53A', p: '#D8463B', c: '#3F7CE0', f: '#9B7BD4', fib: '#3FA66B', water: '#4FA3E0', steps: '#3FA66B', score: '#E7B53A', rec: '#3FA66B', strain: '#3F7CE0' };

const S = {
  db: null, user: undefined, settings: null, sessions: [], daily: {}, loaded: { settings: false, sessions: false, daily: false },
  tab: 'today', date: ymd(), draft: null, sheet: null, rest: null, authMode: 'in', authMsg: '', busy: false,
  plan: null, openDay: null, watchStop: null, planTab: 'days', shopWeek: 0,
  trend: { mode: 'overview', exId: null, metric: 'e1rm', range: 'all', days: 30, bodyRange: 'all' },
  hist: { month: ymd().slice(0, 7), sel: ymd() },
};
const unit = () => S.settings?.unit || 'lb';
const routine = () => S.settings?.routine || DEFAULT_SETTINGS.routine;
const dayData = (d) => S.daily[d] || {};
const activeSupps = () => (S.settings.supps || []).filter((s) => s.on !== false);

// ---------------------------------------------------------------- boot
async function boot() {
  const local = ['localhost', '127.0.0.1'].includes(location.hostname);
  const useMock = local && new URLSearchParams(location.search).has('mock');
  if (firebaseConfig && !useMock) S.db = (await import('./db-firebase.js')).createDb(firebaseConfig);
  else if (local) S.db = (await import('./db-mock.js')).createDb();
  else {
    $app.innerHTML = `<div class="center-screen"><div class="brand-plate"></div><h1 class="display">Gym Log</h1><p class="muted">This app isn't connected to its database yet.</p></div>`;
    return;
  }
  S.db.onAuth((u) => {
    S.user = u;
    S.watchStop?.();
    S.settings = null; S.sessions = []; S.daily = {}; S.loaded = { settings: false, sessions: false, daily: false };
    S.draft = null; S.sheet = null; S.plan = null; S.tab = 'today'; S.date = ymd();
    if (u) {
      S.watchStop = S.db.watch(u.uid, {
        onSettings: (s) => {
          S.loaded.settings = true;
          S.settings = migrate(s || {});
          // First open after the birthday plan shipped: save the new split and targets once.
          if (!s || S.settings._migrated) { delete S.settings._migrated; S.db.saveSettings(u.uid, S.settings).catch(fail); }
          softRender();
        },
        onSessions: (list) => { S.loaded.sessions = true; S.sessions = list.sort(bySessionTime); softRender(); },
        onDaily: (d) => { S.loaded.daily = true; S.daily = d; softRender(); },
        onError: (e) => { console.error(e); toast('Couldn’t reach your data. Check your connection.'); },
      });
    }
    render();
  });
  if ('serviceWorker' in navigator && !local) navigator.serviceWorker.register('sw.js').catch(() => {});
}

// Settings saved by the first version of the app lack the newer sections.
function migrate(s) {
  const d = structuredClone(DEFAULT_SETTINGS);
  return {
    ...d, ...s,
    profile: { ...DEFAULT_PROFILE, ...(s.profile || {}) },
    targets: { ...DEFAULT_TARGETS, ...(s.targets || {}) },
    supps: s.supps || d.supps,
    apt: s.apt || d.apt,
    abs: s.abs || d.abs,
    customFoods: s.customFoods || [],
    favFoods: s.favFoods || [],
    bodyUnit: s.bodyUnit || 'kg',
    waistUnit: s.waistUnit || 'in',
    ...withJourney(s, d),
  };
}
// Adds the birthday plan (Nov 20 → Feb 26) the first time, switching the split to
// Push / Pull / Quads / Rest / Upper / Hamstrings. Exercise ids are unchanged, so history carries over.
function withJourney(s, d) {
  if (s.journey) {
    const j = { ...JOURNEY_DEFAULTS, ...s.journey };
    // The plan moved from Nov 19 to Nov 20 as day 1. Saved once, then left alone.
    if (j.start === '2026-11-19') {
      j.start = '2026-11-20';
      j.shifts = (j.shifts || []).filter((x) => x.from >= j.start);
      j.checkins = {};
      return { journey: j, _migrated: true };
    }
    return { journey: j };
  }
  const prof = { ...DEFAULT_PROFILE, ...(s.profile || {}) };
  return {
    _migrated: true,
    journey: structuredClone(JOURNEY_DEFAULTS),
    routine: routineFromSplit((s.routine || d.routine).warmup),
    stepGoal: 11000,
    profile: { ...prof, age: prof.age || 30, heightIn: prof.heightIn || 69, goal: 'cut' },
  };
}

function fail(e) { console.error(e); toast('Couldn’t save. It will retry when you’re back online.'); }

// ---------------------------------------------------------------- derived numbers
const bu = () => S.settings.bodyUnit || 'kg';
function convBw(w, from, to) { if (from === to) return Math.round(w * 10) / 10; return Math.round((from === 'kg' ? w * 2.20462 : w / 2.20462) * 10) / 10; }
// Body weight of a day entry, in the chosen body-weight unit. Older entries were saved in the lifting unit.
const bwOf = (v, to = bu()) => (v?.bw ? convBw(Number(v.bw), v.bwUnit || v.unit || 'lb', to) : null);
function latestBw(upTo = ymd()) {
  const e = Object.entries(S.daily).filter(([d, v]) => v.bw && d <= upTo).sort((a, b) => (a[0] < b[0] ? 1 : -1))[0];
  return e ? bwOf(e[1]) : null;
}
const J = () => S.settings.journey;
const planOf = (d) => (inJourney(J(), d) ? planFor(J(), d) : null);
function targets(d = S.date) {
  const p = S.settings.journey && planOf(d);
  if (p) return { ...p.targets, journey: true, plan: p, calculated: false };
  const t = S.settings.targets;
  if (t.auto) {
    const bw = latestBw();
    const lb = bw == null ? null : bu() === 'kg' ? bw * 2.20462 : bw;
    const calc = calcTargets(S.settings.profile, lb);
    if (calc) return { ...t, ...calc, calculated: true };
  }
  return { ...t, calculated: false };
}
const waterGoalMl = () => targets().waterMl || 3500;
const isOz = () => (S.settings.waterUnit || 'oz') === 'oz';
const fmtWater = (ml) => (isOz() ? `${fmtInt(ml / ML_PER_OZ)} oz` : ml >= 1000 ? `${r1(ml / 1000)} L` : `${fmtInt(ml)} ml`);
const waterSizes = () => (isOz() ? [[8, 'Glass'], [16.9, 'Bottle'], [24, 'Shaker'], [32, 'Big bottle']].map(([o, l]) => [Math.round(o * ML_PER_OZ), `${o} oz`, l]) : [[250, '250 ml', 'Glass'], [500, '500 ml', 'Bottle'], [750, '750 ml', 'Shaker'], [1000, '1 L', 'Big bottle']]);

function sessionsOn(d) { return S.sessions.filter((s) => s.status === 'done' && s.date === d); }
function aptFrac(d) {
  if (sessionsOn(d).some((s) => (s.warmup || []).some((w) => w.id === 'apt' && w.done))) return 1;
  const list = S.settings.apt || [];
  if (!list.length) return 0;
  const done = dayData(d).core?.apt || {};
  return list.filter((x) => done[x.id]).length / list.length;
}
function absDone(d) {
  if (sessionsOn(d).some((s) => (s.exercises || []).some((e) => muscleOf(e) === 'abs' && doneSets(e).length))) return true;
  const done = dayData(d).core?.abs || {};
  return (S.settings.abs || []).filter((x) => done[x.id]).length >= 2;
}
function suppsFrac(d) {
  const list = activeSupps();
  if (!list.length) return 0;
  const taken = dayData(d).supps || {};
  return list.filter((s) => Number(taken[s.id]) > 0).length / list.length;
}

// One number for "did I look after myself today". Partial credit where it makes sense.
const stepGoalOn = (d) => planOf(d)?.stepGoal || S.settings.stepGoal || 10000;
function dayScore(d) {
  const t = targets(d);
  const day = dayData(d);
  const tot = dayTotals(day, S.settings.supps);
  const goalSteps = stepGoalOn(d);
  const hasFood = (day.food || []).length > 0;
  const kcalOff = hasFood ? Math.abs(tot.kcal - t.kcal) / t.kcal : 1;
  const items = [
    { k: 'train', label: 'Workout', w: 20, v: sessionsOn(d).length ? 1 : 0, go: 'train' },
    { k: 'protein', label: 'Protein', w: 15, v: Math.min(1, tot.p / (t.p * 0.9)), go: 'fuel' },
    { k: 'kcal', label: 'Calories', w: 10, v: hasFood ? (kcalOff <= 0.1 ? 1 : Math.max(0, 1 - (kcalOff - 0.1) * 3)) : 0, go: 'fuel' },
    { k: 'water', label: 'Water', w: 15, v: Math.min(1, (day.water || 0) / waterGoalMl()), go: 'water' },
    { k: 'steps', label: 'Steps', w: 15, v: Math.min(1, (day.steps || 0) / goalSteps), go: 'steps' },
    { k: 'apt', label: 'Posture', w: 15, v: aptFrac(d), go: 'core' },
    { k: 'supps', label: 'Supps', w: 10, v: suppsFrac(d), go: 'supps' },
  ];
  const pct = Math.round(items.reduce((a, x) => a + x.w * x.v, 0));
  return { pct, items };
}

// ---------------------------------------------------------------- render
let pending = false;
function softRender() {
  const a = document.activeElement;
  if (a && (a.tagName === 'INPUT' || a.tagName === 'SELECT' || a.tagName === 'TEXTAREA') && $app.contains(a)) { pending = true; return; }
  render();
}
function render() {
  pending = false;
  todayAtRender = ymd();
  const keep = [...$app.querySelectorAll('[data-keep]')].map((el) => [el.dataset.keep, el.scrollTop]);
  const winY = window.scrollY;
  $app.innerHTML = view();
  for (const [k, t] of keep) { const el = $app.querySelector(`[data-keep="${k}"]`); if (el) el.scrollTop = t; }
  window.scrollTo(0, winY);
  afterRender();
}
document.addEventListener('focusout', () => setTimeout(() => { if (pending) render(); }, 0));

const VIEWS = { today: todayView, plan: planView, train: trainView, fuel: fuelView, trends: trendsView, history: historyView, setup: setupView };
function view() {
  if (S.user === undefined) return `<div class="center-screen"><div class="brand-plate spin"></div></div>`;
  if (!S.user) return authView();
  if (!S.loaded.settings || !S.loaded.sessions) return `<div class="center-screen"><div class="brand-plate spin"></div><p class="muted">Loading your log</p></div>`;
  const body = S.draft ? workoutView() : `
    <main class="page tab-${S.tab}" style="--day:${plate(nextDay(routine(), S.sessions).color)}">${VIEWS[S.tab]()}</main>
    ${S.tab === 'setup' ? '' : navView()}`;
  return body + (S.sheet ? sheetView() : '');
}

const ICON = {
  today: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="2.5"/>',
  train: '<path d="M3 12h2M19 12h2M7 7v10M17 7v10M5 9v6M19 9v6M7 12h10"/>',
  fuel: '<path d="M12 3c3 3.5 5 6.4 5 9.5a5 5 0 0 1-10 0C7 9.4 9 6.5 12 3z"/><path d="M10 14a2 2 0 0 0 2 2"/>',
  trends: '<path d="M4 19l5-6 4 3 7-9"/><path d="M15 7h5v5"/>',
  history: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>',
  plan: '<path d="M5 21V4"/><path d="M5 4h11l-2.5 4L16 12H5"/>',
  cart: '<path d="M3 4h2l2.4 11h10.2L20 7H6.3"/><circle cx="9" cy="19.5" r="1.4"/><circle cx="17" cy="19.5" r="1.4"/>',
  book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H20v3H6.5"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  left: '<path d="M14 6l-6 6 6 6"/>',
  right: '<path d="M10 6l6 6-6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  star: '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z"/>',
  swap: '<path d="M7 4L4 7l3 3M4 7h13M17 20l3-3-3-3M20 17H7"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
  drop: '<path d="M12 3c3 3.5 5 6.4 5 9.5a5 5 0 0 1-10 0C7 9.4 9 6.5 12 3z"/>',
};
const icon = (k, s = 24) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k]}</svg>`;
const checkSvg = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

function navView() {
  const items = [['today', 'Today'], ['plan', 'Plan'], ['train', 'Train'], ['fuel', 'Fuel'], ['trends', 'Trends']];
  return `<nav class="tabbar">${items.map(([k, l]) => `<button data-act="tab" data-v="${k}" class="${S.tab === k ? 'on' : ''}" aria-current="${S.tab === k}">${icon(k)}<span>${l}</span></button>`).join('')}</nav>`;
}

// Date switcher shared by Today and Fuel, so any past day can be filled in.
function dateBar() {
  const today = ymd();
  const isToday = S.date === today;
  const label = isToday ? 'Today' : S.date === addDays(today, -1) ? 'Yesterday' : shortDate(S.date);
  return `<div class="datebar">
    <button class="icon-btn sm" data-act="date-step" data-v="-1" aria-label="Previous day">${icon('left', 20)}</button>
    <button class="date-label" data-act="date-today">${label}${isToday ? '' : '<small>Back to today</small>'}</button>
    <button class="icon-btn sm" data-act="date-step" data-v="1" aria-label="Next day" ${isToday ? 'disabled' : ''}>${icon('right', 20)}</button>
  </div>`;
}

// ---------------------------------------------------------------- auth
function authView() {
  const up = S.authMode === 'up';
  return `<div class="auth">
    <div class="brand-plate"></div>
    <h1 class="display">Gym Log</h1>
    <p class="muted">Training, food, water, posture and recovery. One log.</p>
    <form id="auth-form" class="stack">
      <label class="field"><span>Email</span><input name="email" type="email" autocomplete="email" required></label>
      <label class="field"><span>Password</span><input name="password" type="password" autocomplete="${up ? 'new-password' : 'current-password'}" minlength="6" required></label>
      ${S.authMsg ? `<p class="form-msg">${esc(S.authMsg)}</p>` : ''}
      <button class="btn primary big" ${S.busy ? 'disabled' : ''}>${up ? 'Create account' : 'Sign in'}</button>
    </form>
    <div class="auth-alt">
      <button class="link" data-act="auth-mode">${up ? 'I already have an account' : 'Create an account'}</button>
      ${up ? '' : '<button class="link" data-act="auth-reset">Forgot password</button>'}
    </div>
  </div>`;
}
const AUTH_ERR = {
  'auth/invalid-credential': 'That email and password don’t match. Try again or reset your password.',
  'auth/wrong-password': 'That email and password don’t match. Try again or reset your password.',
  'auth/user-not-found': 'No account uses that email yet. Create one instead.',
  'auth/email-already-in-use': 'An account already uses that email. Sign in instead.',
  'auth/weak-password': 'Use a password with at least 6 characters.',
  'auth/invalid-email': 'Enter a full email address, like you@example.com.',
  'auth/network-request-failed': 'No connection. Sign-in needs internet the first time.',
  'auth/too-many-requests': 'Too many tries. Wait a minute, then try again.',
  'auth/operation-not-allowed': 'Email sign-in isn’t switched on in Firebase yet.',
};

// ---------------------------------------------------------------- shared widgets
function ring(pct, size, stroke, color, inner = '') {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r, p = Math.max(0, Math.min(1, pct));
  return `<div class="ring-wrap" style="width:${size}px;height:${size}px">
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--surface-2)" stroke-width="${stroke}"/>
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round"
        stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - p)}" transform="rotate(-90 ${size / 2} ${size / 2})" class="ring-arc"/>
    </svg><div class="ring-inner">${inner}</div></div>`;
}
function bar(v, goal, color, label, unitTxt) {
  const pct = goal ? Math.min(100, (v / goal) * 100) : 0;
  return `<div class="mbar"><div class="mbar-top"><span>${label}</span><span class="num"><b>${fmtInt(v)}</b> / ${fmtInt(goal)}${unitTxt}</span></div>
    <div class="meter"><span style="width:${pct}%;background:${color}"></span></div></div>`;
}

function waterCard() {
  const d = dayData(S.date);
  const ml = d.water || 0, goal = waterGoalMl();
  const pct = Math.min(1, ml / goal);
  return `<section class="card water" id="sec-water">
    <div class="card-head"><h2>Water</h2><span class="muted small num">${fmtWater(ml)} of ${fmtWater(goal)}</span></div>
    <div class="water-row">
      <div class="bottle" aria-hidden="true"><div class="bottle-fill" style="height:${pct * 100}%"></div><span>${Math.round(pct * 100)}%</span></div>
      <div class="water-btns">${waterSizes().map(([v, l, n]) => `<button class="wbtn" data-act="water-add" data-v="${v}"><b>+${l}</b><span>${n}</span></button>`).join('')}</div>
    </div>
    ${(d.waterLog || []).length ? `<button class="link muted small" data-act="water-undo">${icon('undo', 16)} Undo last (${fmtWater(d.waterLog[d.waterLog.length - 1])})</button>` : ''}
  </section>`;
}

function suppCard() {
  const d = dayData(S.date);
  const list = activeSupps();
  const taken = d.supps || {};
  const n = list.filter((s) => Number(taken[s.id]) > 0).length;
  return `<section class="card" id="sec-supps">
    <div class="card-head"><h2>Supplements & powders</h2><span class="muted small">${n} of ${list.length}</span></div>
    ${list.length ? `<div class="supp-grid">${list.map((s) => {
      const q = Number(taken[s.id]) || 0;
      return `<div class="supp ${q ? 'on' : ''}">
        <button class="supp-main" data-act="supp-toggle" data-id="${s.id}" aria-pressed="${!!q}">
          <span class="supp-check">${checkSvg}</span>
          <span class="grow"><b>${esc(s.name)}</b><span class="muted small">${esc(s.dose)}${s.when ? ` · ${esc(s.when)}` : ''}${s.kind === 'powder' && s.kcal ? ` · ${s.kcal} kcal, ${s.p} g protein` : ''}</span></span>
        </button>
        ${s.kind === 'powder' && Number(s.kcal) > 0 && q ? `<span class="supp-qty"><button data-act="supp-qty" data-id="${s.id}" data-d="-1" aria-label="One fewer serving">−</button><b>×${q}</b><button data-act="supp-qty" data-id="${s.id}" data-d="1" aria-label="One more serving">+</button></span>` : ''}
      </div>`;
    }).join('')}</div>` : '<p class="muted">Add what you take in Setup.</p>'}
  </section>`;
}

function coreCard() {
  const d = dayData(S.date);
  const core = d.core || {};
  const viaWarmup = sessionsOn(S.date).some((s) => (s.warmup || []).some((w) => w.id === 'apt' && w.done));
  const block = (k, title, list, sub) => {
    const done = core[k] || {};
    const n = list.filter((x) => done[x.id]).length;
    const full = k === 'apt' ? (viaWarmup || n === list.length) : absDone(S.date);
    return `<details class="core-block" ${S.openCore === k ? 'open' : ''} data-core="${k}">
      <summary>
        ${ring(k === 'apt' && viaWarmup ? 1 : list.length ? n / list.length : 0, 44, 5, full ? PLATE.green : PLATE.yellow, `<b>${k === 'apt' && viaWarmup ? '✓' : n}</b>`)}
        <span class="grow"><b>${title}</b><span class="muted small">${full ? (k === 'apt' && viaWarmup ? 'Done in your gym warm-up' : 'Done today') : sub}</span></span>
        <span class="chev">${icon('right', 18)}</span>
      </summary>
      <ul class="check-list">${list.map((x) => `<li><button class="check-item ${done[x.id] ? 'on' : ''}" data-act="core-toggle" data-k="${k}" data-id="${x.id}" aria-pressed="${!!done[x.id]}">
        <span class="check sm ${done[x.id] ? 'on' : ''}">${checkSvg}</span><span class="grow">${esc(x.name)}<span class="muted small">${esc(x.target)}</span></span></button></li>`).join('')}</ul>
      <div class="row-end"><button class="link" data-act="core-all" data-k="${k}">${n === list.length ? 'Clear all' : 'Mark all done'}</button></div>
    </details>`;
  };
  return `<section class="card core" id="sec-core">
    <div class="card-head"><h2>Posture & core</h2><span class="muted small">${aptStreak()} day APT streak</span></div>
    ${block('apt', 'Anterior pelvic tilt fix', S.settings.apt || [], `${(S.settings.apt || []).length} moves · about 20 min`)}
    ${block('abs', 'Abs circuit', S.settings.abs || [], 'Counts when 2+ moves are done, or abs in a gym session')}
  </section>`;
}
function aptStreak() {
  let d = ymd(), n = 0;
  if (aptFrac(d) < 1) d = addDays(d, -1);
  while (aptFrac(d) >= 1) { n++; d = addDays(d, -1); }
  return n;
}

function recoveryCard() {
  const w = dayData(S.date).whoop || {};
  const rec = Number(w.rec);
  const zone = !rec ? null : rec >= 67 ? ['green', 'Green: go hard today'] : rec >= 34 ? ['yellow', 'Yellow: train, but watch the volume'] : ['red', 'Red: go light or take a rest day'];
  const f = (k, label, unitTxt, mode = 'decimal') => `<label class="wfield"><span>${label}</span><input data-whoop="${k}" inputmode="${mode}" value="${w[k] ?? ''}" placeholder="–"><em>${unitTxt}</em></label>`;
  return `<section class="card" id="sec-recovery">
    <div class="card-head"><h2>Recovery <span class="muted small">from WHOOP</span></h2>${zone ? `<span class="zone z-${zone[0]}">${rec}%</span>` : ''}</div>
    <div class="whoop-grid">
      ${f('rec', 'Recovery', '%', 'numeric')}${f('hrv', 'HRV', 'ms', 'numeric')}${f('rhr', 'Resting HR', 'bpm', 'numeric')}
      ${f('sleep', 'Sleep', 'h')}${f('strain', 'Strain', '/21')}
    </div>
    ${zone ? `<p class="small zone-msg z-${zone[0]}">${zone[1]}</p>` : '<p class="muted small">Copy these from the WHOOP app each morning. They feed your trends and today’s training advice.</p>'}
  </section>`;
}

// ---------------------------------------------------------------- today
function greeting() {
  const h = new Date().getHours();
  const name = S.settings.profile?.name;
  return `${h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'}${name ? `, ${esc(name)}` : ''}`;
}

function todayView() {
  const r = routine();
  const d = S.date;
  const isToday = d === ymd();
  const day = dayData(d);
  const sc = dayScore(d);
  const t = targets();
  const tot = dayTotals(day, S.settings.supps);
  const active = S.sessions.filter((s) => s.status === 'active').pop();
  const next = nextDay(r, S.sessions);
  const done = sessionsOn(d);
  const goal = stepGoalOn(d);
  const stepPct = Math.min(100, Math.round(((day.steps || 0) / goal) * 100));
  const plan = planOf(d);
  const scoreColor = sc.pct >= 80 ? PLATE.green : sc.pct >= 50 ? PLATE.yellow : PLATE.red;

  return `
  <header class="top">
    <div><p class="muted small">${longDate(d)}</p><h1 class="display hello">${isToday ? greeting() : shortDate(d)}</h1></div>
    <button class="icon-btn" data-act="tab" data-v="setup" aria-label="Setup">${icon('gear')}</button>
  </header>
  ${dateBar()}
  ${plan ? journeyCard(plan) + checkinCard(plan) : startsSoonCard(d)}

  <section class="card score-card">
    ${ring(sc.pct / 100, 112, 10, scoreColor, `<b class="score-num">${sc.pct}</b><span>day score</span>`)}
    <div class="score-items">${sc.items.map((x) => `<button class="si ${x.v >= 1 ? 'ok' : x.v > 0 ? 'part' : ''}" data-act="goto" data-v="${x.go}"><span class="si-dot"></span>${x.label}</button>`).join('')}</div>
  </section>

  ${active ? `<section class="card train-card" style="--day:${plate(active.color)}">
      <div class="tc-row"><span class="pip lg"></span><div class="grow"><p class="muted small">In progress</p><h2 class="tc-title">${esc(active.dayName)}</h2></div></div>
      <button class="btn primary big" data-act="resume" data-id="${active.id}">Resume workout</button></section>`
    : done.length ? `<section class="card list">${done.map((s) => { const st = sessionStats(s, unit()); return `<button class="row-btn" data-act="open-session" data-id="${s.id}" style="--day:${plate(s.color)}">
      <span class="pip lg"></span><span class="grow"><b>Done: ${esc(s.dayName)}</b><br><span class="muted small">${s.rest ? 'Rest day logged' : `${st.sets} sets, ${fmtInt(st.volume)} ${unit()} moved${st.minutes ? `, ${st.minutes} min` : ''}`}</span></span></button>`; }).join('')}</section>`
    : plan ? plannedWorkoutCard(plan, isToday)
    : isToday ? `<section class="card train-card" style="--day:${plate(next.color)}">
      <div class="tc-row"><div class="disc xs" aria-hidden="true"><div class="disc-hole"></div></div>
        <div class="grow"><p class="muted small">Up next in your split</p><h2 class="tc-title">${esc(next.name)}</h2>
        <p class="muted small">${next.rest ? 'Recover: walk, stretch, sleep' : `${next.exercises.length} exercises after the 40-min warm-up`}</p></div></div>
      <div class="btn-row">${next.rest ? `<button class="btn primary big grow" data-act="log-rest">Log rest day</button><button class="btn" data-act="plan-day" data-day="">Train anyway</button>`
        : `<button class="btn primary big grow" data-act="plan-day" data-day="${next.id}">Plan today’s workout</button>`}</div></section>`
    : `<section class="card"><p class="muted">No workout logged on this day.</p><button class="btn" data-act="log-rest">Log as rest day</button></section>`}

  ${plan ? mealsCard(plan) : ''}

  <section class="card fuel-mini" data-act="tab" data-v="fuel" role="button" tabindex="0">
    <div class="card-head"><h2>Fuel</h2><span class="link small">Log food ${icon('right', 14)}</span></div>
    <div class="fm-row">
      ${ring(tot.kcal / t.kcal, 84, 8, C.kcal, `<b>${fmtInt(Math.max(0, t.kcal - tot.kcal))}</b><span>kcal left</span>`)}
      <div class="grow stack gap-s">${bar(tot.p, t.p, C.p, 'Protein', ' g')}${bar(tot.c, t.c, C.c, 'Carbs', ' g')}${bar(tot.f, t.f, C.f, 'Fat', ' g')}</div>
    </div>
  </section>

  ${waterCard()}

  <section class="card" id="sec-steps">
    <div class="card-head"><h2>Steps</h2><button class="link small" data-act="trend-go" data-v="body">See trend</button></div>
    <div class="steps-row">
      <input class="big-input" id="steps-in" inputmode="numeric" placeholder="0" value="${day.steps ?? ''}" aria-label="Steps">
      <button class="btn" data-act="save-steps">Save</button>
    </div>
    <div class="meter"><span style="width:${stepPct}%;background:${C.steps}"></span></div>
    <p class="muted small">${stepPct >= 100 ? 'Goal reached' : `${fmtInt(Math.max(0, goal - (day.steps || 0)))} to your ${fmtInt(goal)} goal`}</p>
    ${plan ? `<p class="muted small">${plan.legsOut ? 'Foot still healing: walk only as far as it stays pain-free.' : 'Easy pace is fine. A 10-minute walk after each meal gets you most of the way.'}</p>` : ''}
    <div class="bw-row stack gap-s">
      <label class="field inline"><span>Body weight (${bu()}) <em class="muted small">every morning</em></span><input id="bw-in" inputmode="decimal" placeholder="${plan ? 'weigh in' : 'optional'}" value="${bwOf(day) ?? ''}"></label>
      <label class="field inline"><span>Waist (${S.settings.waistUnit || 'in'}) <em class="muted small">${parseYmd(d).getDay() === 1 ? 'Monday: measure today' : 'Mondays'}</em></span><input id="waist-in" inputmode="decimal" placeholder="at belly button" value="${day.waist ?? ''}"></label>
    </div>
  </section>

  ${coreCard()}
  ${suppCard()}
  ${recoveryCard()}
  ${weekStrip()}`;
}

function weekStrip() {
  const start = weekStart(ymd());
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const today = ymd();
  return `<section class="card week">
    <div class="card-head"><h2>This week</h2><button class="link small" data-act="tab" data-v="history">Calendar</button></div>
    <ol class="week-days">${days.map((d) => {
      const list = sessionsOn(d);
      const s = list[list.length - 1];
      const sc = d <= today ? dayScore(d).pct : null;
      return `<li class="${d === today ? 'today' : ''}${s ? ' has' : ''}" style="--day:${s ? plate(s.color) : 'transparent'}" data-act="pick-date" data-v="${d}">
        <span class="wd">${parseYmd(d).toLocaleDateString(undefined, { weekday: 'narrow' })}</span>
        <span class="ring">${s ? '' : parseYmd(d).getDate()}</span>
        <span class="lbl">${s ? esc(s.dayName.split(' + ')[0].replace(' day', '')) : ''}</span>
        <span class="wscore">${sc ? sc : ''}</span></li>`;
    }).join('')}</ol>
  </section>`;
}

// ---------------------------------------------------------------- train (body map planner)
function exInfo(id) {
  for (const d of routine().days) { const e = d.exercises.find((x) => x.id === id); if (e) return { id, name: e.name, group: e.group, muscle: muscleOf(e), mine: true }; }
  const l = libById[id];
  if (l) return { ...l };
  for (const s of S.sessions) { const e = (s.exercises || []).find((x) => x.id === id); if (e) return { id, name: e.name, group: e.group, muscle: muscleOf(e) }; }
  return { id, name: id, muscle: null };
}
// Exercises available for a muscle, the user's own first.
function optionsFor(m) {
  const mine = [];
  for (const d of routine().days) for (const e of d.exercises) if (muscleOf(e) === m && !mine.some((x) => x.id === e.id)) mine.push(exInfo(e.id));
  const lib = LIBRARY.filter((e) => e.muscle === m && !mine.some((x) => x.id === e.id));
  return [...mine, ...lib];
}
function defaultPicks(m) {
  const opts = optionsFor(m);
  const mine = opts.filter((o) => o.mine);
  return (mine.length ? mine : opts.slice(0, 2)).map((o) => o.id);
}
function presetMatch(muscles) {
  const set = [...muscles].sort().join();
  return routine().days.find((d) => !d.rest && DAY_MUSCLES[d.id] && [...DAY_MUSCLES[d.id]].sort().join() === set)?.id || null;
}
function planFromDay(dayId) {
  const d = routine().days.find((x) => x.id === dayId);
  if (!d || d.rest) return { dayId: null, muscles: [], list: [], warm: true };
  const muscles = DAY_MUSCLES[d.id] || [...new Set(d.exercises.map(muscleOf).filter(Boolean))];
  return { dayId: d.id, muscles: [...muscles], list: d.exercises.map((e) => e.id), warm: true };
}
function ensurePlan() {
  if (S.plan) return;
  const jp = planOf(ymd());
  if (jp) { S.plan = planFromJourney(jp); return; }
  const n = nextDay(routine(), S.sessions);
  S.plan = planFromDay(n.rest ? null : n.id);
}
function planDay() {
  const p = S.plan;
  if (p.dayObj) return p.dayObj;
  const d = p.dayId && routine().days.find((x) => x.id === p.dayId);
  if (d) return d;
  const names = p.muscles.map((m) => muscleById[m]?.name).filter(Boolean);
  return { id: 'custom', name: names.length > 3 ? `${names.slice(0, 2).join(' + ')} +${names.length - 2}` : names.join(' + ') || 'Custom', color: muscleById[p.muscles[0]]?.color || 'yellow', exercises: [] };
}

function freshness(m, last) {
  if (!last[m]) return 'dn';
  const n = daysBetween(last[m], ymd());
  return n <= 1 ? 'd0' : n <= 3 ? 'd2' : 'd4';
}

function trainView() {
  ensurePlan();
  const p = S.plan;
  const r = routine();
  const next = nextDay(r, S.sessions);
  const active = S.sessions.filter((s) => s.status === 'active').pop();
  const last = muscleLastTrained(S.sessions);
  const sel = new Set(p.muscles);
  const day = planDay();
  const w = dayData(ymd()).whoop || {};
  const rec = Number(w.rec);
  const list = p.list.map(exInfo);

  return `
  <header class="top"><div><p class="muted small">Pick what to hit today</p><h1 class="display">Train</h1></div>
    <button class="icon-btn" data-act="tab" data-v="setup" aria-label="Setup">${icon('gear')}</button></header>

  ${active ? `<section class="card train-card" style="--day:${plate(active.color)}"><div class="tc-row"><span class="pip lg"></span><div class="grow"><p class="muted small">In progress</p><h2 class="tc-title">${esc(active.dayName)}</h2></div>
    <button class="btn primary" data-act="resume" data-id="${active.id}">Resume</button></div></section>` : ''}

  ${rec ? `<div class="banner z-${rec >= 67 ? 'green' : rec >= 34 ? 'yellow' : 'red'}"><b>${rec}% recovery.</b> ${rec >= 67 ? 'Good day to push for PRs.' : rec >= 34 ? 'Train as planned, keep a rep in reserve.' : 'Consider going lighter, or swap in posture work and a walk.'}</div>` : ''}

  <section class="presets">
    ${r.days.filter((d) => !d.rest).map((d) => `<button class="preset ${p.dayId === d.id ? 'on' : ''}" data-act="preset" data-v="${d.id}" style="--day:${plate(d.color)}">
      <span class="pip"></span><span><b>${esc(d.name)}</b>${d.id === next.id ? '<em>Up next</em>' : ''}</span></button>`).join('')}
  </section>

  <section class="card body-card" style="--day:${plate(day.color)}">
    <div class="card-head"><h2>Target muscles</h2>${sel.size ? '<button class="link small muted" data-act="plan-clear">Clear</button>' : ''}</div>
    ${bodyMap((m) => (sel.has(m) ? 'sel' : freshness(m, last)))}
    <div class="legend"><span><i class="lg-sel"></i>Selected</span><span><i class="lg-d0"></i>Trained ≤1 day ago</span><span><i class="lg-d2"></i>2–3 days</span><span><i class="lg-d4"></i>Ready</span></div>
    <div class="chips">${MUSCLES.map((m) => `<button class="mchip ${sel.has(m.id) ? 'on' : ''}" data-act="muscle" data-v="${m.id}" aria-pressed="${sel.has(m.id)}">${m.name}${last[m.id] ? `<small>${agoShort(last[m.id])}</small>` : ''}</button>`).join('')}</div>
  </section>

  ${sel.size ? `<section class="card plan" style="--day:${plate(day.color)}">
    <div class="card-head"><div><p class="muted small">${p.dayId ? 'From your split' : 'Custom session'}</p><h2 class="plan-title">${esc(day.name)}</h2></div><span class="count">${list.length}</span></div>
    <label class="warm-toggle"><input type="checkbox" data-act-change="plan-warm" ${p.warm ? 'checked' : ''}><span>Include warm-up: ${r.warmup.map((x) => `${esc(x.name)} ${x.min} min`).join(' + ')}</span></label>
    <ol class="plan-list">${list.map((e, i) => {
      const ls = lastSetsFor(S.sessions, e.id);
      return `<li><span class="pl-n">${i + 1}</span><div class="grow"><b>${esc(e.name)}</b>
        <span class="muted small">${p.sets?.[e.id] ? `<b class="tgt">${p.sets[e.id]} × ${esc(p.reps?.[e.id] || '8–12')}</b> · ` : ''}${esc(muscleById[e.muscle]?.name || '')}${ls ? ` · last ${setsLine(ls.sets.slice(0, 3), ls.session.unit)}` : ' · new'}</span></div>
        <button class="icon-btn sm" data-act="plan-swap" data-i="${i}" aria-label="Swap ${esc(e.name)}">${icon('swap', 18)}</button>
        <button class="icon-btn sm" data-act="plan-del" data-i="${i}" aria-label="Remove ${esc(e.name)}">${icon('x', 18)}</button></li>`;
    }).join('')}</ol>
    <button class="btn ghost" data-act="plan-add">${icon('plus', 18)} Add exercise</button>
    <button class="btn primary big" data-act="plan-start" ${list.length ? '' : 'disabled'}>Start ${esc(day.name)}</button>
  </section>` : `<div class="empty small-empty"><p>Tap muscles on the body, or pick a day from your split.</p>${next.rest ? '<button class="btn" data-act="log-rest">Log rest day instead</button>' : ''}</div>`}
  `;
}
const agoShort = (d) => { const n = daysBetween(d, ymd()); return n === 0 ? 'today' : n === 1 ? '1d' : `${n}d`; };

function setsLine(sets, from) {
  return sets.map((s) => `${fmtW(convert(Number(s.w) || 0, from || unit(), unit()))}×${s.r}`).join(', ');
}

// ---------------------------------------------------------------- workout (in-session)
function workoutView() {
  const w = S.draft;
  const u = unit();
  const editing = w.status === 'done';
  const st = sessionStats(w, u);
  return `<div class="workout" style="--day:${plate(w.color)}">
    <header class="wk-head">
      <button class="icon-btn" data-act="wk-close" aria-label="${editing ? 'Close without saving' : 'Minimise workout'}">
        <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg></button>
      <div class="grow">
        <h1 class="wk-title">${esc(w.dayName)}</h1>
        <p class="muted small">${editing ? `Editing ${shortDate(w.date)}` : `<span id="elapsed">${elapsed(w)}</span>, ${st.sets} sets done`}</p>
      </div>
      <button class="btn primary" data-act="${editing ? 'wk-save' : 'wk-finish'}">${editing ? 'Save' : 'Finish'}</button>
    </header>

    <div class="wk-body">
      ${w.warmup?.length ? `<section class="card warm">
        <div class="card-head"><h2>Warm-up</h2><span class="muted small">${w.warmup.filter((x) => x.done).length} of ${w.warmup.length}</span></div>
        ${w.warmup.map((x, i) => `<div class="warm-row ${x.done ? 'is-done' : ''}">
          <button class="check ${x.done ? 'on' : ''}" data-act="warm-toggle" data-i="${i}" aria-pressed="${!!x.done}" aria-label="Mark ${esc(x.name)} done">${checkSvg}</button>
          <div class="grow"><b>${esc(x.name)}</b>
            ${x.id === 'apt' ? `<p class="muted small">${(S.settings.apt || []).map((a) => esc(a.name)).join(' · ')}</p>` : ''}
            <div class="warm-fields">
              <label class="mini"><input data-warm="${i}" data-k="min" inputmode="numeric" value="${x.min ?? ''}"><span>min</span></label>
              ${x.incline != null ? `<label class="mini"><span>incline</span><input data-warm="${i}" data-k="incline" inputmode="decimal" value="${x.incline}"></label>` : ''}
              ${x.speed != null ? `<label class="mini"><span>speed</span><input data-warm="${i}" data-k="speed" inputmode="decimal" value="${x.speed}"></label>` : ''}
            </div>
          </div>
        </div>`).join('')}
      </section>` : ''}

      ${w.exercises.map((e, ei) => exerciseCard(e, ei, w)).join('')}

      <div class="stack gap-s wk-foot">
        ${editing ? '' : `<button class="btn ghost" data-act="wk-add-ex">${icon('plus', 18)} Add exercise</button>`}
        <button class="btn primary big" data-act="${editing ? 'wk-save' : 'wk-finish'}">${editing ? 'Save changes' : 'Finish workout'}</button>
        <button class="btn ghost danger" data-act="wk-discard">${editing ? 'Delete this workout' : 'Discard workout'}</button>
      </div>
    </div>
    ${S.rest && !editing ? restBar() : ''}
  </div>`;
}

function exerciseCard(e, ei, w) {
  const u = unit();
  const last = lastSetsFor(S.sessions, e.id, w.id);
  const nDone = e.sets.filter((s) => s.done).length;
  const complete = nDone > 0 && nDone === e.sets.length;
  return `<section class="card ex ${complete ? 'complete' : ''}">
    <div class="ex-head">
      <div class="grow"><h2>${esc(e.name)}</h2>
        ${e.target ? `<p class="small tgt">Target ${e.sets.length} × ${esc(e.target)} reps</p>` : ''}
        <p class="muted small">${last ? `Last time (${shortDate(last.session.date)}): <span class="num">${setsLine(last.sets, last.session.unit)}</span>` : 'No history yet. Pick a weight you can do for clean reps.'}</p></div>
      <span class="count ${complete ? 'on' : ''}">${nDone}/${e.sets.length}</span>
    </div>
    <div class="set-grid" role="table">
      <div class="set-row head" role="row"><span>Set</span><span>Weight (${u})</span><span>Reps</span><span class="sr">Done</span></div>
      ${e.sets.map((s, si) => `<div class="set-row ${s.done ? 'is-done' : ''}" role="row">
        <span class="set-n">${s.pr ? '<abbr title="New best" class="pr">PR</abbr>' : si + 1}</span>
        <span class="stepper">
          <button data-act="step" data-ex="${ei}" data-set="${si}" data-k="w" data-d="-1" aria-label="Less weight">−</button>
          <input data-ex="${ei}" data-set="${si}" data-k="w" inputmode="decimal" value="${s.w === '' ? '' : s.w}" placeholder="${e.sets[si - 1]?.w ?? '0'}" aria-label="Set ${si + 1} weight">
          <button data-act="step" data-ex="${ei}" data-set="${si}" data-k="w" data-d="1" aria-label="More weight">+</button>
        </span>
        <span class="stepper">
          <button data-act="step" data-ex="${ei}" data-set="${si}" data-k="r" data-d="-1" aria-label="Fewer reps">−</button>
          <input data-ex="${ei}" data-set="${si}" data-k="r" inputmode="numeric" value="${s.r ?? ''}" aria-label="Set ${si + 1} reps">
          <button data-act="step" data-ex="${ei}" data-set="${si}" data-k="r" data-d="1" aria-label="More reps">+</button>
        </span>
        <button class="check ${s.done ? 'on' : ''}" data-act="set-done" data-ex="${ei}" data-set="${si}" aria-pressed="${!!s.done}" aria-label="Set ${si + 1} done">${checkSvg}</button>
      </div>`).join('')}
    </div>
    <div class="ex-actions">
      <button class="link" data-act="add-set" data-ex="${ei}">Add set</button>
      ${e.sets.length > 1 ? `<button class="link muted" data-act="del-set" data-ex="${ei}">Remove last set</button>` : ''}
    </div>
  </section>`;
}

function elapsed(w) {
  const m = Math.floor((Date.now() - w.startedAt) / 60000);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}
function restBar() {
  const left = Math.max(0, Math.ceil((S.rest.endsAt - Date.now()) / 1000));
  const pct = 100 * (1 - left / S.rest.total);
  return `<div class="restbar" id="restbar">
    <div class="rest-fill" style="width:${pct}%"></div>
    <span>Rest</span><b id="rest-left">${mmss(left)}</b>
    <button class="link" data-act="rest-add">+30 s</button>
    <button class="link" data-act="rest-skip">Skip</button>
  </div>`;
}
const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

// ---------------------------------------------------------------- fuel
function defaultMeal() {
  const h = new Date().getHours() + new Date().getMinutes() / 60;
  return h < 10.5 ? 'breakfast' : h < 15 ? 'lunch' : h < 18 ? 'snack' : 'dinner';
}

function fuelView() {
  const d = S.date;
  const day = dayData(d);
  const t = targets();
  const tot = dayTotals(day, S.settings.supps);
  const food = day.food || [];
  const over = tot.kcal > t.kcal;
  const prev = dayData(addDays(d, -1)).food || [];
  return `
  <header class="top"><div><p class="muted small">${longDate(d)}</p><h1 class="display">Fuel</h1></div>
    <button class="icon-btn" data-act="tab" data-v="setup" aria-label="Setup">${icon('gear')}</button></header>
  ${dateBar()}

  <section class="card macro-hero">
    <div class="mh-row">
      ${ring(tot.kcal / t.kcal, 132, 12, over ? PLATE.red : C.kcal, `<b class="score-num">${fmtInt(over ? tot.kcal - t.kcal : t.kcal - tot.kcal)}</b><span>${over ? 'kcal over' : 'kcal left'}</span>`)}
      <div class="grow mh-stats">
        <div><span class="muted small">Eaten</span><b>${fmtInt(tot.kcal)}</b></div>
        <div><span class="muted small">Target</span><b>${fmtInt(t.kcal)}</b></div>
        <div><span class="muted small">Fiber</span><b>${r1(tot.fib)}<small> / ${t.fib} g</small></b></div>
      </div>
    </div>
    <div class="stack gap-s">${bar(tot.p, t.p, C.p, 'Protein', ' g')}${bar(tot.c, t.c, C.c, 'Carbs', ' g')}${bar(tot.f, t.f, C.f, 'Fat', ' g')}</div>
    ${t.journey ? `<p class="muted small">Birthday plan, day ${t.plan.n}: ${t.plan.kind === 'rest' ? 'rest day' : t.plan.kind === 'flex' ? 'flex day at maintenance' : 'training day'} target. ${t.plan.kind === 'flex' ? '' : `Training days ${fmtInt(KCAL.train + (J().calAdj || 0))}, rest days ${fmtInt(KCAL.rest + (J().calAdj || 0))} kcal.`} The planned meals are on Today.</p>`
      : t.calculated ? `<p class="muted small">Targets from your profile: about ${fmtInt(t.tdee)} kcal burned a day, adjusted for your ${esc(S.settings.profile.goal)} goal.</p>` : '<p class="muted small">Add your age and height in Setup to get calorie and protein targets made for you.</p>'}
  </section>

  ${MEALS.map((m) => {
    const items = food.filter((f) => (f.meal || 'snack') === m.id);
    const mk = items.reduce((a, x) => a + (x.kcal || 0), 0), mp = items.reduce((a, x) => a + (x.p || 0), 0);
    return `<section class="card meal">
      <div class="card-head"><h2>${m.name}</h2><span class="muted small num">${items.length ? `${fmtInt(mk)} kcal · ${r1(mp)} g protein` : ''}</span></div>
      ${items.length ? `<ul class="food-list">${items.map((f) => {
        const cat = FOOD_CATS.find((c) => c.id === (foodById(f.foodId, S.settings.customFoods)?.cat));
        return `<li><button class="food-row" data-act="food-edit" data-id="${f.id}">
        <span class="fdot" style="background:${cat?.color || 'var(--muted)'}"></span>
        <span class="grow"><b>${esc(f.name)}</b><span class="muted small">${esc(qtyLabel(f))}</span></span>
        <span class="num fr-k"><b>${fmtInt(f.kcal)}</b><span class="muted small">${r1(f.p)}p ${r1(f.c)}c ${r1(f.f)}f</span></span></button></li>`;
      }).join('')}</ul>` : ''}
      <button class="btn ghost add-food" data-act="food-add" data-meal="${m.id}">${icon('plus', 18)} Add to ${m.name.toLowerCase()}</button>
    </section>`;
  }).join('')}

  ${prev.length ? `<button class="btn ghost" data-act="food-copy">Repeat ${d === ymd() ? 'yesterday’s' : 'the previous day’s'} food (${prev.length} items)</button>` : ''}

  ${waterCard()}
  ${suppCard()}`;
}

function recentFoods() {
  const seen = new Set(), out = [];
  const days = Object.keys(S.daily).sort().reverse();
  for (const d of days) for (const f of [...(S.daily[d].food || [])].reverse()) {
    if (!seen.has(f.foodId) && foodById(f.foodId, S.settings.customFoods)) { seen.add(f.foodId); out.push(f); }
    if (out.length >= 12) return out;
  }
  return out;
}

function foodListHtml() {
  const sh = S.sheet;
  const custom = S.settings.customFoods || [];
  const all = [...FOODS, ...custom];
  const q = (sh.q || '').trim().toLowerCase();
  let list;
  if (q) list = all.filter((f) => `${f.name} ${f.tags || ''} ${f.cat}`.toLowerCase().includes(q));
  else if (sh.cat === 'recent') {
    const rec = recentFoods();
    if (!rec.length) return `<p class="muted pad">Foods you log show up here for one-tap adding. Pick a category above to start.</p>`;
    return `<ul class="pick-list">${rec.map((r) => { const f = foodById(r.foodId, custom); return pickRow(f, `Last time: ${qtyLabel(r)}, ${fmtInt(r.kcal)} kcal`, r); }).join('')}</ul>`;
  } else if (sh.cat === 'fav') list = (S.settings.favFoods || []).map((id) => foodById(id, custom)).filter(Boolean);
  else if (sh.cat === 'mine') list = custom;
  else list = all.filter((f) => f.cat === sh.cat);
  if (!list.length) return `<p class="muted pad">${sh.cat === 'fav' ? 'Tap the star on a food to keep it here.' : sh.cat === 'mine' ? 'Foods you add yourself show up here.' : 'Nothing matches. Try another word, or add it as your own food.'}</p>`;
  return `<ul class="pick-list">${list.map((f) => pickRow(f, `${f.kcal} kcal · ${f.p} g protein per 100 g`)).join('')}</ul>`;
}
function pickRow(f, sub, prev) {
  const cat = FOOD_CATS.find((c) => c.id === f.cat);
  const perServ = f.custom ? `${f.kcal} kcal · ${f.p} g protein per ${f.units[0].label}` : sub;
  return `<li><button class="pick-row" data-act="food-pick" data-id="${f.id}" ${prev ? `data-unit="${esc(prev.unit)}" data-qty="${prev.qty}"` : ''}>
    <span class="fdot" style="background:${cat?.color || 'var(--muted)'}"></span>
    <span class="grow"><b>${esc(f.name)}</b><span class="muted small">${esc(prev ? sub : perServ)}</span></span>${icon('plus', 20)}</button></li>`;
}

function foodSheet() {
  const sh = S.sheet;
  if (sh.custom) return customFoodForm();
  if (sh.pick) {
    const f = foodById(sh.pick.foodId, S.settings.customFoods);
    const m = macrosFor(f, sh.pick.unit, Number(sh.pick.qty) || 0);
    const fav = (S.settings.favFoods || []).includes(f.id);
    const cat = FOOD_CATS.find((c) => c.id === f.cat);
    return `<div class="food-detail">
      <div class="fd-head">
        ${sh.editId ? '' : `<button class="icon-btn sm" data-act="food-back" aria-label="Back to list">${icon('back', 20)}</button>`}
        <div class="grow"><p class="muted small">${esc(cat?.name || '')}</p><h2 class="sheet-title">${esc(f.name)}</h2></div>
        <button class="icon-btn sm fav ${fav ? 'on' : ''}" data-act="food-fav" data-id="${f.id}" aria-pressed="${fav}" aria-label="Favourite">${icon('star', 22)}</button>
      </div>
      <div class="qty-row">
        <span class="stepper big"><button data-act="food-qty" data-d="-1" aria-label="Less">−</button>
          <input id="food-qty" inputmode="decimal" value="${sh.pick.qty}" aria-label="Amount"><button data-act="food-qty" data-d="1" aria-label="More">+</button></span>
        <label class="field grow"><span class="sr">Unit</span><select id="food-unit">${f.units.map((x) => `<option ${x.label === sh.pick.unit ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}</select></label>
      </div>
      <div class="macro-preview" id="macro-preview">${macroPreview(m)}</div>
      <div class="seg">${MEALS.map((x) => `<button class="${sh.meal === x.id ? 'on' : ''}" data-act="food-meal" data-v="${x.id}">${x.name}</button>`).join('')}</div>
      <button class="btn primary big" data-act="food-save">${sh.editId ? 'Save changes' : `Add to ${MEALS.find((x) => x.id === sh.meal).name.toLowerCase()}`}</button>
      ${sh.editId ? '<button class="btn ghost danger" data-act="food-del">Remove from log</button>' : ''}
    </div>`;
  }
  const cats = [['recent', 'Recent'], ['fav', '★ Favourites'], ...FOOD_CATS.map((c) => [c.id, c.name]), ['mine', 'My foods']];
  return `<div class="food-browse">
    <h2 class="sheet-title">Add to ${MEALS.find((x) => x.id === sh.meal).name.toLowerCase()}</h2>
    <input class="search" id="food-q" type="search" placeholder="Search healthy foods: chicken, dal, oats…" value="${esc(sh.q || '')}" autocomplete="off">
    <div class="cat-scroll" data-keep="cats">${cats.map(([k, l]) => `<button class="cchip ${sh.cat === k && !sh.q ? 'on' : ''}" data-act="food-cat" data-v="${k}">${l}</button>`).join('')}</div>
    <div id="food-list" data-keep="flist" class="food-scroll">${foodListHtml()}</div>
    <button class="link" data-act="food-custom">Not listed? Add your own food</button>
  </div>`;
}
function macroPreview(m) {
  return `<div class="mp-k"><b>${fmtInt(m.kcal)}</b><span>kcal</span></div>
    <div class="mp-m"><span style="--c:${C.p}"><b>${r1(m.p)}</b> g protein</span><span style="--c:${C.c}"><b>${r1(m.c)}</b> g carbs</span><span style="--c:${C.f}"><b>${r1(m.f)}</b> g fat</span><span style="--c:${C.fib}"><b>${r1(m.fib)}</b> g fiber</span></div>
    <p class="muted small">${fmtInt(m.g)} g</p>`;
}
function customFoodForm() {
  return `<div class="stack">
    <div class="fd-head"><button class="icon-btn sm" data-act="food-back" aria-label="Back">${icon('back', 20)}</button><h2 class="sheet-title grow">Your own food</h2></div>
    <p class="muted small">Enter the numbers for one serving from the label. It’s saved to My foods.</p>
    <label class="field"><span>Name</span><input id="cf-name" placeholder="e.g. Homemade chicken curry"></label>
    <label class="field"><span>One serving is</span><input id="cf-serv" placeholder="e.g. 1 bowl (250 g)"></label>
    <label class="field"><span>Category</span><select id="cf-cat">${FOOD_CATS.map((c) => `<option value="${c.id}">${c.name}</option>`).join('')}</select></label>
    <div class="grid4">${[['kcal', 'Calories'], ['p', 'Protein g'], ['c', 'Carbs g'], ['f', 'Fat g']].map(([k, l]) => `<label class="field"><span>${l}</span><input id="cf-${k}" inputmode="decimal"></label>`).join('')}</div>
    <button class="btn primary big" data-act="food-custom-save">Save and add</button>
  </div>`;
}

// ---------------------------------------------------------------- trends
function trendsView() {
  const m = S.trend.mode;
  const tabs = [['overview', 'Overview'], ['strength', 'Strength'], ['nutrition', 'Nutrition'], ['body', 'Body'], ['habits', 'Habits']];
  return `<header class="top"><h1 class="display">Trends</h1>
    <div class="seg tiny">${[[7, '7D'], [30, '30D'], [90, '90D']].map(([k, l]) => `<button class="${S.trend.days === k ? 'on' : ''}" data-act="trend-days" data-v="${k}">${l}</button>`).join('')}</div></header>
  <div class="seg wide scroll-seg" role="tablist">${tabs.map(([k, l]) => `<button role="tab" aria-selected="${m === k}" class="${m === k ? 'on' : ''}" data-act="trend-mode" data-v="${k}">${l}</button>`).join('')}</div>
  ${{ overview: trOverview, strength: trStrength, nutrition: trNutrition, body: trBody, habits: trHabits }[m]()}`;
}
function lastNDays(n) { const t = ymd(); return Array.from({ length: n }, (_, i) => addDays(t, -(n - 1 - i))); }
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

function trOverview() {
  const days = lastNDays(S.trend.days);
  const logged = days.filter((d) => S.daily[d] || sessionsOn(d).length);
  const scores = logged.map((d) => dayScore(d).pct);
  const foodDays = days.filter((d) => (dayData(d).food || []).length);
  const tots = foodDays.map((d) => dayTotals(dayData(d), S.settings.supps));
  const water = days.map((d) => dayData(d).water).filter(Boolean);
  const steps = days.map((d) => dayData(d).steps).filter(Boolean);
  const workouts = S.sessions.filter((s) => s.status === 'done' && !s.rest && s.date >= days[0]).length;
  const t = targets();
  const tile = (v, l, sub = '') => `<div class="stat"><b>${v}</b><span>${l}</span>${sub ? `<em>${sub}</em>` : ''}</div>`;
  return `
  <div class="stats grid-2">
    ${tile(scores.length ? Math.round(avg(scores)) : '–', 'avg day score')}
    ${tile(workouts, 'workouts', `${r1(workouts / (S.trend.days / 7))} / week`)}
    ${tile(tots.length ? fmtInt(avg(tots.map((x) => x.kcal))) : '–', 'avg kcal', `target ${fmtInt(t.kcal)}`)}
    ${tile(tots.length ? fmtInt(avg(tots.map((x) => x.p))) + ' g' : '–', 'avg protein', `target ${t.p} g`)}
    ${tile(water.length ? fmtWater(avg(water)) : '–', 'avg water', `goal ${fmtWater(waterGoalMl())}`)}
    ${tile(steps.length ? fmtInt(avg(steps)) : '–', 'avg steps', `goal ${fmtInt(S.settings.stepGoal)}`)}
  </div>
  <section class="card"><div class="card-head"><h2>Day score</h2><span class="muted small">0–100</span></div>
    <p class="muted small">Workout, protein, calories, water, steps, posture work and supplements, rolled into one number.</p>
    <div id="ch-score"></div></section>
  <section class="card"><div class="card-head"><h2>Recent bests</h2></div>${recentPrs()}</section>`;
}
function recentPrs() {
  const u = unit();
  const prs = [];
  for (const s of [...S.sessions].filter((x) => x.status === 'done').reverse()) for (const e of s.exercises || []) for (const x of e.sets) if (x.pr && prs.length < 6) prs.push({ s, e, x });
  return prs.length ? `<ul class="plain-list">${prs.map(({ s, e, x }) => `<li><span>${esc(e.name)}<br><span class="muted small">${shortDate(s.date)}</span></span><span class="num">${fmtW(convert(Number(x.w), s.unit, u))} × ${x.r}</span></li>`).join('')}</ul>`
    : '<p class="muted">Beat a previous best on any lift and it lands here.</p>';
}

function allExercises() {
  const map = new Map();
  for (const d of routine().days) for (const e of d.exercises) if (!map.has(e.id)) map.set(e.id, { ...e, day: d });
  for (const s of S.sessions) for (const e of s.exercises || []) if (!map.has(e.id)) map.set(e.id, { id: e.id, name: e.name, group: e.group, day: null });
  return [...map.values()];
}
function rangeFilter(points, range) {
  if (range === 'all') return points;
  const from = addDays(ymd(), -Number(range));
  return points.filter((p) => p.date >= from);
}
const fmtNum = (v) => (Math.abs(v) >= 1000 ? fmtInt(v) : String(Math.round(v * 10) / 10));

function trStrength() {
  const exs = allExercises();
  if (!S.trend.exId || !exs.some((e) => e.id === S.trend.exId)) S.trend.exId = exs[0]?.id;
  const cur = exs.find((e) => e.id === S.trend.exId);
  const u = unit();
  const hist = rangeFilter(exerciseHistory(S.sessions, S.trend.exId, u), S.trend.range);
  const metric = S.trend.metric;
  const val = (p) => (metric === 'e1rm' ? p.e1rm : metric === 'top' ? p.top.w : metric === 'reps' ? p.maxReps : p.volume);
  const ys = hist.map(val);
  const best = ys.length ? Math.max(...ys) : 0;
  const change = ys.length > 1 ? ys[ys.length - 1] - ys[0] : null;
  const days = lastNDays(S.trend.days);
  const raw = setsByMuscle(S.sessions, days[0], days[days.length - 1]);
  const bym = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, v / (days.length / 7)]));
  const maxSets = Math.max(20, ...Object.values(bym));
  const groups = routine().days.filter((d) => !d.rest);
  const others = exs.filter((e) => !e.day);
  const mLabel = { e1rm: 'Est. 1-rep max', top: 'Heaviest set', volume: 'Volume', reps: 'Most reps' }[metric];
  return `
  <section class="card"><div class="card-head"><h2>Sets per muscle, per week</h2><span class="muted small">avg of ${S.trend.days} days</span></div>
    <p class="muted small">10–20 hard sets a week per muscle is a solid range for growth. The shaded band marks it.</p>
    <ul class="hbars">${MUSCLES.map((m) => ({ m, n: bym[m.id] || 0 })).sort((a, b) => b.n - a.n).map(({ m, n }) => `<li><span>${m.name}</span><span class="hb" style="--a:${(10 / maxSets) * 100}%;--b:${(20 / maxSets) * 100}%"><i style="width:${(n / maxSets) * 100}%;background:${plate(m.color)}"></i></span><b class="num">${r1(n)}</b></li>`).join('')}</ul>
  </section>
  <section class="card"><div class="card-head"><h2>Weekly volume</h2><span class="muted small">${u} × reps, 12 weeks</span></div><div id="ch-weekly"></div></section>
  <label class="field"><span>Exercise</span>
    <select data-act-change="trend-ex">${groups.map((d) => `<optgroup label="${esc(d.name)}">${d.exercises.map((e) => `<option value="${e.id}" ${e.id === S.trend.exId ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}</optgroup>`).join('')}
      ${others.length ? `<optgroup label="Other exercises">${others.map((e) => `<option value="${e.id}" ${e.id === S.trend.exId ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}</optgroup>` : ''}
    </select></label>
  <div class="seg">${[['e1rm', 'Est. 1RM'], ['top', 'Heaviest'], ['reps', 'Reps'], ['volume', 'Volume']].map(([k, l]) => `<button class="${metric === k ? 'on' : ''}" data-act="trend-metric" data-v="${k}">${l}</button>`).join('')}</div>
  <section class="card" style="--day:${plate(cur?.day?.color)}">
    <div class="card-head"><h2>${esc(cur?.name || '')}</h2>
      <div class="seg tiny">${[['30', '1M'], ['90', '3M'], ['180', '6M'], ['all', 'All']].map(([k, l]) => `<button class="${S.trend.range === k ? 'on' : ''}" data-act="trend-range" data-v="${k}">${l}</button>`).join('')}</div></div>
    <p class="muted small">${mLabel}${metric === 'reps' ? '' : ` in ${u}`}, one point per session</p>
    <div id="ch-lift"></div>
    <div class="stats compact">
      <div class="stat"><b>${ys.length ? fmtNum(ys[ys.length - 1]) : '–'}</b><span>latest</span></div>
      <div class="stat"><b>${ys.length ? fmtNum(best) : '–'}</b><span>best</span></div>
      <div class="stat"><b>${change == null ? '–' : (change >= 0 ? '+' : '−') + fmtNum(Math.abs(change))}</b><span>since first shown</span></div>
    </div>
  </section>
  ${hist.length ? `<section class="card"><div class="card-head"><h2>Sessions</h2></div>
    <ul class="plain-list">${hist.slice().reverse().slice(0, 12).map((p) => `<li><span>${shortDate(p.date)}</span><span class="num muted">${p.sets.map((s) => `${fmtW(s.w)}×${s.r}`).join(', ')}</span></li>`).join('')}</ul></section>` : ''}`;
}

function trNutrition() {
  const days = lastNDays(S.trend.days);
  const tots = days.map((d) => ((dayData(d).food || []).length ? dayTotals(dayData(d), S.settings.supps) : null)).filter(Boolean);
  const sum = { p: 0, c: 0, f: 0 };
  for (const x of tots) { sum.p += x.p * 4; sum.c += x.c * 4; sum.f += x.f * 9; }
  const all = sum.p + sum.c + sum.f || 1;
  const t = targets();
  const foodCount = {};
  for (const d of days) for (const f of dayData(d).food || []) foodCount[f.name] = (foodCount[f.name] || 0) + 1;
  const top = Object.entries(foodCount).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const hitP = tots.filter((x) => x.p >= t.p * 0.9).length;
  return `
  <section class="card"><div class="card-head"><h2>Calories</h2><span class="muted small">target ${fmtInt(t.kcal)}</span></div><div id="ch-kcal"></div></section>
  <section class="card"><div class="card-head"><h2>Protein</h2><span class="muted small">hit on ${hitP} of ${tots.length} logged days</span></div><div id="ch-protein"></div></section>
  <section class="card"><div class="card-head"><h2>Where your calories come from</h2><span class="muted small">average</span></div>
    ${tots.length ? `<div class="stack-bar"><i style="width:${(sum.p / all) * 100}%;background:${C.p}"></i><i style="width:${(sum.c / all) * 100}%;background:${C.c}"></i><i style="width:${(sum.f / all) * 100}%;background:${C.f}"></i></div>
    <div class="stack-legend"><span><i style="background:${C.p}"></i>Protein ${Math.round((sum.p / all) * 100)}%</span><span><i style="background:${C.c}"></i>Carbs ${Math.round((sum.c / all) * 100)}%</span><span><i style="background:${C.f}"></i>Fat ${Math.round((sum.f / all) * 100)}%</span></div>` : '<p class="muted">Log food to see this.</p>'}
  </section>
  <section class="card"><div class="card-head"><h2>Water</h2><span class="muted small">goal ${fmtWater(waterGoalMl())}</span></div><div id="ch-water"></div></section>
  ${top.length ? `<section class="card"><div class="card-head"><h2>Your staples</h2><span class="muted small">times logged</span></div>
    <ul class="plain-list">${top.map(([n, c]) => `<li><span>${esc(n)}</span><span class="num">${c}</span></li>`).join('')}</ul></section>` : ''}`;
}

function trBody() {
  const u = unit();
  const days = lastNDays(S.trend.days);
  const steps = days.map((d) => dayData(d).steps).filter(Boolean);
  const goal = S.settings.stepGoal || 10000;
  const pts = Object.entries(S.daily).filter(([, v]) => v.bw).map(([d, v]) => ({ date: d, y: bwOf(v) })).sort((a, b) => (a.date < b.date ? -1 : 1));
  const shown = rangeFilter(pts, S.trend.bodyRange);
  const ys = shown.map((p) => p.y);
  const wh = days.map((d) => dayData(d).whoop).filter((w) => w && w.rec);
  return `
  <section class="card"><div class="card-head"><h2>Steps</h2><span class="muted small">${steps.length ? `avg ${fmtInt(avg(steps))} · ${steps.filter((x) => x >= goal).length}/${steps.length} at goal` : ''}</span></div>
    <p class="muted small">Faded bars are under goal. The line is the 7-day average.</p><div id="ch-steps"></div></section>
  <section class="card">
    <div class="card-head"><h2>Body weight</h2>
      <div class="seg tiny">${[['30', '1M'], ['90', '3M'], ['all', 'All']].map(([k, l]) => `<button class="${S.trend.bodyRange === k ? 'on' : ''}" data-act="body-range" data-v="${k}">${l}</button>`).join('')}</div></div>
    <div id="ch-body"></div>
    <div class="stats compact">
      <div class="stat"><b>${ys.length ? fmtNum(ys[ys.length - 1]) : '–'}</b><span>latest ${bu()}</span></div>
      <div class="stat"><b>${ys.length > 1 ? (ys[ys.length - 1] - ys[0] >= 0 ? '+' : '−') + fmtNum(Math.abs(ys[ys.length - 1] - ys[0])) : '–'}</b><span>change</span></div>
      <div class="stat"><b>${ys.length > 1 ? fmtNum(((ys[ys.length - 1] - ys[0]) / Math.max(1, daysBetween(shown[0].date, shown[shown.length - 1].date))) * 7) : '–'}</b><span>${bu()} / week</span></div>
    </div>
  </section>
  <section class="card"><div class="card-head"><h2>WHOOP recovery</h2><span class="muted small">${wh.length ? `avg ${Math.round(avg(wh.map((w) => Number(w.rec))))}%` : ''}</span></div>
    <div id="ch-rec"></div>
    ${wh.length ? `<div class="stats compact">
      <div class="stat"><b>${fmtNum(avg(wh.map((w) => Number(w.hrv) || 0).filter(Boolean)) || 0) || '–'}</b><span>avg HRV ms</span></div>
      <div class="stat"><b>${fmtNum(avg(wh.map((w) => Number(w.rhr) || 0).filter(Boolean)) || 0) || '–'}</b><span>avg resting HR</span></div>
      <div class="stat"><b>${fmtNum(avg(wh.map((w) => Number(w.sleep) || 0).filter(Boolean)) || 0) || '–'}</b><span>avg sleep h</span></div></div>` : ''}
  </section>`;
}

function habitRows(days) {
  return [
    ['Workout or rest day logged', (d) => sessionsOn(d).length > 0],
    ['Posture (APT) routine', (d) => aptFrac(d) >= 1],
    ['Abs', (d) => absDone(d)],
    ['All supplements', (d) => suppsFrac(d) >= 1],
    ['Protein target', (d) => dayTotals(dayData(d), S.settings.supps).p >= targets(d).p * 0.9],
    ['Calories within 10%', (d) => { const day = dayData(d), t = targets(d); if (!(day.food || []).length) return false; return Math.abs(dayTotals(day, S.settings.supps).kcal - t.kcal) <= t.kcal * 0.1; }],
    ['Water goal', (d) => (dayData(d).water || 0) >= waterGoalMl()],
    ['Step goal', (d) => (dayData(d).steps || 0) >= stepGoalOn(d)],
  ].map(([label, f]) => ({ label, hits: days.map(f) }));
}
function trHabits() {
  const days = lastNDays(Math.max(30, S.trend.days === 7 ? 14 : S.trend.days));
  const rows = habitRows(days);
  return `<section class="card"><div class="card-head"><h2>Consistency</h2><span class="muted small">last ${days.length} days, oldest on the left</span></div>
    <ul class="habits">${rows.map((r) => { const n = r.hits.filter(Boolean).length; return `<li><div class="hb-top"><span>${r.label}</span><b class="num">${Math.round((n / days.length) * 100)}%</b></div>
      <div class="hstrip" style="--n:${days.length}">${r.hits.map((h, i) => `<i class="${h ? 'on' : ''}" title="${mdDate(days[i])}"></i>`).join('')}</div></li>`; }).join('')}</ul></section>`;
}

// ---------------------------------------------------------------- history (calendar)
function historyView() {
  const [y, m] = S.hist.month.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const startPad = (first.getDay() + 6) % 7;
  const nDays = new Date(y, m, 0).getDate();
  const today = ymd();
  const cells = [];
  for (let i = 0; i < startPad; i++) cells.push('<span></span>');
  for (let i = 1; i <= nDays; i++) {
    const d = ymd(new Date(y, m - 1, i));
    const ss = sessionsOn(d);
    const has = ss.length || S.daily[d];
    const sc = has ? dayScore(d).pct : null;
    const s = ss[ss.length - 1];
    cells.push(`<button class="cal-d ${d === S.hist.sel ? 'sel' : ''} ${d === today ? 'today' : ''} ${d > today ? 'future' : ''}" data-act="hist-pick" data-v="${d}" ${d > today ? 'disabled' : ''} style="--day:${s ? plate(s.color) : 'transparent'}">
      <span class="cd-n">${i}</span>${s ? '<span class="cd-plate"></span>' : ''}${sc != null ? `<span class="cd-score" style="--p:${sc}"></span>` : ''}</button>`);
  }
  const monthName = first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const canNext = S.hist.month < today.slice(0, 7);
  const workouts = S.sessions.filter((s) => s.status === 'done' && !s.rest && s.date.startsWith(S.hist.month)).length;
  return `<header class="top"><h1 class="display">History</h1><p class="muted small">${workouts} workouts in ${first.toLocaleDateString(undefined, { month: 'long' })}</p></header>
  <section class="card cal">
    <div class="cal-head">
      <button class="icon-btn sm" data-act="hist-month" data-v="-1" aria-label="Previous month">${icon('left', 20)}</button>
      <b>${monthName}</b>
      <button class="icon-btn sm" data-act="hist-month" data-v="1" aria-label="Next month" ${canNext ? '' : 'disabled'}>${icon('right', 20)}</button>
    </div>
    <div class="cal-grid">${['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((x) => `<span class="cal-wd">${x}</span>`).join('')}${cells.join('')}</div>
    <p class="muted small cal-key"><span class="cd-plate demo"></span> workout colour &nbsp; <span class="cd-score demo" style="--p:80"></span> day score</p>
  </section>
  ${dayDetail(S.hist.sel)}`;
}

function dayDetail(d) {
  const day = dayData(d);
  const ss = sessionsOn(d);
  const sc = dayScore(d);
  const tot = dayTotals(day, S.settings.supps);
  const t = targets();
  const u = unit();
  const taken = activeSupps().filter((s) => Number(day.supps?.[s.id]) > 0);
  const w = day.whoop || {};
  const row = (l, v) => `<li><span>${l}</span><span class="num">${v}</span></li>`;
  return `<section class="card day-detail">
    <div class="card-head"><div><p class="muted small">${longDate(d)}</p><h2 class="dd-title">Day score ${sc.pct}</h2></div>
      <button class="btn" data-act="open-day" data-v="${d}">Edit day</button></div>
    ${ss.length ? ss.map((s) => { const st = sessionStats(s, u); return `<button class="row-btn" data-act="open-session" data-id="${s.id}" style="--day:${plate(s.color)}"><span class="pip lg"></span>
      <span class="grow"><b>${esc(s.dayName)}</b><br><span class="muted small">${s.rest ? 'Rest day' : `${st.sets} sets · ${fmtInt(st.volume)} ${u}${st.minutes ? ` · ${st.minutes} min` : ''}`}</span></span>${(s.exercises || []).some((e) => e.sets.some((x) => x.pr)) ? '<span class="pr">PR</span>' : ''}</button>`; }).join('') : '<p class="muted small">No workout logged.</p>'}
    <ul class="plain-list">
      ${row('Calories', (day.food || []).length ? `${fmtInt(tot.kcal)} / ${fmtInt(t.kcal)}` : '–')}
      ${row('Protein · carbs · fat', (day.food || []).length ? `${r1(tot.p)} · ${r1(tot.c)} · ${r1(tot.f)} g` : '–')}
      ${row('Water', day.water ? fmtWater(day.water) : '–')}
      ${row('Steps', day.steps ? fmtInt(day.steps) : '–')}
      ${row('Posture routine', aptFrac(d) >= 1 ? 'Done' : aptFrac(d) > 0 ? `${Math.round(aptFrac(d) * 100)}%` : '–')}
      ${row('Abs', absDone(d) ? 'Done' : '–')}
      ${row('Supplements', taken.length ? taken.map((s) => esc(s.name)).join(', ') : '–')}
      ${row('Body weight', day.bw ? `${fmtNum(bwOf(day))} ${bu()}` : '–')}
      ${day.waist ? row('Waist', `${day.waist} ${day.waistUnit || S.settings.waistUnit || 'in'}`) : ''}
      ${w.rec ? row('WHOOP', `${w.rec}% rec${w.hrv ? ` · ${w.hrv} ms` : ''}${w.sleep ? ` · ${w.sleep} h sleep` : ''}`) : ''}
    </ul>
    ${(day.food || []).length ? `<details class="dd-food"><summary>Food (${day.food.length})</summary><ul class="plain-list">${day.food.map((f) => `<li><span>${esc(f.name)}<br><span class="muted small">${esc(qtyLabel(f))}</span></span><span class="num">${fmtInt(f.kcal)} kcal</span></li>`).join('')}</ul></details>` : ''}
  </section>`;
}

// ---------------------------------------------------------------- setup
function setupView() {
  const s = S.settings;
  const r = routine();
  const p = s.profile;
  const t = targets();
  const opt = (v, cur, l) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${l}</option>`;
  const listEditor = (key, title, note) => `<details class="card day-edit" ${S.openDay === key ? 'open' : ''} data-day-id="${key}">
    <summary><span class="grow"><b>${title}</b><br><span class="muted small">${(s[key] || []).length} moves</span></span></summary>
    <p class="muted small">${note}</p>
    <ul class="routine-list">${(s[key] || []).map((x, i) => `<li class="routine-row two">
      <input data-list="${key}" data-i="${i}" data-k="name" value="${esc(x.name)}" aria-label="Name" class="grow">
      <input data-list="${key}" data-i="${i}" data-k="target" value="${esc(x.target)}" aria-label="Target" class="tgt">
      <button class="icon-btn sm danger" data-act="list-del" data-list="${key}" data-i="${i}" aria-label="Remove ${esc(x.name)}">×</button></li>`).join('')}</ul>
    <div class="routine-row"><input id="add-${key}" placeholder="New move" class="grow"><button class="btn" data-act="list-add" data-list="${key}">Add</button></div>
  </details>`;
  return `<header class="top setup-top"><button class="icon-btn" data-act="tab" data-v="today" aria-label="Back">${icon('back')}</button><h1 class="display grow">Setup</h1></header>

  <section class="card">
    <div class="card-head"><h2>You</h2></div>
    <div class="grid2">
      <label class="field"><span>Name</span><input data-prof="name" value="${esc(p.name || '')}"></label>
      <label class="field"><span>Age</span><input data-prof="age" inputmode="numeric" value="${esc(p.age)}"></label>
      <label class="field"><span>Height (inches)</span><input data-prof="heightIn" inputmode="decimal" value="${esc(p.heightIn)}" placeholder="e.g. 70"></label>
      <label class="field"><span>Sex</span><select data-prof="sex">${opt('male', p.sex, 'Male')}${opt('female', p.sex, 'Female')}</select></label>
      <label class="field"><span>Activity</span><select data-prof="activity">${opt('light', p.activity, 'Light (desk + 3 workouts)')}${opt('moderate', p.activity, 'Moderate (4–5 workouts)')}${opt('high', p.activity, 'High (daily + active job)')}</select></label>
      <label class="field"><span>Goal</span><select data-prof="goal">${opt('cut', p.goal, 'Lose fat')}${opt('recomp', p.goal, 'Recomp (lean + muscle)')}${opt('maintain', p.goal, 'Maintain')}${opt('bulk', p.goal, 'Lean bulk')}</select></label>
    </div>
    <p class="muted small">Body weight comes from your latest log${latestBw() ? ` (${fmtNum(latestBw())} ${bu()})` : ' (none yet, log it on Today)'}.</p>
  </section>

  <section class="card">
    <div class="card-head"><h2>Daily targets</h2>
      <div class="seg tiny"><button class="${s.targets.auto ? 'on' : ''}" data-act="tgt-auto" data-v="1">Auto</button><button class="${s.targets.auto ? '' : 'on'}" data-act="tgt-auto" data-v="0">Manual</button></div></div>
    ${t.journey ? `<p class="small banner z-green">Your birthday plan sets calories, protein and steps for each day until ${mdDate(J().end)}. The numbers below take over after that.</p>` : ''}
    ${s.targets.auto && !t.calculated && !t.journey ? '<p class="small warn">Add age, height and a body weight to calculate. Using the manual numbers below until then.</p>' : ''}
    ${s.targets.auto && t.calculated ? `<p class="muted small">Calculated: BMR ${fmtInt(t.bmr)}, burn about ${fmtInt(t.tdee)} kcal a day. Protein is 1 g per lb of body weight.</p>` : ''}
    <div class="grid3">${[['kcal', 'Calories'], ['p', 'Protein g'], ['c', 'Carbs g'], ['f', 'Fat g'], ['fib', 'Fiber g']].map(([k, l]) => `<label class="field"><span>${l}</span><input data-tgt="${k}" inputmode="numeric" value="${t[k]}" ${s.targets.auto && t.calculated ? 'disabled' : ''}></label>`).join('')}
      <label class="field"><span>Water (${isOz() ? 'oz' : 'ml'})</span><input data-tgt="waterMl" inputmode="numeric" value="${isOz() ? Math.round(t.waterMl / ML_PER_OZ) : t.waterMl}" ${s.targets.auto && t.calculated ? 'disabled' : ''}></label></div>
    <label class="pref"><span>Daily step goal</span><input id="step-goal" inputmode="numeric" value="${s.stepGoal}" class="small-input"></label>
  </section>

  <section class="card">
    <div class="card-head"><h2>Preferences</h2></div>
    <div class="pref"><span>Lifting weight unit</span><div class="seg tiny">${['lb', 'kg'].map((k) => `<button class="${s.unit === k ? 'on' : ''}" data-act="set-unit" data-v="${k}">${k}</button>`).join('')}</div></div>
    <div class="pref"><span>Body weight unit</span><div class="seg tiny">${['kg', 'lb'].map((k) => `<button class="${bu() === k ? 'on' : ''}" data-act="set-body-unit" data-v="${k}">${k}</button>`).join('')}</div></div>
    <div class="pref"><span>Waist unit</span><div class="seg tiny">${['in', 'cm'].map((k) => `<button class="${(s.waistUnit || 'in') === k ? 'on' : ''}" data-act="set-waist-unit" data-v="${k}">${k}</button>`).join('')}</div></div>
    <div class="pref"><span>Water unit</span><div class="seg tiny">${['oz', 'ml'].map((k) => `<button class="${(s.waterUnit || 'oz') === k ? 'on' : ''}" data-act="set-water-unit" data-v="${k}">${k}</button>`).join('')}</div></div>
    <div class="pref"><span>Rest timer</span><div class="seg tiny">${[0, 60, 90, 120, 180].map((k) => `<button class="${s.restSec === k ? 'on' : ''}" data-act="set-rest" data-v="${k}">${k ? (k < 120 ? k + 's' : k / 60 + 'm') : 'Off'}</button>`).join('')}</div></div>
  </section>

  <h2 class="section-title">Supplements & powders</h2>
  <section class="card">
    <p class="muted small">Powders with calories (like whey) are added to your food totals when you tick them.</p>
    <ul class="supp-edit">${(s.supps || []).map((x, i) => `<li>
      <label class="switch"><input type="checkbox" data-supp="${i}" data-k="on" ${x.on !== false ? 'checked' : ''}><span></span></label>
      <div class="grow stack gap-s">
        <div class="routine-row"><input data-supp="${i}" data-k="name" value="${esc(x.name)}" class="grow" aria-label="Name"><button class="icon-btn sm danger" data-act="supp-del" data-i="${i}" aria-label="Delete ${esc(x.name)}">×</button></div>
        <div class="routine-row"><input data-supp="${i}" data-k="dose" value="${esc(x.dose)}" placeholder="Dose" class="grow" aria-label="Dose"><input data-supp="${i}" data-k="when" value="${esc(x.when || '')}" placeholder="When" class="grow" aria-label="When"></div>
        ${x.kind === 'powder' ? `<div class="grid4 tight">${[['kcal', 'kcal'], ['p', 'P g'], ['c', 'C g'], ['f', 'F g']].map(([k, l]) => `<label class="mini col"><span>${l}</span><input data-supp="${i}" data-k="${k}" inputmode="decimal" value="${x[k] ?? 0}"></label>`).join('')}</div>` : ''}
      </div></li>`).join('')}</ul>
    <div class="routine-row"><input id="add-supp" placeholder="New supplement or powder" class="grow">
      <select id="add-supp-kind" class="small-select"><option value="pill">Pill</option><option value="powder">Powder</option></select>
      <button class="btn" data-act="supp-add">Add</button></div>
  </section>

  <h2 class="section-title">Posture & core</h2>
  ${listEditor('apt', 'Anterior pelvic tilt fix', 'Stretch tight hip flexors, strengthen glutes and abs. Ticking the APT warm-up in a gym session marks all of these done.')}
  ${listEditor('abs', 'Abs circuit', 'For days without abs in the gym. Two or more moves counts as an abs day.')}

  <section class="card">
    <div class="card-head"><h2>Gym warm-up</h2></div>
    ${r.warmup.map((w, i) => `<div class="routine-row">
      <input data-warm-def="${i}" data-k="name" value="${esc(w.name)}" aria-label="Warm-up name" class="grow">
      <label class="mini"><input data-warm-def="${i}" data-k="min" inputmode="numeric" value="${w.min}"><span>min</span></label>
    </div>`).join('')}
  </section>

  <h2 class="section-title">Your split</h2>
  <p class="muted small pad-x">Push, Pull, Quads, Rest, Upper, Hamstrings, then repeat. Changes here show up in the plan. Renaming an exercise keeps its history.</p>
  ${r.days.map((d, di) => `<details class="card day-edit" style="--day:${plate(d.color)}" ${S.openDay === d.id ? 'open' : ''} data-day-id="${d.id}">
    <summary><span class="pip lg"></span><span class="grow"><b>${esc(d.name)}</b><br><span class="muted small">${d.rest ? 'Rest' : `${d.exercises.length} exercises`}</span></span></summary>
    <div class="routine-row"><label class="field grow"><span>Day name</span><input data-day="${di}" data-k="name" value="${esc(d.name)}"></label></div>
    ${d.rest ? '' : `
    <ul class="routine-list">${d.exercises.map((e, ei) => `<li class="routine-row">
      <input data-day="${di}" data-ex="${ei}" data-k="exname" value="${esc(e.name)}" class="grow" aria-label="Exercise name">
      <button class="icon-btn sm" data-act="ex-up" data-day="${di}" data-ex="${ei}" ${ei === 0 ? 'disabled' : ''} aria-label="Move up">↑</button>
      <button class="icon-btn sm" data-act="ex-down" data-day="${di}" data-ex="${ei}" ${ei === d.exercises.length - 1 ? 'disabled' : ''} aria-label="Move down">↓</button>
      <button class="icon-btn sm danger" data-act="ex-del" data-day="${di}" data-ex="${ei}" aria-label="Remove ${esc(e.name)}">×</button>
    </li>`).join('')}</ul>
    <div class="routine-row"><input id="add-ex-${di}" placeholder="New exercise name" class="grow"><button class="btn" data-act="ex-add" data-day="${di}">Add</button></div>`}
  </details>`).join('')}

  <section class="card">
    <div class="card-head"><h2>WHOOP</h2></div>
    <p class="muted small">Enter recovery, HRV, resting heart rate, sleep and strain on the Today screen. Syncing straight from WHOOP needs a WHOOP developer app and a small server to keep its secret key, so it isn’t switched on yet.</p>
  </section>

  <section class="card">
    <div class="card-head"><h2>Account</h2></div>
    <p class="muted small">Signed in as ${esc(S.user.email)}. Your log syncs to every device you sign in on.</p>
    <div class="stack gap-s">
      <button class="btn" data-act="export">Download all my data</button>
      <button class="btn ghost" data-act="signout">Sign out</button>
    </div>
  </section>`;
}

// ---------------------------------------------------------------- birthday plan
const kgOf = (v) => bwOf(v, 'kg');
const showKg = (kg) => (bu() === 'kg' ? `${fmtNum(kg)} kg` : `${fmtNum(Math.round(kg * 2.20462 * 10) / 10)} lb`);
const showKgDelta = showKg;
// Weigh-ins from day 1 of the plan on; anything earlier isn't counted.
function weightsKg() {
  const start = S.settings.journey?.start || '';
  return Object.entries(S.daily).filter(([d, v]) => v.bw && d >= start).map(([date, v]) => ({ date, kg: kgOf(v) })).sort((a, b) => (a.date < b.date ? -1 : 1));
}
function avgKgAround(date, days = 7) {
  const w = weightsKg().filter((x) => x.date <= date && x.date > addDays(date, -days));
  return w.length ? Math.round((w.reduce((a, x) => a + x.kg, 0) / w.length) * 10) / 10 : null;
}
// Exercises whose best estimated 1RM in the last 14 days is >3% under the 14 days before.
function liftDrops(date) {
  const u = unit();
  let n = 0;
  for (const e of allExercises()) {
    const h = exerciseHistory(S.sessions, e.id, u);
    const best = (a, b) => Math.max(0, ...h.filter((p) => p.date > addDays(date, -b) && p.date <= addDays(date, -a)).map((p) => p.e1rm));
    const now = best(0, 14), before = best(14, 28);
    if (now && before && now < before * 0.97) n++;
  }
  return n;
}

// Exercises for a planned day, with sets × reps. Your Setup edits to a split day are respected.
function planWorkout(p) {
  if (!p?.workout) return [];
  const rd = !p.workout.injury && routine().days.find((x) => x.id === p.type && !x.rest);
  if (rd) return rd.exercises.map((e) => {
    const pr = prescription(p.type, e.id);
    return { id: e.id, name: e.name, muscle: muscleOf(e), sets: setsFor(pr.sets, p.phase, p.firstLegWeek), reps: pr.reps, note: pr.note || '' };
  });
  return p.workout.exercises.map((e) => ({ ...e, name: libById[e.id]?.name || e.id, muscle: libById[e.id]?.muscle }));
}
function planFromJourney(p) {
  if (!p.workout) return { dayId: null, muscles: [], list: [], warm: true };
  const list = planWorkout(p);
  return {
    dayId: routine().days.some((d) => d.id === p.type) ? p.type : null,
    dayObj: p.workout.injury ? { id: p.type, name: p.workout.name, color: p.workout.color, exercises: [] } : null,
    muscles: [...new Set(list.map((e) => e.muscle).filter(Boolean))],
    list: list.map((e) => e.id), warm: true,
    sets: Object.fromEntries(list.map((e) => [e.id, e.sets])), reps: Object.fromEntries(list.map((e) => [e.id, e.reps])),
    noWalk: !p.walkWarmup, planDay: p.date,
  };
}
// Train-tab presets pick up today's phase (ramp-up sets, deload, etc.).
function withPrescriptions(plan, dayId) {
  const p = planOf(ymd());
  if (!p || !plan.list.length) return plan;
  const firstLeg = ['quads', 'hams'].includes(dayId) && ymd() >= J().legsFrom && daysBetween(J().legsFrom, ymd()) < 10;
  plan.sets = Object.fromEntries(plan.list.map((id) => [id, setsFor(prescription(dayId, id).sets, p.phase, firstLeg)]));
  plan.reps = Object.fromEntries(plan.list.map((id) => [id, prescription(dayId, id).reps]));
  plan.noWalk = !p.walkWarmup;
  return plan;
}

// Before day 1: a preview of what's coming.
function startsSoonCard(d) {
  const j = S.settings.journey;
  if (!j?.on || d >= j.start || daysBetween(d, j.start) > 7) return '';
  const p = planFor(j, j.start);
  const n = daysBetween(d, j.start);
  const { meals } = buildMeals(p, j.trainTime);
  return `<section class="card journey" style="--day:${plate(p.day.color)}">
    <p class="muted small">Birthday plan · ${mdDate(j.start)} → ${mdDate(j.end)}</p>
    <h2 class="jc-title">Day 1 starts ${n === 1 ? 'tomorrow' : `in ${n} days`}, ${shortDate(j.start)}</h2>
    <div class="jc-today"><span class="pip"></span><b>${esc(p.day.name)}</b><span>${fmtInt(p.targets.kcal)} kcal</span><span>${p.targets.p} g protein</span><span>${esc(p.steps)}</span></div>
    <p class="small">First meal: ${esc(meals[0].time)}, ${esc(meals[0].option.name)}. Weigh yourself tomorrow morning after the bathroom, before you eat or drink, and log it here.</p>
    <div class="btn-row"><button class="btn primary grow" data-act="tab" data-v="plan">See the full plan</button><button class="btn" data-act="plan-open" data-v="${j.start}">Tomorrow in detail</button></div>
  </section>`;
}

function journeyCard(p) {
  const j = J();
  const today = ymd();
  const avgNow = avgKgAround(p.date);
  const tgt = targetKg(j, p.date);
  const diff = avgNow == null ? null : Math.round((avgNow - tgt) * 10) / 10;
  const toGo = avgNow == null ? null : Math.max(0, Math.round((avgNow - j.goalKg) * 10) / 10);
  const status = diff == null ? ['', 'Weigh in each morning to track your pace.'] : diff <= 0.3 ? ['ok', diff < -0.3 ? 'Ahead of the line' : 'On track'] : diff <= 1 ? ['warn', `${showKgDelta(diff)} behind the line`] : ['bad', `${showKgDelta(diff)} behind: see the check-in rules in Plan → Guide`];
  const left = daysToGo(j, p.date);
  return `<section class="card journey" style="--day:${plate(p.day.color)}">
    <div class="jc-top">
      ${ring(p.n / p.total, 76, 7, PLATE.yellow, `<b>${p.n}</b><span>of ${p.total}</span>`)}
      <div class="grow">
        <p class="muted small">${esc(p.phase.name)} · ${esc(p.phase.weeks)}</p>
        <h2 class="jc-title">${p.birthday ? 'Happy birthday. Weigh in.' : `${left} day${left === 1 ? '' : 's'} to ${mdDate(j.end)}`}</h2>
        <p class="small jc-status ${status[0]}">${status[1]}</p>
      </div>
    </div>
    <div class="jc-stats">
      <div><span>7-day avg</span><b>${avgNow == null ? '–' : showKg(avgNow)}</b></div>
      <div><span>Target today</span><b>${showKg(tgt)}</b></div>
      <div><span>To go</span><b>${toGo == null ? '–' : showKgDelta(toGo)}</b></div>
    </div>
    <div class="jc-today">
      <span class="pip"></span><b>${esc(p.day.name)}</b>
      <span>${fmtInt(p.targets.kcal)} kcal</span><span>${p.targets.p} g protein</span><span>${esc(p.steps)}</span>
    </div>
    ${p.tags.length ? `<div class="tag-row">${p.tags.map((t) => `<span class="tag t-${slug(t)}">${esc(t)}</span>`).join('')}</div>` : ''}
    ${p.date === today ? '' : `<p class="muted small">Viewing ${shortDate(p.date)}.</p>`}
  </section>`;
}

// Shows on and after a check-in day until it's answered (up to a week).
function pendingCheckin(p) {
  const done = J().checkins || {};
  return CHECKIN_DAYS.filter((c) => c <= p.n && p.n - c < 7 && !done[c]).pop();
}
function checkinCard(p) {
  if (p.date !== ymd()) return '';
  const c = pendingCheckin(p);
  if (!c) return '';
  const a = checkinAdvice(c, weightsKg(), liftDrops(p.date), J(), p.date);
  const waist = waistChange(p.date);
  return `<section class="card checkin c-${a.status}">
    <p class="muted small">Day ${c} check-in</p>
    <h2>${esc(a.title)}</h2>
    <p class="small">${esc(a.body)}</p>
    ${a.nowAvg ? `<p class="muted small">This week’s average ${showKg(a.nowAvg)} · target ${showKg(a.target)}${waist ? ` · waist ${waist}` : ''}</p>` : ''}
    <div class="btn-row">
      ${a.adj ? `<button class="btn primary grow" data-act="checkin" data-c="${c}" data-adj="${a.adj}">${a.adj > 0 ? 'Add' : 'Cut'} ${Math.abs(a.adj)} kcal a day</button><button class="btn" data-act="checkin" data-c="${c}" data-adj="0">Keep as is</button>`
        : `<button class="btn primary grow" data-act="checkin" data-c="${c}" data-adj="0">${a.status === 'data' ? 'Remind me next time' : 'Got it'}</button>`}
    </div>
  </section>`;
}
function waistChange(date) {
  const w = Object.entries(S.daily).filter(([d, v]) => v.waist && d <= date && d >= J().start).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  if (w.length < 2) return '';
  const [first, last] = [w[0][1], w[w.length - 1][1]];
  const d = Math.round((Number(last.waist) - Number(first.waist)) * 10) / 10;
  return `${d <= 0 ? '−' : '+'}${Math.abs(d)} ${last.waistUnit || 'in'} since ${mdDate(w[0][0])}`;
}

function plannedWorkoutCard(p, isToday) {
  const j = J();
  const yesterday = addDays(p.date, -1);
  const yp = planOf(yesterday);
  const missed = isToday && yp && yp.kind === 'train' && !sessionsOn(yesterday).length && !(j.shifts || []).some((x) => x.from === p.date);
  const missedLink = missed ? `<button class="link small" data-act="j-shift">Missed ${esc(yp.day.name)} yesterday? Do it today and move the plan back a day</button>` : '';
  if (!p.workout) return `<section class="card train-card" style="--day:${plate(p.day.color)}">
    <div class="tc-row"><div class="disc xs" aria-hidden="true"><div class="disc-hole"></div></div>
      <div class="grow"><p class="muted small">${p.birthday ? 'Day 100' : 'Today’s plan'}</p><h2 class="tc-title">${esc(p.day.name)}</h2>
      <p class="muted small">${p.birthday ? 'Weigh in after the bathroom, before food or water. Take front, side and back photos in the same light as day 1.' : 'No lifting. Easy walking for your steps, the 20-minute posture routine, 7–9 hours of sleep.'}</p></div></div>
    ${isToday ? `<div class="btn-row"><button class="btn primary big grow" data-act="log-rest">Log rest day</button></div>` : '<p class="muted small">Nothing logged on this day.</p>'}
    ${missedLink}</section>`;
  const list = planWorkout(p);
  const warm = [`${esc(routine().warmup.find((w) => w.id === 'apt')?.name || 'Posture routine')} 20 min`];
  if (p.walkWarmup) warm.push('incline walk 20 min');
  return `<section class="card train-card plan-wk" style="--day:${plate(p.day.color)}">
    <div class="tc-row"><div class="disc xs" aria-hidden="true"><div class="disc-hole"></div></div>
      <div class="grow"><p class="muted small">Today’s workout · ${esc(p.phase.name)}</p><h2 class="tc-title">${esc(p.day.name)}</h2>
      <p class="muted small">${esc(p.day.focus)}</p></div></div>
    ${p.workout.injury ? `<p class="banner z-yellow small"><b>Foot-safe swap.</b> Your ${p.type === 'arms' ? 'Quads' : 'Hamstrings'} day becomes seated upper-body work until your foot heals. Nothing standing or loaded through your feet.</p>` : ''}
    ${p.firstLegWeek ? '<p class="banner z-yellow small"><b>First leg sessions back.</b> One set fewer and lighter weights. Stop any exercise that hurts your foot.</p>' : ''}
    <p class="small muted">${esc(p.phase.effort)}</p>
    <ol class="pw-list">${list.map((e) => {
      const ls = lastSetsFor(S.sessions, e.id);
      return `<li><span class="grow"><b>${esc(e.name)}</b>${e.note ? `<span class="muted small">${esc(e.note)}</span>` : ''}</span><span class="num pw-sr"><b>${e.sets} × ${esc(e.reps)}</b><span class="muted small">${ls ? `last ${setsLine(ls.sets.slice(0, 1), ls.session.unit)}` : 'new'}</span></span></li>`;
    }).join('')}</ol>
    <p class="muted small">Warm-up: ${warm.join(' + ')}${p.walkWarmup ? '' : '. Incline walk is off until your foot heals.'}</p>
    ${isToday ? `<div class="btn-row"><button class="btn primary big grow" data-act="start-planned">Start ${esc(p.day.name)}</button><button class="btn" data-act="plan-today">Edit</button></div>` : '<p class="muted small">Nothing logged on this day.</p>'}
    ${missedLink}
  </section>`;
}

// Meals already ticked keep the carb amount that was logged.
function mealsFor(p, d) {
  const locked = {};
  for (const f of dayData(d).food || []) if (f.plan && ['sourdough', 'oats', 'basmati', 'quinoa', 'millet'].includes(f.foodId)) locked[f.plan] = f.qty;
  return buildMeals(p, J().trainTime, dayData(d).mealSwaps || {}, locked);
}
function mealsCard(p) {
  const d = p.date;
  const { meals, total } = mealsFor(p, d);
  const food = dayData(d).food || [];
  const nDone = meals.filter((m) => food.some((f) => f.plan === m.slot)).length;
  return `<section class="card meals-plan" id="sec-meals">
    <div class="card-head"><h2>Today’s meals</h2><span class="muted small">${nDone} of ${meals.length} eaten</span></div>
    <p class="muted small">${fmtInt(total.kcal)} kcal · ${Math.round(total.p)} g protein · ${Math.round(total.c)} g carbs · ${Math.round(total.f)} g fat${p.kind === 'rest' ? ' · rest day, fewer carbs' : ''}</p>
    ${p.flex ? `<p class="banner z-green small"><b>Flex day.</b> Eat the plan through the day, then enjoy about ${FLEX_TREAT} kcal more at your holiday meal. That puts you at maintenance, which won’t slow the cut.</p>` : ''}
    <ol class="timeline">${meals.map((m) => mealBlock(m, d, food.some((f) => f.plan === m.slot), true)).join('')}</ol>
    <p class="muted small">Ticking a meal logs it in Fuel with exact amounts. Ate something different? Log it in Fuel instead.</p>
  </section>`;
}
function mealBlock(m, d, eaten, actions) {
  const swappable = m.slot !== 'pre' && MEAL_OPTIONS[m.slot]?.length > 1;
  return `<li class="tl-item ${eaten ? 'eaten' : ''}">
    <span class="tl-time">${m.time.replace(' ', ' ')}</span>
    <div class="tl-body">
      <div class="tl-head"><div class="grow"><p class="muted small">${esc(m.label)}</p><b>${esc(m.option.name)}</b></div>
        ${actions ? `<button class="check ${eaten ? 'on' : ''}" data-act="meal-log" data-slot="${m.slot}" aria-pressed="${eaten}" aria-label="${eaten ? 'Unmark' : 'Mark'} ${esc(m.label)} eaten">${checkSvg}</button>` : ''}</div>
      <ul class="tl-items">${m.items.map((it) => `<li><span>${esc(itemName(it.id).replace(/, (cooked|grilled)$/, ''))}</span><span class="num">${esc(itemAmount(it.id, it.g))}</span></li>`).join('')}</ul>
      <p class="muted small">${fmtInt(m.macros.kcal)} kcal · ${Math.round(m.macros.p)} g protein${m.option.note ? ` · ${esc(m.option.note)}` : ''}</p>
      ${actions && swappable && !eaten ? `<button class="link small" data-act="meal-swap" data-slot="${m.slot}">${icon('swap', 16)} Swap for another option</button>` : ''}
    </div></li>`;
}

// ---------------------------------------------------------------- Plan tab
function planView() {
  const j = J();
  const tabs = [['days', 'Days', 'plan'], ['guide', 'Guide', 'book'], ['shop', 'Groceries', 'cart']];
  return `<header class="top"><div><p class="muted small">${mdDate(j.start)} → ${mdDate(j.end)} · ${totalDays(j)} days</p><h1 class="display">Birthday plan</h1></div>
    <button class="icon-btn" data-act="tab" data-v="setup" aria-label="Setup">${icon('gear')}</button></header>
  <div class="seg wide" role="tablist">${tabs.map(([k, l]) => `<button role="tab" aria-selected="${S.planTab === k}" class="${S.planTab === k ? 'on' : ''}" data-act="plan-tab" data-v="${k}">${l}</button>`).join('')}</div>
  ${{ days: planDays, guide: guideView, shop: shopView }[S.planTab]()}`;
}

function planDays() {
  const j = J();
  const today = ymd();
  const n = totalDays(j);
  const plans = Array.from({ length: n }, (_, i) => planFor(j, addDays(j.start, i)));
  const weeks = [];
  for (let i = 0; i < plans.length; i += 7) weeks.push(plans.slice(i, i + 7));
  const curW = Math.max(0, Math.min(weeks.length - 1, Math.floor(daysBetween(j.start, today) / 7)));
  const phases = [['ramp', 'Ease in', 14], ['build', 'Build', 42], ['deload', 'Deload', 7], ['push', 'Final push', 37]];
  const todayN = Math.max(0, Math.min(n, daysBetween(j.start, today) + 1));
  return `
  <section class="card">
    <div class="card-head"><h2>Weight vs target</h2><span class="muted small">${showKg(j.startKg)} → ${showKg(j.goalKg)}</span></div>
    <p class="muted small">Stay on or under the dashed line and you reach ${showKg(j.goalKg)} on ${mdDate(j.end)}. Single days bounce around. The average line is the one to watch.</p>
    <div id="ch-journey"></div>
    <div class="legend jl"><span><i class="lg-dot"></i>Weigh-ins</span><span><i class="lg-line"></i>7-day average</span><span><i class="lg-dash"></i>Target path</span></div>
    <div class="phase-bar">${phases.map(([id, l, d]) => `<span class="ph ph-${id}" style="flex:${d}" title="${l}"></span>`).join('')}<b class="ph-now" style="left:${(todayN / n) * 100}%"></b></div>
    <div class="legend">${phases.map(([id, l]) => `<span><i class="ph-${id}"></i>${l}</span>`).join('')}</div>
  </section>

  <details class="card plan-ctrl" ${S.openDay === 'plan-ctrl' ? 'open' : ''} data-day-id="plan-ctrl">
    <summary><span class="grow"><b>Plan settings</b><br><span class="muted small">Training time, foot, calorie adjustments</span></span><span class="chev">${icon('right', 18)}</span></summary>
    <div class="pref"><span>I train in the</span><div class="seg tiny">${[['morning', 'Morning'], ['evening', 'Evening']].map(([k, l]) => `<button class="${j.trainTime === k ? 'on' : ''}" data-act="j-time" data-v="${k}">${l}</button>`).join('')}</div></div>
    <p class="muted small">Meal times move around your workout: pre-workout fuel before, the biggest protein meal after.</p>
    <div class="pref col"><span>Foot injury: legs return on <b>${mdDate(j.legsFrom)}</b></span>
      <div class="btn-row">${today < j.legsFrom ? '<button class="btn" data-act="j-foot" data-v="now">My foot is ready now</button>' : ''}<button class="btn" data-act="j-foot" data-v="7">Push back 1 week</button></div></div>
    <p class="muted small">Until then, Quads and Hamstrings days become seated Arms + Core and Shoulders + Back days, and steps are only as many as stay pain-free.</p>
    <div class="pref"><span>Calorie adjustment from check-ins</span><b class="num">${j.calAdj > 0 ? '+' : ''}${j.calAdj || 0} kcal</b></div>
    <p class="muted small">Training days ${fmtInt(KCAL.train + (j.calAdj || 0))} kcal, rest days ${fmtInt(KCAL.rest + (j.calAdj || 0))} kcal, protein ${PROTEIN} g, fat ${FAT} g.${j.calAdj ? ' <button class="link small" data-act="j-adj-reset">Reset to 0</button>' : ''}</p>
    ${(j.shifts || []).length ? `<p class="muted small">The plan has moved back ${(j.shifts || []).reduce((a, x) => a + x.n, 0)} day(s) for missed workouts. <button class="link small" data-act="j-shift-undo">Undo the last one</button></p>` : ''}
  </details>

  ${weeks.map((w, wi) => `<details class="card week-plan" ${wi === curW || S.openDay === 'w' + wi ? 'open' : ''} data-day-id="w${wi}">
    <summary><span class="grow"><b>Week ${wi + 1}</b> <span class="muted small">${mdDate(w[0].date)} – ${mdDate(w[w.length - 1].date)} · ${esc(w[0].phase.name)}</span></span>
      <span class="wk-pips">${w.map((p) => `<i style="background:${plate(p.day.color)}" class="${p.rest ? 'r' : ''}"></i>`).join('')}</span></summary>
    <ul class="pd-list">${w.map((p) => {
      const ss = sessionsOn(p.date);
      const logged = ss.some((x) => !x.rest) ? 'trained' : ss.length ? 'rested' : '';
      return `<li><button class="pd-row ${p.date === today ? 'today' : ''} ${p.date < today ? 'past' : ''}" data-act="plan-open" data-v="${p.date}" style="--day:${plate(p.day.color)}">
        <span class="date-chip"><b>${parseYmd(p.date).getDate()}</b><span>${parseYmd(p.date).toLocaleDateString(undefined, { weekday: 'short' })}</span></span>
        <span class="pip lg"></span>
        <span class="grow"><b>${esc(p.day.name)}</b><span class="muted small">Day ${p.n} · ${fmtInt(p.targets.kcal)} kcal${p.tags.length ? ' · ' + p.tags.map(esc).join(', ') : ''}</span></span>
        ${logged ? `<span class="done-dot" title="${logged}">${checkSvg}</span>` : p.date === today ? '<span class="tag">Today</span>' : ''}
      </button></li>`;
    }).join('')}</ul>
  </details>`).join('')}`;
}

function planDaySheet(date) {
  const p = planFor(J(), date);
  const list = planWorkout(p);
  const { meals, total } = mealsFor(p, date);
  const ss = sessionsOn(date);
  const tot = dayTotals(dayData(date), S.settings.supps);
  const isPast = date < ymd();
  return `<div style="--day:${plate(p.day.color)}" class="pds">
    <p class="muted">${longDate(date)} · day ${p.n} of ${p.total}</p>
    <h2 class="display sheet-title">${esc(p.day.name)}</h2>
    <p class="muted small">${esc(p.phase.name)}: ${esc(p.phase.effort)}</p>
    ${p.tags.length ? `<div class="tag-row">${p.tags.map((t) => `<span class="tag t-${slug(t)}">${esc(t)}</span>`).join('')}</div>` : ''}
    ${p.tags.includes('Check-in') || p.tags.includes('First look') ? '<p class="banner z-green small"><b>Check-in day.</b> The app compares your last two weekly weight averages and your lifts, then suggests whether to change calories.</p>' : ''}
    ${ss.length ? `<div class="pds-logged"><b>Logged:</b> ${ss.map((x) => esc(x.dayName)).join(', ')}${(dayData(date).food || []).length ? ` · ${fmtInt(tot.kcal)} kcal, ${Math.round(tot.p)} g protein eaten` : ''}</div>` : isPast ? '<p class="muted small">Nothing logged on this day.</p>' : ''}

    <h3 class="pds-h">Workout</h3>
    ${p.workout ? `<ol class="pw-list">${list.map((e) => `<li><span class="grow"><b>${esc(e.name)}</b>${e.note ? `<span class="muted small">${esc(e.note)}</span>` : ''}</span><span class="num pw-sr"><b>${e.sets} × ${esc(e.reps)}</b></span></li>`).join('')}</ol>
      <p class="muted small">Warm-up first: posture routine 20 min${p.walkWarmup ? ' + incline walk 20 min (incline 4, speed 3)' : '. Incline walk is off while your foot heals'}. Rest 90 s between sets, 2 min on the big lifts.</p>`
      : `<p class="small">${p.birthday ? 'Weigh-in morning: after the bathroom, before food or water. Photos front, side and back.' : 'Rest: no lifting. Easy steps, posture routine, sleep.'}</p>`}

    <h3 class="pds-h">Food · ${fmtInt(total.kcal)} kcal · ${Math.round(total.p)} g protein</h3>
    ${p.flex ? `<p class="small">Flex day: the plan below plus a ${FLEX_TREAT} kcal holiday meal.</p>` : ''}
    <ol class="timeline">${meals.map((m) => mealBlock(m, date, false, false)).join('')}</ol>

    <h3 class="pds-h">Also today</h3>
    <ul class="plain-list">
      <li><span>Steps</span><span>${esc(p.steps)}</span></li>
      <li><span>Water</span><span>${isOz() ? `${fmtWater(3500)} (3.5 L)` : '3–4 L'}</span></li>
      <li><span>Posture (APT) routine</span><span>20 min</span></li>
      <li><span>Sleep</span><span>7–9 hours</span></li>
      <li><span>Weigh-in</span><span>Morning, after the bathroom</span></li>
      ${parseYmd(date).getDay() === 1 ? '<li><span>Waist</span><span>Measure at the belly button</span></li>' : ''}
      ${p.n % 14 === 0 ? '<li><span>Progress photos</span><span>Front, side, back</span></li>' : ''}
    </ul>
    ${date <= ymd() ? `<button class="btn primary" data-act="plan-goto" data-v="${date}">${date === ymd() ? 'Go to today' : 'Open this day to log it'}</button>` : ''}
  </div>`;
}

function drawJourneyChart() {
  const el = document.getElementById('ch-journey');
  if (!el) return;
  const j = J();
  const toU = (kg) => (bu() === 'kg' ? kg : Math.round(kg * 22.0462) / 10);
  const pts = weightsKg().filter((w) => w.date <= j.end);
  const draw = () => {
    const w = el.clientWidth;
    if (!w) return;
    const h = 210, pad = { l: 36, r: 12, t: 12, b: 24 };
    const x0 = j.start, span = daysBetween(x0, j.end);
    const X = (d) => pad.l + ((w - pad.l - pad.r) * daysBetween(x0, d)) / span;
    const ys = [j.startKg, j.goalKg, ...pts.map((p) => p.kg)];
    const lo = Math.floor(Math.min(...ys) - 1), hi = Math.ceil(Math.max(...ys) + 1);
    const Y = (kg) => pad.t + ((h - pad.t - pad.b) * (hi - kg)) / (hi - lo);
    const step = hi - lo > 12 ? 4 : 2;
    let g = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="Weight against target">`;
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) g += `<line class="grid" x1="${pad.l}" x2="${w - pad.r}" y1="${Y(v)}" y2="${Y(v)}"/><text class="tick" x="${pad.l - 6}" y="${Y(v) + 4}" text-anchor="end">${fmtNum(toU(v))}</text>`;
    const labels = [j.start, '2027-01-01', '2027-02-01', j.end].filter((d, i, a) => i === 0 || i === a.length - 1 || (X(d) - X(a[0]) > 48 && X(a[a.length - 1]) - X(d) > 48));
    for (const d of labels) g += `<text class="tick" x="${X(d)}" y="${h - 6}" text-anchor="${d === j.start ? 'start' : d === j.end ? 'end' : 'middle'}">${mdDate(d)}</text>`;
    g += `<line class="goal" x1="${X(j.start)}" y1="${Y(j.startKg)}" x2="${X(j.end)}" y2="${Y(j.goalKg)}"/>`;
    g += `<circle cx="${X(j.end)}" cy="${Y(j.goalKg)}" r="5" fill="none" stroke="var(--ink-2)" stroke-width="1.5"/>`;
    const today = ymd();
    if (today >= j.start && today <= j.end) g += `<line class="cross" x1="${X(today)}" x2="${X(today)}" y1="${pad.t}" y2="${h - pad.b}" stroke-dasharray="2 3"/>`;
    const avgLine = pts.map((p) => ({ d: p.date, v: avgKgAround(p.date) })).filter((p) => p.v != null);
    if (avgLine.length > 1) g += `<path d="${avgLine.map((p, i) => `${i ? 'L' : 'M'}${X(p.d).toFixed(1)},${Y(p.v).toFixed(1)}`).join('')}" fill="none" stroke="${PLATE.blue}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`;
    for (const p of pts) g += `<circle cx="${X(p.date)}" cy="${Y(p.kg)}" r="3" fill="${PLATE.blue}" opacity=".55"><title>${mdDate(p.date)}: ${showKg(p.kg)} (target ${showKg(targetKg(j, p.date < j.start ? j.start : p.date))})</title></circle>`;
    g += '</svg>';
    el.innerHTML = g + (pts.length ? '' : '<p class="chart-empty overlay">Weigh in tomorrow morning to start your line.</p>');
  };
  el.classList.add('chart');
  draw();
  if (el._ro) el._ro.disconnect();
  let lastW = el.clientWidth;
  el._ro = new ResizeObserver(() => { if (el.clientWidth !== lastW) { lastW = el.clientWidth; draw(); } });
  el._ro.observe(el);
}

function shopView() {
  const j = J();
  const start = S.shopWeek ? addDays(ymd() < j.start ? j.start : ymd(), 7) : ymd() < j.start ? j.start : ymd();
  const dates = Array.from({ length: 7 }, (_, i) => addDays(start, i)).filter((d) => inJourney(j, d));
  if (!dates.length) return '<div class="empty"><p>The plan has finished. Happy birthday.</p></div>';
  const plans = dates.map((d) => planFor(j, d));
  const swaps = Object.fromEntries(dates.map((d) => [d, dayData(d).mealSwaps || {}]));
  const list = groceries(plans, j.trainTime, swaps);
  const got = shopGot();
  const cats = [...new Set(list.map((x) => x.cat))];
  const catName = (c) => (c === 'protein' ? 'Protein' : FOOD_CATS.find((x) => x.id === c)?.name || 'Other');
  const key = (id) => `${start}:${id}`;
  return `
  <div class="seg">${[['0', 'Next 7 days'], ['1', 'The 7 after']].map(([k, l]) => `<button class="${String(S.shopWeek) === k ? 'on' : ''}" data-act="shop-week" data-v="${k}">${l}</button>`).join('')}</div>
  <p class="muted small pad-x">${mdDate(dates[0])} – ${mdDate(dates[dates.length - 1])}: everything in the meal plan for these days. Meat and fish are shown raw, rice, quinoa and millet dry. Swapped meals are included.</p>
  ${cats.map((c) => `<section class="card"><div class="card-head"><h2>${esc(catName(c))}</h2></div>
    <ul class="shop">${list.filter((x) => x.cat === c).map((x) => `<li><button class="check-item ${got[key(x.id)] ? 'on' : ''}" data-act="shop-check" data-v="${esc(key(x.id))}" aria-pressed="${!!got[key(x.id)]}">
      <span class="check sm ${got[key(x.id)] ? 'on' : ''}">${checkSvg}</span><span class="grow">${esc(x.name.replace(/, (cooked|grilled)$/, '').replace(' (dry)', ''))}</span><b class="num">${esc(x.buy)}</b></button></li>`).join('')}</ul></section>`).join('')}
  <p class="muted small pad-x">Meal prep tip: grill the week’s chicken and cook a big pot of rice or millet on Sunday. Boil 6–8 eggs at a time.</p>`;
}
function shopGot() { try { return JSON.parse(localStorage.getItem('gymlog-shop') || '{}'); } catch { return {}; } }
function shopToggle(k) { const g = shopGot(); if (g[k]) delete g[k]; else g[k] = 1; try { localStorage.setItem('gymlog-shop', JSON.stringify(g)); } catch {} }

function guideView() {
  const j = J();
  const tr = KCAL.train + (j.calAdj || 0), rs = KCAL.rest + (j.calAdj || 0);
  const avgK = Math.round((tr * 5 + rs) / 6);
  const sec = (id, title, body, open = false) => `<details class="card guide" ${open || S.openDay === 'g-' + id ? 'open' : ''} data-day-id="g-${id}"><summary><b class="grow">${title}</b><span class="chev">${icon('right', 18)}</span></summary><div class="guide-body">${body}</div></details>`;
  return `
  ${sec('goal', 'The goal and the math', `
    <p>See <b>${showKg(j.goalKg)}</b> on the scale on <b>${mdDate(j.end)}</b>, starting from ${showKg(j.startKg)} on ${mdDate(j.start)}, while keeping and rebuilding muscle.</p>
    <ul class="plain-list">
      <li><span>Days</span><b>${totalDays(j)} (about 14 weeks)</b></li>
      <li><span>To lose on the scale</span><b>${showKgDelta(j.startKg - j.goalKg)}</b></li>
      <li><span>Of that, water and stored carbs</span><b>1–1.5 kg</b></li>
      <li><span>Fat to lose</span><b>about 8.5–9.5 kg</b></li>
      <li><span>Energy in 1 kg of body fat</span><b>about 7,700 kcal</b></li>
      <li><span>Deficit needed</span><b>about 650–750 kcal a day</b></li>
      <li><span>Pace</span><b>0.6–0.8 kg a week</b></li>
    </ul>
    <p class="muted small">Muscle you regain after your 5-month break adds weight, so the fat you need to lose is at the upper end. Muscle comes back fast because your fibres keep the extra nuclei they built before.</p>`, true)}

  ${sec('numbers', 'Your daily numbers', `
    <ul class="plain-list">
      <li><span>Resting burn (Mifflin-St Jeor)</span><b>about 1,740 kcal</b></li>
      <li><span>Maintenance with 5 lifting days and 10–12k steps</span><b>about ${fmtInt(j.maintenance)} kcal</b></li>
      <li><span>Training days</span><b>${fmtInt(tr)} kcal</b></li>
      <li><span>Rest days</span><b>${fmtInt(rs)} kcal</b></li>
      <li><span>Average</span><b>about ${fmtInt(avgK)} kcal, a ${fmtInt(j.maintenance - avgK)} kcal deficit</b></li>
      <li><span>Protein, every day</span><b>${PROTEIN} g (never under 150)</b></li>
      <li><span>Fat</span><b>about ${FAT} g</b></li>
      <li><span>Carbs</span><b>the rest: ~210 g training, ~120 g rest</b></li>
      <li><span>Fiber</span><b>30–40 g</b></li>
      <li><span>Water</span><b>3–4 L</b></li>
      <li><span>Steps</span><b>10,000–12,000 (pain-free only while your foot heals)</b></li>
    </ul>
    <p class="muted small">Your steps are already counted in maintenance, so the deficit comes from food. Only carbs change between training and rest days. Protein and fat stay the same.</p>`)}

  ${sec('phases', 'The four phases', `
    <ol class="phase-list">
      <li><b>Ease back in</b> · ${mdDate(j.start)} – ${mdDate(addDays(j.start, 13))}<span>70–80% of your old weights, one set fewer, stop 3 reps short. Leg days are swapped for seated upper-body work while your foot heals.</span></li>
      <li><b>Build</b> · ${mdDate(addDays(j.start, 14))} – ${mdDate(addDays(j.start, 55))}<span>Full sets, 1–2 reps in reserve, beat last time by a rep or a weight jump. Legs return; the first week back is lighter.</span></li>
      <li><b>Deload</b> · ${mdDate(addDays(j.start, 56))} – ${mdDate(addDays(j.start, 62))}<span>Same weights, about 40% fewer sets. Calories stay the same. This is what makes the last 5 weeks productive.</span></li>
      <li><b>Final push</b> · ${mdDate(addDays(j.start, 63))} – ${mdDate(j.end)}<span>Full sets, last set of each exercise to 0–1 reps in reserve. Holding strength while the scale drops means you’re losing fat.</span></li>
    </ol>
    <p class="muted small">The split runs Push, Pull, Quads, Rest, Upper, Hamstrings, then repeats. Each muscle gets hit about twice a week. If you miss a day, use the link on Today to do it the next day; the plan moves back with you.</p>`)}

  ${sec('foot', 'Training around your foot', `
    <p>Until <b>${mdDate(j.legsFrom)}</b>:</p>
    <ul class="bullets">
      <li>Quads day becomes <b>Arms + Core</b>; Hamstrings day becomes <b>Shoulders + Back</b>. All seated or supported.</li>
      <li>Push, Pull and Upper days stay, but do pressing seated or on a bench and skip anything standing heavy.</li>
      <li>The incline walk warm-up is off. Walk only as far as it stays pain-free. If walking hurts, a seated bike or arm bike is an option if your foot allows it.</li>
      <li>Calories stay the same. Losing a little slower for two weeks is fine.</li>
    </ul>
    <p>When your foot feels normal, tap <b>My foot is ready now</b> in Plan settings. If it’s still sore on ${mdDate(j.legsFrom)}, tap <b>Push back 1 week</b>. The first two leg sessions back are lighter. If pain lasts beyond two weeks, get it looked at.</p>`)}

  ${sec('food', 'How to eat', `
    <ul class="bullets">
      <li>Four meals, each with 35–55 g of protein. The plan rotates 4 options per meal so you don’t repeat the same day.</li>
      <li>${j.trainTime === 'morning' ? 'Training in the morning: a banana and black coffee before, breakfast straight after.' : 'Training in the evening: a pre-workout snack about 90 minutes before, dinner after.'} Most of the day’s carbs sit around training.</li>
      <li>Weigh carbs and protein cooked, at least for the first two weeks, until you can eyeball portions.</li>
      <li>Swap any meal for another option on Today; the app re-balances the portions so the day still adds up.</li>
      <li>Paneer is calorie-dense (about 265 kcal per 100 g). It’s in measured amounts. If you can find low-fat paneer, use it.</li>
      <li>Vegetables are close to free. Add more any time you’re hungry.</li>
    </ul>`)}

  ${sec('hacks', 'Ways to get a bigger deficit', `
    <p>Add deficit in this order. Steps first, because they don’t make you hungrier. Never cut protein.</p>
    <ol class="hack-list">
      <li><b>Walk after meals.</b> 10 minutes after each meal is about 3,000 steps, roughly 100 kcal. Each extra 1,000 steps burns about 35 kcal for you.</li>
      <li><b>Push steps to 13–14k</b> on rest days: about +100 kcal.</li>
      <li><b>Cut 25 g of carbs</b> (about ⅔ cup cooked rice): −100 kcal. Or go half rice, half cauliflower rice.</li>
      <li><b>Measure oil.</b> One tablespoon is 120 kcal. Use spray oil and a non-stick pan.</li>
      <li><b>Swap sauces and dressings</b> for lemon, chilli, mustard, salsa, vinegar, herbs: easily −100 to −200 kcal.</li>
      <li><b>No liquid calories.</b> Black coffee, green tea, water, diet soda. Alcohol is the biggest hidden cost: a beer is about 150 kcal, a cocktail 200–300.</li>
      <li><b>Paneer to egg whites or chicken</b>: about −150 kcal per 100 g of paneer swapped.</li>
      <li><b>Eat vegetables and protein first</b> at each meal. You’ll be fuller before the carbs.</li>
      <li><b>Close the kitchen</b> 2–3 hours before bed. Brush your teeth after dinner.</li>
      <li><b>Sleep 7–9 hours.</b> One short night tends to raise how much you eat the next day by a few hundred calories.</li>
      <li><b>Move more in the day</b>: stairs, standing desk, pacing on calls.</li>
      <li><b>Eating out</b>: grilled protein, vegetables, sauce on the side, skip the bread basket.</li>
    </ol>
    <p><b>Don’t</b> go under about 1,600 kcal, drop protein below 150 g, add long cardio sessions on top of lifting, or try water or salt tricks before the weigh-in. Each of those costs muscle or just moves water around.</p>`)}

  ${sec('checkins', 'Check-ins and how to adjust', `
    <p>Weigh in every morning after the bathroom, before food or water. Only the weekly average counts. Measure your waist every Monday.</p>
    <ul class="plain-list">
      <li><span>Day 14 (${mdDate(addDays(j.start, 13))})</span><b>First look, no changes</b></li>
      ${CHECKIN_DAYS.filter((c) => c > 14).map((c) => `<li><span>Day ${c} (${mdDate(addDays(j.start, c - 1))})</span><b>Check-in</b></li>`).join('')}
    </ul>
    <ul class="bullets">
      <li>Losing <b>under 0.5 kg a week</b>: eat 100 kcal less (carbs), or add 2,000–3,000 steps.</li>
      <li>Losing <b>over 1 kg a week and lifts dropping</b>: eat 150 kcal more, from carbs.</li>
      <li><b>Lifts dropping</b> on 3+ exercises: add 100 kcal of carbs and look at your sleep.</li>
      <li>Scale and waist down, lifts holding: <b>change nothing</b>.</li>
    </ul>
    <p class="muted small">In the first 2–3 weeks the scale may barely move. Muscles you start training again store extra carbs and water, which hides fat loss. Judge by your waist and keep going.</p>`)}

  ${sec('water', 'Water, salt and creatine', `
    <ul class="bullets">
      <li>Drink 3–4 L a day. Being well hydrated makes your body hold less water.</li>
      <li>Keep salt <b>steady</b>, not very low. Big swings day to day are what cause bloat.</li>
      <li>Vegetables, fruit and avocado give you potassium, which also helps.</li>
      <li><b>Creatine</b> adds 1–2 kg of water inside your muscles. It helps strength but shows on the scale. Either start it now so it’s settled long before the end, or leave it until after ${mdDate(j.end)}.</li>
    </ul>`)}

  ${sec('holidays', 'Holidays and the last week', `
    <ul class="bullets">
      <li><b>Dec 25 and Dec 31 are flex days</b> at maintenance (about ${fmtInt(j.maintenance)} kcal): eat the plan, then enjoy a holiday meal. Two days costs about 0.15 kg of progress.</li>
      <li>Avoid turning flex days into a flex week. Go back to the plan the next morning, and expect the scale to jump 0.5–1 kg from water. It drops again within 3–4 days.</li>
      <li><b>Last week</b> (from ${mdDate(addDays(j.end, -6))}): nothing new. Same food, same salt, same water. Train as normal until 2 days before.</li>
      <li><b>${mdDate(j.end)}</b>: weigh in first thing, then take photos in the same spot and light as day 1.</li>
    </ul>`)}`;
}

// ---------------------------------------------------------------- sheets
function sheetView() {
  const sh = S.sheet;
  let inner = '';
  if (sh.type === 'food') inner = foodSheet();
  else if (sh.type === 'planday') inner = planDaySheet(sh.date);
  else if (sh.type === 'exercise') inner = exerciseSheet();
  else if (sh.type === 'session') {
    const s = S.sessions.find((x) => x.id === sh.id);
    if (!s) { S.sheet = null; return ''; }
    const u = unit();
    const st = sessionStats(s, u);
    inner = `<div style="--day:${plate(s.color)}">
      <p class="muted">${longDate(s.date)}</p>
      <h2 class="display sheet-title">${esc(s.dayName)}</h2>
      ${s.rest ? '<p>Rest day.</p>' : `<div class="stats compact"><div class="stat"><b>${st.sets}</b><span>sets</span></div><div class="stat"><b>${fmtInt(st.volume)}</b><span>${u} moved</span></div><div class="stat"><b>${st.minutes ?? '–'}</b><span>minutes</span></div></div>
      ${(s.warmup || []).length ? `<p class="muted small">Warm-up: ${s.warmup.map((w) => `${esc(w.name)} ${w.done ? `${w.min} min${w.incline != null ? `, incline ${w.incline}, speed ${w.speed}` : ''}` : 'skipped'}`).join('; ')}</p>` : ''}
      <ul class="plain-list">${s.exercises.map((e) => { const ds = doneSets(e); return `<li><span>${esc(e.name)}</span><span class="num ${ds.length ? '' : 'muted'}">${ds.length ? ds.map((x) => `${fmtW(convert(Number(x.w), s.unit, u))}×${x.r}${x.pr ? ' PR' : ''}`).join(', ') : 'skipped'}</span></li>`; }).join('')}</ul>`}
      <div class="stack gap-s">
        ${s.rest ? '' : `<button class="btn primary" data-act="edit-session" data-id="${s.id}">Edit this workout</button>`}
        <button class="btn ghost danger" data-act="delete-session" data-id="${s.id}">Delete</button>
      </div></div>`;
  } else if (sh.type === 'summary') {
    const s = S.sessions.find((x) => x.id === sh.id) || sh.session;
    const u = unit();
    const st = sessionStats(s, u);
    const prs = [];
    for (const e of s.exercises) for (const x of e.sets) if (x.pr) prs.push(`${esc(e.name)} ${fmtW(x.w)} × ${x.r}`);
    inner = `<div style="--day:${plate(s.color)}" class="summary">
      <div class="disc sm" aria-hidden="true"><div class="disc-hole"></div></div>
      <h2 class="display sheet-title">${esc(s.dayName)} done</h2>
      <div class="stats compact"><div class="stat"><b>${st.sets}</b><span>sets</span></div><div class="stat"><b>${fmtInt(st.volume)}</b><span>${u} moved</span></div><div class="stat"><b>${st.minutes ?? '–'}</b><span>minutes</span></div></div>
      ${prs.length ? `<p><b>New bests:</b> ${prs.join(', ')}</p>` : '<p class="muted">Logged. Next time, try one more rep on your first set.</p>'}
      <p class="muted small">Refuel: aim for 30–40 g of protein in the next couple of hours.</p>
      <button class="btn primary big" data-act="sheet-close">Done</button></div>`;
  } else if (sh.type === 'confirm') {
    inner = `<h2 class="sheet-title">${esc(sh.title)}</h2><p class="muted">${esc(sh.body)}</p>
      <div class="stack gap-s"><button class="btn primary ${sh.danger ? 'danger-fill' : ''}" data-act="confirm-ok">${esc(sh.ok)}</button><button class="btn ghost" data-act="sheet-close">Cancel</button></div>`;
  }
  return `<div class="sheet-wrap" data-act="sheet-backdrop"><div class="sheet ${(sh.type === 'food' && !sh.pick && !sh.custom) || sh.type === 'exercise' || sh.type === 'planday' ? 'tall' : ''}" role="dialog" aria-modal="true" data-keep="sheet"><div class="grabber"></div>${inner}</div></div>`;
}

// Add an exercise to the plan (Train) or to the running workout.
function exerciseSheet() {
  const sh = S.sheet;
  const inList = new Set(sh.target === 'draft' ? S.draft.exercises.map((e) => e.id) : S.plan.list);
  const muscles = sh.muscle ? [sh.muscle] : MUSCLES.map((m) => m.id);
  return `<div>
    <h2 class="sheet-title">Add exercise</h2>
    <div class="cat-scroll">${[['', 'All'], ...MUSCLES.map((m) => [m.id, m.name])].map(([k, l]) => `<button class="cchip ${(sh.muscle || '') === k ? 'on' : ''}" data-act="exs-muscle" data-v="${k}">${l}</button>`).join('')}</div>
    <div class="food-scroll" data-keep="exlist">${muscles.map((m) => {
      const opts = optionsFor(m).filter((o) => !inList.has(o.id));
      if (!opts.length) return '';
      return `<p class="pick-group">${muscleById[m].name}</p><ul class="pick-list">${opts.map((o) => `<li><button class="pick-row" data-act="exs-pick" data-id="${o.id}">
        <span class="fdot" style="background:${plate(muscleById[m].color)}"></span><span class="grow"><b>${esc(o.name)}</b><span class="muted small">${o.mine ? 'In your split' : esc(o.equip || '')}</span></span>${icon('plus', 20)}</button></li>`).join('')}</ul>`;
    }).join('')}</div>
  </div>`;
}

function confirmSheet(title, body, ok, onOk, danger = true) {
  S.sheet = { type: 'confirm', title, body, ok, onOk, danger };
  render();
}

// ---------------------------------------------------------------- after render (charts, timers)
let tick = null;
function afterRender() {
  clearInterval(tick);
  if (S.draft && S.draft.status === 'active') tick = setInterval(updateTimers, 1000);
  if (!S.draft && S.tab === 'trends') drawCharts();
  if (!S.draft && S.tab === 'plan' && S.planTab === 'days') drawJourneyChart();
}

function updateTimers() {
  const el = document.getElementById('elapsed');
  if (el && S.draft) el.textContent = elapsed(S.draft);
  if (S.rest) {
    const left = Math.ceil((S.rest.endsAt - Date.now()) / 1000);
    if (left <= 0) { S.rest = null; restDone(); document.getElementById('restbar')?.remove(); return; }
    const t = document.getElementById('rest-left');
    if (t) t.textContent = mmss(left);
    const f = document.querySelector('.rest-fill');
    if (f) f.style.width = `${100 * (1 - left / S.rest.total)}%`;
  }
}

let actx = null;
function restDone() {
  navigator.vibrate?.([180, 90, 180]);
  try {
    actx ||= new (window.AudioContext || window.webkitAudioContext)();
    const t = actx.currentTime;
    [0, 0.18].forEach((d) => {
      const o = actx.createOscillator(), g = actx.createGain();
      o.frequency.value = 880; o.connect(g); g.connect(actx.destination);
      g.gain.setValueAtTime(0.0001, t + d); g.gain.exponentialRampToValueAtTime(0.25, t + d + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.14);
      o.start(t + d); o.stop(t + d + 0.15);
    });
  } catch {}
  toast('Rest is up. Next set.');
}

function series(days, f) { return days.map((d) => ({ date: d, y: f(d) })); }
function rolling(all, n) {
  return all.slice(n - 1).map((_, i) => { const win = all.slice(i, i + n).filter((b) => b.y); return win.length >= 3 ? avg(win.map((b) => b.y)) : null; });
}

function drawCharts() {
  const u = unit();
  const m = S.trend.mode;
  const N = S.trend.days;
  const days = lastNDays(N);
  const el = (id) => document.getElementById(id);
  const tipD = (b, txt) => `<b>${txt}</b><span>${parseYmd(b.date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</span>`;
  if (m === 'overview' && el('ch-score')) {
    const pts = series(days, (d) => (S.daily[d] || sessionsOn(d).length ? dayScore(d).pct || null : null));
    barChart(el('ch-score'), pts, { color: C.score, goal: 80, empty: 'Log a day to start this chart.', tip: (b) => tipD(b, b.y ? `${b.y} / 100` : 'Nothing logged') });
  } else if (m === 'strength') {
    const thisWeek = weekStart(ymd());
    const weeks = Array.from({ length: 12 }, (_, i) => addDays(thisWeek, -7 * (11 - i)));
    const vol = Object.fromEntries(weeks.map((w) => [w, 0]));
    for (const s of S.sessions) if (s.status === 'done' && !s.rest) { const k = weekStart(s.date); if (k in vol) vol[k] += sessionStats(s, u).volume; }
    if (el('ch-weekly')) barChart(el('ch-weekly'), weeks.map((w) => ({ date: w, y: vol[w] })), {
      color: PLATE.yellow, empty: 'Finish a workout to start this chart.', tip: (b) => `<b>${fmtInt(b.y)} ${u}</b><span>Week of ${mdDate(b.date)}</span>`,
    });
    const cur = allExercises().find((e) => e.id === S.trend.exId);
    const hist = rangeFilter(exerciseHistory(S.sessions, S.trend.exId, u), S.trend.range);
    const metric = S.trend.metric;
    const pts = hist.map((p) => ({ ...p, y: metric === 'e1rm' ? p.e1rm : metric === 'top' ? p.top.w : metric === 'reps' ? p.maxReps : p.volume }));
    if (el('ch-lift')) lineChart(el('ch-lift'), pts, {
      color: plate(cur?.day?.color), empty: 'Log this exercise to start its chart.',
      tip: (p) => `<b>${fmtNum(p.y)}${metric === 'reps' ? ' reps' : ' ' + u}</b><span>${mdDate(p.date)}: ${p.sets.map((s) => `${fmtW(s.w)}×${s.r}`).join(', ')}</span>`,
    });
  } else if (m === 'nutrition') {
    const t = targets();
    const tot = (d) => ((dayData(d).food || []).length ? dayTotals(dayData(d), S.settings.supps) : null);
    if (el('ch-kcal')) barChart(el('ch-kcal'), series(days, (d) => tot(d)?.kcal || null), { color: C.kcal, goal: t.kcal, empty: 'Log food to start this chart.', tip: (b) => tipD(b, b.y ? `${fmtInt(b.y)} kcal` : 'Not logged') });
    if (el('ch-protein')) barChart(el('ch-protein'), series(days, (d) => tot(d)?.p || null), { color: C.p, goal: t.p, empty: 'Log food to start this chart.', tip: (b) => tipD(b, b.y ? `${r1(b.y)} g protein` : 'Not logged') });
    const toU = (ml) => (isOz() ? Math.round(ml / ML_PER_OZ) : ml);
    if (el('ch-water')) barChart(el('ch-water'), series(days, (d) => (dayData(d).water ? toU(dayData(d).water) : null)), { color: C.water, goal: toU(waterGoalMl()), empty: 'Log water to start this chart.', tip: (b) => tipD(b, b.y ? `${fmtInt(b.y)} ${isOz() ? 'oz' : 'ml'}` : 'Not logged') });
  } else if (m === 'body') {
    const all = series(lastNDays(N + 6), (d) => dayData(d).steps || null);
    if (el('ch-steps')) barChart(el('ch-steps'), all.slice(6), { color: C.steps, goal: S.settings.stepGoal, avgLine: rolling(all, 7), empty: 'Log your steps on Today to start this chart.', tip: (b) => tipD(b, b.y ? `${fmtInt(b.y)} steps` : 'Not logged') });
    const pts = rangeFilter(Object.entries(S.daily).filter(([, v]) => v.bw).map(([d, v]) => ({ date: d, y: bwOf(v) })).sort((a, b) => (a.date < b.date ? -1 : 1)), S.trend.bodyRange);
    if (el('ch-body')) lineChart(el('ch-body'), pts, { color: PLATE.blue, empty: 'Log your body weight to start this chart.', tip: (p) => `<b>${fmtNum(p.y)} ${bu()}</b><span>${mdDate(p.date)}</span>` });
    const rec = days.filter((d) => dayData(d).whoop?.rec).map((d) => ({ date: d, y: Number(dayData(d).whoop.rec), w: dayData(d).whoop }));
    if (el('ch-rec')) lineChart(el('ch-rec'), rec, { color: C.rec, empty: 'Enter WHOOP numbers on Today to start this chart.', tip: (p) => `<b>${p.y}% recovery</b><span>${mdDate(p.date)}${p.w.strain ? ` · strain ${p.w.strain}` : ''}${p.w.hrv ? ` · HRV ${p.w.hrv}` : ''}</span>` });
  }
}

// ---------------------------------------------------------------- toast
function toast(msg) {
  let t = document.getElementById('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove('show'), 3200);
}

// ---------------------------------------------------------------- persistence helpers
let saveH = null;
function persistDraft(now = false) {
  if (!S.draft) return;
  clearTimeout(saveH);
  const go = () => { if (S.draft) S.db.saveSession(S.user.uid, S.draft).catch(fail); };
  if (now) go(); else saveH = setTimeout(go, 500);
}
let setH = null;
function saveSettings(now = true) {
  clearTimeout(setH);
  const go = () => S.db.saveSettings(S.user.uid, S.settings).catch(fail);
  if (now) go(); else setH = setTimeout(go, 600);
}
function saveDaily(date, patch) {
  const cur = { ...(S.daily[date] || {}), ...patch, unit: unit() };
  for (const k of Object.keys(cur)) if (cur[k] === '' || cur[k] == null) delete cur[k];
  S.daily = { ...S.daily, [date]: cur };
  S.db.saveDaily(S.user.uid, date, cur).catch(fail);
}

function startSession(day, opts) {
  const r = routine();
  const active = S.sessions.find((s) => s.status === 'active');
  const go = () => {
    if (active) S.db.deleteSession(S.user.uid, active.id).catch(fail);
    const s = newSession(day, r, S.sessions, unit(), opts);
    S.db.saveSession(S.user.uid, s).catch(fail);
    S.sessions = [...S.sessions.filter((x) => x.id !== active?.id), s];
    S.sheet = null;
    if (day.rest) { S.plan = null; toast('Rest day logged. Next up: ' + nextDay(r, S.sessions).name); render(); return; }
    S.draft = structuredClone(s);
    S.rest = null;
    render();
    window.scrollTo(0, 0);
  };
  if (active) confirmSheet(`Discard your unfinished ${active.dayName}?`, `Starting ${day.name} throws away the sets you logged in that workout.`, `Discard and start`, go);
  else go();
}

function toggleMuscle(m) {
  const p = S.plan;
  if (p.muscles.includes(m)) {
    p.muscles = p.muscles.filter((x) => x !== m);
    p.list = p.list.filter((id) => exInfo(id).muscle !== m);
  } else {
    p.muscles.push(m);
    for (const id of defaultPicks(m)) if (!p.list.includes(id)) p.list.push(id);
  }
  p.dayId = presetMatch(p.muscles);
  navigator.vibrate?.(8);
  render();
}

function foodEntryFromSheet() {
  const sh = S.sheet;
  const f = foodById(sh.pick.foodId, S.settings.customFoods);
  const qty = Number(sh.pick.qty) || 0;
  const m = macrosFor(f, sh.pick.unit, qty);
  return { id: sh.editId || uid(), foodId: f.id, name: f.name, unit: sh.pick.unit, qty, meal: sh.meal, at: Date.now(), ...m };
}
function refreshMacroPreview() {
  const box = document.getElementById('macro-preview');
  if (!box || !S.sheet?.pick) return;
  const f = foodById(S.sheet.pick.foodId, S.settings.customFoods);
  box.innerHTML = macroPreview(macrosFor(f, S.sheet.pick.unit, Number(S.sheet.pick.qty) || 0));
}

function scrollToId(id) { setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30); }

// ---------------------------------------------------------------- events
const ACT = {
  tab: (el) => { S.tab = el.dataset.v; S.sheet = null; render(); window.scrollTo(0, 0); },
  goto: (el) => {
    const v = el.dataset.v;
    if (v === 'train') { S.tab = 'train'; render(); window.scrollTo(0, 0); return; }
    if (v === 'fuel') { S.tab = 'fuel'; render(); window.scrollTo(0, 0); return; }
    scrollToId(`sec-${v}`);
  },
  'trend-go': (el) => { S.tab = 'trends'; S.trend.mode = el.dataset.v; render(); window.scrollTo(0, 0); },
  'date-step': (el) => { const d = addDays(S.date, Number(el.dataset.v)); if (d <= ymd()) { S.date = d; render(); } },
  'date-today': () => { S.date = ymd(); render(); },
  'pick-date': (el) => { if (el.dataset.v <= ymd()) { S.date = el.dataset.v; render(); window.scrollTo(0, 0); } },
  'auth-mode': () => { S.authMode = S.authMode === 'in' ? 'up' : 'in'; S.authMsg = ''; render(); },
  'auth-reset': async () => {
    const email = $app.querySelector('[name=email]').value.trim();
    if (!email) { S.authMsg = 'Type your email above, then tap Forgot password again.'; render(); return; }
    try { await S.db.resetPassword(email); S.authMsg = `Reset link sent to ${email}. Check your inbox and spam.`; } catch (e) { S.authMsg = AUTH_ERR[e.code] || e.message; }
    render();
  },
  resume: (el) => { const s = S.sessions.find((x) => x.id === el.dataset.id); if (s) { S.draft = structuredClone(s); render(); window.scrollTo(0, 0); } },
  'save-steps': () => {
    const v = num(document.getElementById('steps-in').value);
    const bw = num(document.getElementById('bw-in').value);
    const waist = num(document.getElementById('waist-in')?.value ?? '');
    saveDaily(S.date, { steps: v === '' ? null : Math.round(v), bw: bw === '' ? null : bw, bwUnit: bw === '' ? null : bu(), waist: waist === '' ? null : waist, waistUnit: waist === '' ? null : S.settings.waistUnit || 'in' });
    document.activeElement?.blur();
    toast('Saved');
    render();
  },

  // water / supps / core
  'water-add': (el) => {
    const d = dayData(S.date), v = Number(el.dataset.v);
    saveDaily(S.date, { water: (d.water || 0) + v, waterLog: [...(d.waterLog || []), v].slice(-40) });
    navigator.vibrate?.(10);
    const goal = waterGoalMl();
    if ((d.water || 0) < goal && (d.water || 0) + v >= goal) toast('Water goal reached');
    render();
  },
  'water-undo': () => {
    const d = dayData(S.date), log = [...(d.waterLog || [])];
    const v = log.pop() || 0;
    saveDaily(S.date, { water: Math.max(0, (d.water || 0) - v), waterLog: log });
    render();
  },
  'supp-toggle': (el) => {
    const d = dayData(S.date), cur = { ...(d.supps || {}) };
    if (Number(cur[el.dataset.id]) > 0) delete cur[el.dataset.id]; else cur[el.dataset.id] = 1;
    saveDaily(S.date, { supps: cur });
    navigator.vibrate?.(10);
    render();
  },
  'supp-qty': (el) => {
    const d = dayData(S.date), cur = { ...(d.supps || {}) };
    const n = (Number(cur[el.dataset.id]) || 0) + Number(el.dataset.d);
    if (n <= 0) delete cur[el.dataset.id]; else cur[el.dataset.id] = Math.min(6, n);
    saveDaily(S.date, { supps: cur }); render();
  },
  'core-toggle': (el) => {
    const d = dayData(S.date), core = structuredClone(d.core || {}), k = el.dataset.k;
    core[k] ||= {};
    if (core[k][el.dataset.id]) delete core[k][el.dataset.id]; else core[k][el.dataset.id] = true;
    S.openCore = k;
    saveDaily(S.date, { core });
    navigator.vibrate?.(10);
    render();
  },
  'core-all': (el) => {
    const d = dayData(S.date), core = structuredClone(d.core || {}), k = el.dataset.k;
    const list = S.settings[k] || [];
    const all = list.every((x) => core[k]?.[x.id]);
    core[k] = all ? {} : Object.fromEntries(list.map((x) => [x.id, true]));
    S.openCore = k;
    saveDaily(S.date, { core }); render();
  },

  // training plan
  'plan-day': (el) => { S.plan = el.dataset.day ? planFromDay(el.dataset.day) : { dayId: null, muscles: [], list: [], warm: true }; S.tab = 'train'; render(); window.scrollTo(0, 0); },
  preset: (el) => { S.plan = withPrescriptions(planFromDay(el.dataset.v), el.dataset.v); render(); },
  body: (el, ev) => { const m = ev.target.closest('[data-m]')?.dataset.m; if (m) toggleMuscle(m); },
  muscle: (el) => toggleMuscle(el.dataset.v),
  'plan-clear': () => { S.plan = { dayId: null, muscles: [], list: [], warm: S.plan.warm }; render(); },
  'plan-swap': (el) => {
    const i = Number(el.dataset.i), cur = exInfo(S.plan.list[i]);
    const opts = optionsFor(cur.muscle).filter((o) => o.id === cur.id || !S.plan.list.includes(o.id));
    if (opts.length < 2) { toast(`No other ${muscleById[cur.muscle]?.name.toLowerCase() || ''} exercises to swap in.`); return; }
    const j = opts.findIndex((o) => o.id === cur.id);
    S.plan.list[i] = opts[(j + 1) % opts.length].id;
    render();
  },
  'plan-del': (el) => { S.plan.list.splice(Number(el.dataset.i), 1); render(); },
  'plan-add': () => { S.sheet = { type: 'exercise', target: 'plan', muscle: S.plan.muscles[0] || '' }; render(); },
  'wk-add-ex': () => { S.sheet = { type: 'exercise', target: 'draft', muscle: S.draft.muscles?.[0] || '' }; render(); },
  'exs-muscle': (el) => { S.sheet.muscle = el.dataset.v; render(); },
  'exs-pick': (el) => {
    const info = exInfo(el.dataset.id);
    if (S.sheet.target === 'draft') {
      const last = lastSetsFor(S.sessions, info.id);
      const u = unit();
      const sets = last ? last.sets.map((st) => ({ w: convert(Number(st.w) || 0, last.session.unit || u, u), r: Number(st.r), done: false })) : [0, 1, 2].map(() => ({ w: '', r: 10, done: false }));
      S.draft.exercises.push({ id: info.id, name: info.name, group: info.group || '', muscle: info.muscle, sets });
      persistDraft();
    } else {
      S.plan.list.push(info.id);
      if (info.muscle && !S.plan.muscles.includes(info.muscle)) { S.plan.muscles.push(info.muscle); S.plan.dayId = presetMatch(S.plan.muscles); }
    }
    S.sheet = null; toast(`Added ${info.name}`); render();
  },
  'plan-start': () => {
    const p = S.plan;
    const day = planDay();
    startSession(day, { exercises: p.list.map(exInfo), muscles: p.muscles, warmup: p.warm, setCounts: p.sets, reps: p.reps, noWalk: p.noWalk, planDay: p.planDay });
  },
  'log-rest': () => startSession(routine().days.find((d) => d.rest) || { id: 'rest', name: 'Rest day', color: 'white', rest: true, exercises: [] }, { date: S.date }),

  // workout
  'wk-close': () => {
    if (S.draft.status === 'done') { S.draft = null; render(); return; }
    persistDraft(true);
    S.sessions = S.sessions.map((s) => (s.id === S.draft.id ? structuredClone(S.draft) : s));
    S.draft = null; render();
  },
  'wk-finish': () => {
    const w = S.draft;
    const anyDone = w.exercises.some((e) => doneSets(e).length) || w.warmup.some((x) => x.done);
    const finish = () => {
      w.status = 'done'; w.finishedAt = Date.now();
      persistDraft(true);
      S.sessions = S.sessions.map((s) => (s.id === w.id ? structuredClone(w) : s));
      S.sheet = { type: 'summary', id: w.id, session: structuredClone(w) };
      S.draft = null; S.rest = null; S.tab = 'today'; S.plan = null;
      render();
    };
    if (!anyDone) confirmSheet('Finish with nothing ticked?', 'Only sets you tick count. Untick sets are not saved to your progress.', 'Finish anyway', finish, false);
    else finish();
  },
  'wk-save': () => { persistDraft(true); S.sessions = S.sessions.map((s) => (s.id === S.draft.id ? structuredClone(S.draft) : s)); S.draft = null; toast('Changes saved'); render(); },
  'wk-discard': () => {
    const w = S.draft;
    confirmSheet(w.status === 'done' ? 'Delete this workout?' : 'Discard this workout?', 'Its sets are removed from your history and charts. This can’t be undone.', w.status === 'done' ? 'Delete' : 'Discard', () => {
      S.db.deleteSession(S.user.uid, w.id).catch(fail);
      S.sessions = S.sessions.filter((s) => s.id !== w.id);
      S.draft = null; S.sheet = null; S.rest = null; render();
    });
  },
  'warm-toggle': (el) => {
    const x = S.draft.warmup[el.dataset.i]; x.done = !x.done;
    // The APT warm-up and the daily posture checklist are the same thing.
    if (x.id === 'apt' && x.done) {
      const core = structuredClone(dayData(S.draft.date).core || {});
      core.apt = Object.fromEntries((S.settings.apt || []).map((a) => [a.id, true]));
      saveDaily(S.draft.date, { core });
    }
    persistDraft(); render();
  },
  step: (el) => {
    const e = S.draft.exercises[el.dataset.ex], s = e.sets[el.dataset.set], k = el.dataset.k, d = Number(el.dataset.d);
    if (k === 'w') {
      const inc = unit() === 'kg' ? 2.5 : 5;
      const base = s.w === '' ? Number(e.sets[el.dataset.set - 1]?.w || 0) : Number(s.w);
      s.w = Math.max(0, Math.round((base + d * inc) * 10) / 10);
    } else s.r = Math.max(0, (Number(s.r) || 0) + d);
    persistDraft(); render();
  },
  'set-done': (el) => {
    const w = S.draft, e = w.exercises[el.dataset.ex], si = Number(el.dataset.set), s = e.sets[si];
    if (!s.done && s.w === '' && si > 0 && e.sets[si - 1].w !== '') s.w = e.sets[si - 1].w;
    if (!s.done && !(Number(s.r) > 0)) { toast('Enter reps first.'); return; }
    s.done = !s.done;
    s.pr = false;
    if (s.done) {
      if (s.w === '') s.w = 0;
      const prev = bestE1rm(S.sessions, e.id, unit(), w.id);
      const inSession = Math.max(0, ...e.sets.filter((x, i) => i !== si && x.done).map((x) => e1rm(Number(x.w), Number(x.r))));
      const mine = e1rm(Number(s.w), Number(s.r));
      if (prev > 0 && mine > prev && mine > inSession) {
        e.sets.forEach((x) => { x.pr = false; });
        s.pr = true;
        toast(`New best on ${e.name}: ${fmtW(s.w)} × ${s.r}`);
      }
      if (S.settings.restSec && w.status === 'active') S.rest = { endsAt: Date.now() + S.settings.restSec * 1000, total: S.settings.restSec };
      try { actx ||= new (window.AudioContext || window.webkitAudioContext)(); actx.resume?.(); } catch {}
      navigator.vibrate?.(15);
    }
    persistDraft(); render();
  },
  'add-set': (el) => {
    const e = S.draft.exercises[el.dataset.ex];
    const last = e.sets[e.sets.length - 1] || { w: '', r: 10 };
    e.sets.push({ w: last.w, r: last.r, done: false });
    persistDraft(); render();
  },
  'del-set': (el) => { const e = S.draft.exercises[el.dataset.ex]; if (e.sets.length > 1) e.sets.pop(); persistDraft(); render(); },
  'rest-add': () => { if (S.rest) { S.rest.endsAt += 30000; S.rest.total += 30; } updateTimers(); },
  'rest-skip': () => { S.rest = null; document.getElementById('restbar')?.remove(); },

  // food
  'food-add': (el) => { S.sheet = { type: 'food', meal: el.dataset.meal || defaultMeal(), cat: recentFoods().length ? 'recent' : 'protein', q: '', pick: null }; render(); },
  'food-cat': (el) => { S.sheet.cat = el.dataset.v; S.sheet.q = ''; render(); },
  'food-pick': (el) => {
    const f = foodById(el.dataset.id, S.settings.customFoods);
    const unitOk = el.dataset.unit && f.units.some((x) => x.label === el.dataset.unit);
    S.sheet.pick = { foodId: f.id, unit: unitOk ? el.dataset.unit : f.units[0].label, qty: unitOk ? Number(el.dataset.qty) : f.units[0].qty };
    render();
  },
  'food-back': () => { S.sheet.pick = null; S.sheet.custom = false; render(); },
  'food-qty': (el) => {
    const p = S.sheet.pick, d = Number(el.dataset.d);
    const step = p.unit === 'g' ? 10 : p.unit === 'oz' ? 1 : 0.5;
    p.qty = Math.max(0, Math.round(((Number(p.qty) || 0) + d * step) * 10) / 10);
    const inp = document.getElementById('food-qty'); if (inp) inp.value = p.qty;
    refreshMacroPreview();
  },
  'food-meal': (el) => { S.sheet.meal = el.dataset.v; render(); },
  'food-fav': (el) => {
    const id = el.dataset.id, fav = new Set(S.settings.favFoods || []);
    if (fav.has(id)) fav.delete(id); else fav.add(id);
    S.settings.favFoods = [...fav]; saveSettings(); render();
  },
  'food-save': () => {
    const e = foodEntryFromSheet();
    if (!(e.qty > 0)) { toast('Enter an amount first.'); return; }
    const d = S.date, list = [...(dayData(d).food || [])];
    const i = list.findIndex((x) => x.id === e.id);
    if (i >= 0) list[i] = { ...list[i], ...e, at: list[i].at }; else list.push(e);
    saveDaily(d, { food: list });
    toast(`${i >= 0 ? 'Updated' : 'Added'} ${e.name}: ${e.kcal} kcal, ${e.p} g protein`);
    if (i >= 0) S.sheet = null; else S.sheet = { ...S.sheet, pick: null, q: '' };
    render();
  },
  'food-edit': (el) => {
    const f = (dayData(S.date).food || []).find((x) => x.id === el.dataset.id);
    if (!f || !foodById(f.foodId, S.settings.customFoods)) { toast('That food is no longer in the list.'); return; }
    S.sheet = { type: 'food', meal: f.meal || 'snack', editId: f.id, pick: { foodId: f.foodId, unit: f.unit, qty: f.qty } };
    render();
  },
  'food-del': () => {
    const id = S.sheet.editId;
    saveDaily(S.date, { food: (dayData(S.date).food || []).filter((x) => x.id !== id) });
    S.sheet = null; toast('Removed'); render();
  },
  'food-copy': () => {
    const prev = dayData(addDays(S.date, -1)).food || [];
    const go = () => {
      const now = Date.now();
      saveDaily(S.date, { food: [...(dayData(S.date).food || []), ...prev.map((f, i) => ({ ...f, id: uid(), at: now + i }))] });
      S.sheet = null; toast(`Copied ${prev.length} foods`); render();
    };
    if ((dayData(S.date).food || []).length) confirmSheet('Add the previous day’s food too?', 'What you’ve already logged stays. The previous day’s items are added on top.', 'Add them', go, false);
    else go();
  },
  'food-custom': () => { S.sheet.custom = true; render(); },
  'food-custom-save': () => {
    const v = (id) => document.getElementById(id).value.trim();
    const name = v('cf-name');
    if (!name) { toast('Give it a name.'); return; }
    const n = (id) => Number(num(v(id))) || 0;
    const f = { id: 'my-' + slug(name) + '-' + uid().slice(0, 4), name, cat: v('cf-cat'), kcal: n('cf-kcal'), p: n('cf-p'), c: n('cf-c'), f: n('cf-f'), fib: 0, custom: true, units: [{ label: v('cf-serv') || 'serving', g: 100, qty: 1 }] };
    S.settings.customFoods = [...(S.settings.customFoods || []), f];
    saveSettings();
    S.sheet = { ...S.sheet, custom: false, pick: { foodId: f.id, unit: f.units[0].label, qty: 1 } };
    render();
  },

  // history
  'hist-month': (el) => {
    const [y, m] = S.hist.month.split('-').map(Number);
    const d = new Date(y, m - 1 + Number(el.dataset.v), 1);
    S.hist.month = ymd(d).slice(0, 7); render();
  },
  'hist-pick': (el) => { S.hist.sel = el.dataset.v; render(); },
  'open-day': (el) => { S.date = el.dataset.v; S.tab = 'today'; render(); window.scrollTo(0, 0); },
  'open-session': (el) => { S.sheet = { type: 'session', id: el.dataset.id }; render(); },
  'edit-session': (el) => { const s = S.sessions.find((x) => x.id === el.dataset.id); S.sheet = null; S.draft = structuredClone(s); render(); window.scrollTo(0, 0); },
  'delete-session': (el) => {
    const id = el.dataset.id;
    confirmSheet('Delete this entry?', 'It’s removed from your history and charts. This can’t be undone.', 'Delete', () => {
      S.db.deleteSession(S.user.uid, id).catch(fail);
      S.sessions = S.sessions.filter((s) => s.id !== id);
      S.sheet = null; render();
    });
  },
  'sheet-close': () => { S.sheet = null; render(); },
  'sheet-backdrop': (el, ev) => { if (ev.target === el) { S.sheet = null; render(); } },
  'confirm-ok': () => { const f = S.sheet.onOk; S.sheet = null; f(); },

  // trends
  'trend-mode': (el) => { S.trend.mode = el.dataset.v; render(); },
  'trend-days': (el) => { S.trend.days = Number(el.dataset.v); render(); },
  'trend-metric': (el) => { S.trend.metric = el.dataset.v; render(); },
  'trend-range': (el) => { S.trend.range = el.dataset.v; render(); },
  'body-range': (el) => { S.trend.bodyRange = el.dataset.v; render(); },

  // birthday plan
  'plan-tab': (el) => { S.planTab = el.dataset.v; render(); window.scrollTo(0, 0); },
  'plan-open': (el) => { S.sheet = { type: 'planday', date: el.dataset.v }; render(); },
  'plan-goto': (el) => { S.date = el.dataset.v; S.tab = 'today'; S.sheet = null; render(); window.scrollTo(0, 0); },
  'plan-today': () => { const p = planOf(ymd()); if (!p) return; S.plan = planFromJourney(p); S.tab = 'train'; render(); window.scrollTo(0, 0); },
  'start-planned': () => { const p = planOf(ymd()); if (!p) return; S.plan = planFromJourney(p); ACT['plan-start'](); },
  'meal-log': (el) => {
    const d = S.date, p = planOf(d);
    if (!p) return;
    const m = mealsFor(p, d).meals.find((x) => x.slot === el.dataset.slot);
    if (!m) return;
    const day = dayData(d);
    let food = [...(day.food || [])];
    const supps = { ...(day.supps || {}) };
    const pw = { ...(day.planWhey || {}) };
    const wheyOn = activeSupps().some((x) => x.id === 'whey');
    if (food.some((f) => f.plan === m.slot)) {
      food = food.filter((f) => f.plan !== m.slot);
      if (pw[m.slot]) { const n = (Number(supps.whey) || 0) - 1; if (n > 0) supps.whey = n; else delete supps.whey; delete pw[m.slot]; }
      saveDaily(d, { food, supps, planWhey: pw });
      toast(`Unmarked ${m.label.toLowerCase()}`);
    } else {
      const at = Date.now();
      m.items.forEach((it, i) => {
        if (it.id === 'whey') {
          // Whey counts through the supplement tick, so it isn't counted twice.
          if (wheyOn) { supps.whey = (Number(supps.whey) || 0) + 1; pw[m.slot] = 1; return; }
          food.push({ id: uid(), foodId: 'plan-whey', name: 'Whey protein', unit: '1 scoop', qty: 1, g: 30, meal: m.meal, at: at + i, plan: m.slot, ...WHEY });
          return;
        }
        const f = foodById(it.id);
        food.push({ id: uid(), foodId: f.id, name: f.name, unit: 'g', qty: it.g, meal: m.meal, at: at + i, plan: m.slot, ...macrosFor(f, 'g', it.g) });
      });
      saveDaily(d, { food, supps, planWhey: pw });
      toast(`Logged ${m.option.name}: ${fmtInt(m.macros.kcal)} kcal, ${Math.round(m.macros.p)} g protein`);
    }
    navigator.vibrate?.(10);
    render();
  },
  'meal-swap': (el) => {
    const d = S.date, slot = el.dataset.slot, p = planOf(d);
    const cur = mealsFor(p, d).meals.find((m) => m.slot === slot);
    const sw = { ...(dayData(d).mealSwaps || {}) };
    sw[slot] = (cur.optIndex + 1) % MEAL_OPTIONS[slot].length;
    saveDaily(d, { mealSwaps: sw });
    render();
  },
  checkin: (el) => {
    const c = el.dataset.c, adj = Number(el.dataset.adj), j = J();
    j.checkins = { ...(j.checkins || {}), [c]: { at: ymd(), adj } };
    j.calAdj = (j.calAdj || 0) + adj;
    saveSettings();
    toast(adj ? `Calories ${adj > 0 ? 'up' : 'down'} ${Math.abs(adj)} a day from today` : 'Plan unchanged');
    render();
  },
  'j-time': (el) => { J().trainTime = el.dataset.v; S.openDay = 'plan-ctrl'; saveSettings(); render(); },
  'j-foot': (el) => {
    const j = J();
    if (el.dataset.v === 'now') { j.legsFrom = ymd(); toast('Legs are back from today. The first sessions are lighter.'); }
    else { j.legsFrom = addDays(j.legsFrom < ymd() ? ymd() : j.legsFrom, 7); toast(`Legs now return on ${mdDate(j.legsFrom)}`); }
    S.openDay = 'plan-ctrl'; S.plan = null; saveSettings(); render();
  },
  'j-adj-reset': () => { J().calAdj = 0; S.openDay = 'plan-ctrl'; saveSettings(); render(); },
  'j-shift': () => {
    const j = J();
    j.shifts = [...(j.shifts || []), { from: ymd(), n: 1 }];
    S.plan = null; saveSettings();
    toast(`Today is ${planOf(ymd()).day.name}. The rest of the plan moved back a day.`);
    render();
  },
  'j-shift-undo': () => { const j = J(); j.shifts = (j.shifts || []).slice(0, -1); S.plan = null; S.openDay = 'plan-ctrl'; saveSettings(); render(); },
  'shop-week': (el) => { S.shopWeek = Number(el.dataset.v); render(); },
  'shop-check': (el) => { shopToggle(el.dataset.v); render(); },

  // setup
  'set-unit': (el) => { S.settings.unit = el.dataset.v; saveSettings(); render(); },
  'set-body-unit': (el) => { S.settings.bodyUnit = el.dataset.v; saveSettings(); render(); },
  'set-waist-unit': (el) => { S.settings.waistUnit = el.dataset.v; saveSettings(); render(); },
  'set-water-unit': (el) => { S.settings.waterUnit = el.dataset.v; saveSettings(); render(); },
  'set-rest': (el) => { S.settings.restSec = Number(el.dataset.v); saveSettings(); render(); },
  'tgt-auto': (el) => {
    const t = targets();
    // Switching to manual starts from the calculated numbers so nothing jumps.
    S.settings.targets = el.dataset.v === '1' ? { ...S.settings.targets, auto: true } : { auto: false, kcal: t.kcal, p: t.p, c: t.c, f: t.f, fib: t.fib, waterMl: t.waterMl };
    saveSettings(); render();
  },
  'supp-del': (el) => {
    const x = S.settings.supps[el.dataset.i];
    confirmSheet(`Delete ${x.name}?`, 'Days you already ticked it keep their record.', 'Delete', () => { S.settings.supps.splice(el.dataset.i, 1); saveSettings(); render(); });
  },
  'supp-add': () => {
    const name = document.getElementById('add-supp').value.trim();
    const kind = document.getElementById('add-supp-kind').value;
    if (!name) { toast('Type a name first.'); return; }
    S.settings.supps.push({ id: slug(name) + '-' + uid().slice(0, 4), name, dose: kind === 'powder' ? '1 scoop' : '1 capsule', kind, when: '', on: true, ...(kind === 'powder' ? { kcal: 0, p: 0, c: 0, f: 0 } : {}) });
    saveSettings(); render();
  },
  'list-del': (el) => { S.settings[el.dataset.list].splice(el.dataset.i, 1); S.openDay = el.dataset.list; saveSettings(); render(); },
  'list-add': (el) => {
    const k = el.dataset.list, inp = document.getElementById(`add-${k}`), name = inp.value.trim();
    if (!name) { toast('Type a name first.'); return; }
    S.settings[k].push({ id: slug(name) + '-' + uid().slice(0, 4), name, target: '3 × 10' });
    S.openDay = k; saveSettings(); render();
  },
  'ex-up': (el) => moveEx(el, -1),
  'ex-down': (el) => moveEx(el, 1),
  'ex-del': (el) => {
    const d = routine().days[el.dataset.day], e = d.exercises[el.dataset.ex];
    confirmSheet(`Remove ${e.name} from ${d.name}?`, 'Past sessions and charts for it are kept. You can add it back any time.', 'Remove', () => {
      d.exercises.splice(el.dataset.ex, 1); S.openDay = d.id; S.plan = null; saveSettings(); render();
    });
  },
  'ex-add': (el) => {
    const d = routine().days[el.dataset.day];
    const input = document.getElementById(`add-ex-${el.dataset.day}`);
    const name = input.value.trim();
    if (!name) { toast('Type a name first.'); return; }
    const known = [...allExercises(), ...LIBRARY].find((e) => e.name.toLowerCase() === name.toLowerCase());
    let id = known?.id || slug(name);
    if (!known) { const taken = new Set([...allExercises(), ...LIBRARY].map((e) => e.id)); let n = 2; const b = id; while (taken.has(id)) id = `${b}-${n++}`; }
    if (d.exercises.some((e) => e.id === id)) { toast(`${name} is already on this day.`); return; }
    d.exercises.push({ id, name, group: known?.group || d.name.split(' + ')[0], ...(known?.muscle ? { muscle: known.muscle } : {}) });
    S.openDay = d.id; S.plan = null; input.value = ''; saveSettings(); render();
  },
  export: () => {
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), settings: S.settings, sessions: S.sessions, daily: S.daily }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `gym-log-${ymd()}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  },
  signout: () => confirmSheet('Sign out?', 'Your log stays saved. Sign in again with the same email to see it.', 'Sign out', () => S.db.signOut(), false),
};

function moveEx(el, dir) {
  const d = routine().days[el.dataset.day], i = Number(el.dataset.ex), j = i + dir;
  [d.exercises[i], d.exercises[j]] = [d.exercises[j], d.exercises[i]];
  S.openDay = d.id; S.plan = null; saveSettings(); render();
}

document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-act]');
  if (!el || !$app.contains(el)) return;
  if (el.tagName === 'SELECT' || el.tagName === 'INPUT') return;
  const f = ACT[el.dataset.act];
  if (f) { if (el.dataset.act !== 'sheet-backdrop') ev.preventDefault(); f(el, ev); }
});

document.addEventListener('toggle', (ev) => {
  const d = ev.target;
  if (d.matches?.('details[data-day-id]')) S.openDay = d.open ? d.dataset.dayId : (S.openDay === d.dataset.dayId ? null : S.openDay);
  if (d.matches?.('details[data-core]')) S.openCore = d.open ? d.dataset.core : (S.openCore === d.dataset.core ? null : S.openCore);
}, true);

document.addEventListener('submit', async (ev) => {
  if (ev.target.id !== 'auth-form') return;
  ev.preventDefault();
  const f = new FormData(ev.target);
  const email = String(f.get('email')).trim(), pw = String(f.get('password'));
  S.busy = true; S.authMsg = ''; document.activeElement?.blur(); render();
  try { await (S.authMode === 'up' ? S.db.signUp(email, pw) : S.db.signIn(email, pw)); }
  catch (e) { S.authMsg = AUTH_ERR[e.code] || e.message; }
  S.busy = false; render();
});

// Typing updates state quietly; no full re-render until something discrete happens.
document.addEventListener('input', (ev) => {
  const t = ev.target;
  if (S.draft && t.dataset.ex != null && t.dataset.set != null) {
    const s = S.draft.exercises[t.dataset.ex].sets[t.dataset.set];
    const v = num(t.value);
    s[t.dataset.k] = t.dataset.k === 'r' && v !== '' ? Math.round(v) : v;
    persistDraft();
  } else if (S.draft && t.dataset.warm != null) {
    S.draft.warmup[t.dataset.warm][t.dataset.k] = num(t.value);
    persistDraft();
  } else if (t.id === 'food-q' && S.sheet?.type === 'food') {
    S.sheet.q = t.value;
    const box = document.getElementById('food-list');
    if (box) { box.innerHTML = foodListHtml(); box.scrollTop = 0; }
    document.querySelectorAll('.cchip').forEach((c) => c.classList.toggle('on', !t.value && c.dataset.v === S.sheet.cat));
  } else if (t.id === 'food-qty' && S.sheet?.pick) {
    S.sheet.pick.qty = num(t.value) || 0;
    refreshMacroPreview();
  }
});

document.addEventListener('change', (ev) => {
  const t = ev.target;
  if (t.dataset.actChange === 'trend-ex') { S.trend.exId = t.value; render(); return; }
  if (t.dataset.actChange === 'plan-warm') { S.plan.warm = t.checked; return; }
  if (t.id === 'food-unit' && S.sheet?.pick) {
    const f = foodById(S.sheet.pick.foodId, S.settings.customFoods);
    const u = f.units.find((x) => x.label === t.value);
    // Keep the same weight when switching units, so 1 cup -> 91 g, not 1 g.
    const grams = (f.units.find((x) => x.label === S.sheet.pick.unit)?.g || 1) * (Number(S.sheet.pick.qty) || 0);
    S.sheet.pick.unit = u.label;
    S.sheet.pick.qty = grams ? Math.round((grams / u.g) * (u.g === 1 ? 1 : 10)) / (u.g === 1 ? 1 : 10) : u.qty;
    const inp = document.getElementById('food-qty'); if (inp) inp.value = S.sheet.pick.qty;
    refreshMacroPreview(); return;
  }
  if (t.dataset.whoop) {
    const w = { ...(dayData(S.date).whoop || {}) };
    const v = num(t.value);
    if (v === '') delete w[t.dataset.whoop]; else w[t.dataset.whoop] = v;
    saveDaily(S.date, { whoop: w }); render(); return;
  }
  if (t.dataset.prof) {
    S.settings.profile[t.dataset.prof] = t.tagName === 'SELECT' || t.dataset.prof === 'name' ? t.value.trim() : num(t.value);
    saveSettings(); render(); return;
  }
  if (t.dataset.tgt) {
    const v = num(t.value);
    if (v > 0) { S.settings.targets[t.dataset.tgt] = t.dataset.tgt === 'waterMl' && isOz() ? Math.round(v * ML_PER_OZ) : Math.round(v); saveSettings(); }
    return;
  }
  if (t.dataset.supp != null) {
    const x = S.settings.supps[t.dataset.supp], k = t.dataset.k;
    if (k === 'on') x.on = t.checked;
    else if (['kcal', 'p', 'c', 'f'].includes(k)) x[k] = Number(num(t.value)) || 0;
    else if (t.value.trim() || k !== 'name') x[k] = t.value.trim();
    saveSettings(); return;
  }
  if (t.dataset.list) {
    const x = S.settings[t.dataset.list][t.dataset.i];
    if (t.value.trim()) { x[t.dataset.k] = t.value.trim(); S.openDay = t.dataset.list; saveSettings(); }
    return;
  }
  if (t.id === 'step-goal') { const v = num(t.value); if (v > 0) { S.settings.stepGoal = Math.round(v); saveSettings(); toast('Step goal saved'); } return; }
  if (t.dataset.warmDef != null) {
    const w = routine().warmup[t.dataset.warmDef];
    if (t.dataset.k === 'name') { if (t.value.trim()) w.name = t.value.trim(); } else { const v = num(t.value); if (v !== '') w.min = v; }
    saveSettings(); return;
  }
  if (t.dataset.day != null && t.dataset.k === 'name') { const d = routine().days[t.dataset.day]; if (t.value.trim()) { d.name = t.value.trim(); S.openDay = d.id; saveSettings(); } return; }
  if (t.dataset.day != null && t.dataset.k === 'exname') { const e = routine().days[t.dataset.day].exercises[t.dataset.ex]; if (t.value.trim()) { e.name = t.value.trim(); S.openDay = routine().days[t.dataset.day].id; saveSettings(); } return; }
  if (t.id === 'bw-in') { const v = num(t.value); saveDaily(S.date, { bw: v === '' ? null : v, bwUnit: v === '' ? null : bu() }); render(); }
  if (t.id === 'waist-in') { const v = num(t.value); saveDaily(S.date, { waist: v === '' ? null : v, waistUnit: v === '' ? null : S.settings.waistUnit || 'in' }); }
});

document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && S.sheet) { S.sheet = null; render(); }
  if (ev.key === 'Enter' && ev.target.id === 'steps-in') ACT['save-steps']();
  if (ev.key === 'Enter' && ev.target.closest?.('.fuel-mini') === ev.target) ACT.tab(ev.target);
});

// Bring timers back in line after the phone was locked; roll the date over at midnight.
let todayAtRender = ymd();
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  updateTimers();
  if (S.user && S.date === todayAtRender && ymd() !== todayAtRender) { S.date = ymd(); render(); }
});

boot();
