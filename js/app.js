import { firebaseConfig } from './config.js';
import {
  DEFAULT_SETTINGS, PLATE, ymd, parseYmd, addDays, nextDay, bySessionTime, convert, fmtW, e1rm,
  doneSets, sessionStats, exerciseHistory, lastSetsFor, bestE1rm, newSession, weekStart, streakDays, slug,
} from './data.js';
import { lineChart, barChart } from './charts.js';

const $app = document.getElementById('app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (v) => { const n = parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) ? n : ''; };
const fmtInt = (n) => Math.round(n || 0).toLocaleString();
const longDate = (s) => parseYmd(s).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
const shortDate = (s) => parseYmd(s).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const plate = (c) => PLATE[c] || PLATE.yellow;

const S = {
  db: null, user: undefined, settings: null, sessions: [], daily: {}, loaded: { settings: false, sessions: false, daily: false },
  tab: 'today', draft: null, sheet: null, rest: null, authMode: 'in', authMsg: '', busy: false,
  prog: { mode: 'overview', exId: null, metric: 'e1rm', range: 'all', stepRange: 30, bodyRange: 'all' },
  openDay: null, watchStop: null,
};
const unit = () => S.settings?.unit || 'lb';
const routine = () => S.settings?.routine || DEFAULT_SETTINGS.routine;

// ---------------------------------------------------------------- boot
async function boot() {
  const local = ['localhost', '127.0.0.1'].includes(location.hostname);
  if (firebaseConfig) S.db = (await import('./db-firebase.js')).createDb(firebaseConfig);
  else if (local) S.db = (await import('./db-mock.js')).createDb();
  else {
    $app.innerHTML = `<div class="center-screen"><div class="brand-plate"></div><h1 class="display">Gym Log</h1><p class="muted">This app isn't connected to its database yet.</p></div>`;
    return;
  }
  S.db.onAuth((u) => {
    S.user = u;
    S.watchStop?.();
    S.settings = null; S.sessions = []; S.daily = {}; S.loaded = { settings: false, sessions: false, daily: false };
    S.draft = null; S.sheet = null;
    if (u) {
      S.watchStop = S.db.watch(u.uid, {
        onSettings: (s) => {
          S.loaded.settings = true;
          if (!s) { S.settings = structuredClone(DEFAULT_SETTINGS); S.db.saveSettings(u.uid, S.settings).catch(fail); }
          else S.settings = { ...structuredClone(DEFAULT_SETTINGS), ...s };
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

function fail(e) { console.error(e); toast('Couldn’t save. It will retry when you’re back online.'); }

// ---------------------------------------------------------------- render
let pending = false;
// Data arriving from sync shouldn't yank the keyboard away mid-typing; wait for blur.
function softRender() {
  const a = document.activeElement;
  if (a && (a.tagName === 'INPUT' || a.tagName === 'SELECT') && $app.contains(a)) { pending = true; return; }
  render();
}
function render() {
  pending = false;
  const keep = [...$app.querySelectorAll('[data-keep]')].map((el) => [el.dataset.keep, el.scrollTop]);
  const winY = window.scrollY;
  $app.innerHTML = view();
  for (const [k, t] of keep) { const el = $app.querySelector(`[data-keep="${k}"]`); if (el) el.scrollTop = t; }
  window.scrollTo(0, winY);
  afterRender();
}
document.addEventListener('focusout', () => setTimeout(() => { if (pending) render(); }, 0));

function view() {
  if (S.user === undefined) return `<div class="center-screen"><div class="brand-plate spin"></div></div>`;
  if (!S.user) return authView();
  if (!S.loaded.settings || !S.loaded.sessions) return `<div class="center-screen"><div class="brand-plate spin"></div><p class="muted">Loading your log</p></div>`;
  const body = S.draft ? workoutView() : `
    <main class="page" style="--day:${plate(nextDay(routine(), S.sessions).color)}">${{ today: todayView, history: historyView, progress: progressView, settings: settingsView }[S.tab]()}</main>
    ${navView()}`;
  return body + (S.sheet ? sheetView() : '');
}

const ICON = {
  today: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="2.5"/>',
  history: '<path d="M4 6h16M4 12h16M4 18h10"/>',
  progress: '<path d="M4 19l5-6 4 3 7-9"/><path d="M15 7h5v5"/>',
  settings: '<path d="M5 7h9M18 7h1M5 17h1M10 17h9"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
};
const icon = (k) => `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k]}</svg>`;

function navView() {
  const items = [['today', 'Today'], ['history', 'History'], ['progress', 'Progress'], ['settings', 'Setup']];
  return `<nav class="tabbar">${items.map(([k, l]) => `<button data-act="tab" data-v="${k}" class="${S.tab === k ? 'on' : ''}" aria-current="${S.tab === k}">${icon(k)}<span>${l}</span></button>`).join('')}</nav>`;
}

// ---------------------------------------------------------------- auth
function authView() {
  const up = S.authMode === 'up';
  return `<div class="auth">
    <div class="brand-plate"></div>
    <h1 class="display">Gym Log</h1>
    <p class="muted">Your split, your numbers, every session.</p>
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

// ---------------------------------------------------------------- today
function todayView() {
  const r = routine();
  const today = ymd();
  const active = S.sessions.filter((s) => s.status === 'active').pop();
  const next = nextDay(r, S.sessions);
  const doneToday = S.sessions.filter((s) => s.status === 'done' && s.date === today);
  const streak = streakDays(S.sessions);
  const d = S.daily[today] || {};
  const goal = S.settings.stepGoal || 10000;
  const pct = Math.min(100, Math.round(((d.steps || 0) / goal) * 100));
  const shown = active ? r.days.find((x) => x.id === active.dayId) || next : next;

  return `
  <header class="top">
    <div><p class="muted">${longDate(today)}</p></div>
    ${streak ? `<p class="streak"><b>${streak}</b> day${streak === 1 ? '' : 's'} logged in a row</p>` : ''}
  </header>

  <section class="hero" style="--day:${plate(shown.color)}">
    <div class="disc" aria-hidden="true"><div class="disc-hole"></div></div>
    <div class="hero-text">
      <p class="muted">${active ? 'In progress' : 'Up next in your split'}</p>
      <h1 class="display day-title">${esc(shown.name)}</h1>
      ${shown.rest ? '<p class="muted">Recover. Walk, stretch, sleep.</p>' : `<p class="muted">${shown.exercises.length} exercises after the 40-minute warm-up</p>`}
    </div>
  </section>

  <ol class="cycle" aria-label="Your split">
    ${r.days.map((x) => `<li class="${x.id === shown.id ? 'on' : ''}" style="--day:${plate(x.color)}"><span class="pip"></span><span>${esc(x.name.split(' + ')[0].replace(' day', ''))}</span></li>`).join('')}
  </ol>

  <div class="stack gap-s">
    ${active
      ? `<button class="btn primary big" data-act="resume" data-id="${active.id}" style="--day:${plate(active.color)}">Resume ${esc(active.dayName)}</button>`
      : shown.rest
        ? `<button class="btn primary big" data-act="start" data-day="${shown.id}" style="--day:${plate(shown.color)}">Log rest day</button>`
        : `<button class="btn primary big" data-act="start" data-day="${shown.id}" style="--day:${plate(shown.color)}">Start ${esc(shown.name)}</button>`}
    <details class="other-days">
      <summary>Train a different day</summary>
      <div class="chips">${r.days.filter((x) => x.id !== shown.id).map((x) => `<button class="chip" data-act="start" data-day="${x.id}" style="--day:${plate(x.color)}"><span class="pip"></span>${esc(x.name)}</button>`).join('')}</div>
    </details>
  </div>

  ${doneToday.length ? `<section class="card done-today">
    ${doneToday.map((s) => { const st = sessionStats(s, unit()); return `<button class="row-btn" data-act="open-session" data-id="${s.id}" style="--day:${plate(s.color)}">
      <span class="pip lg"></span><span class="grow"><b>Done today: ${esc(s.dayName)}</b><br><span class="muted">${s.rest ? 'Rest day logged' : `${st.sets} sets, ${fmtInt(st.volume)} ${unit()} moved${st.minutes ? `, ${st.minutes} min` : ''}`}</span></span></button>`; }).join('')}
  </section>` : ''}

  <section class="card">
    <div class="card-head"><h2>Steps today</h2><button class="link" data-act="tab" data-v="progress" data-mode="steps">See trend</button></div>
    <div class="steps-row">
      <input class="big-input" id="steps-today" inputmode="numeric" placeholder="0" value="${d.steps ?? ''}" aria-label="Steps today">
      <button class="btn" data-act="save-steps">Save</button>
    </div>
    <div class="meter" role="meter" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct}%"></span></div>
    <p class="muted small">${pct >= 100 ? 'Goal reached' : `${fmtInt(Math.max(0, goal - (d.steps || 0)))} to your ${fmtInt(goal)} goal`}</p>
    <div class="bw-row">
      <label class="field inline"><span>Body weight (${unit()})</span><input id="bw-today" inputmode="decimal" placeholder="optional" value="${d.bw ?? ''}"></label>
    </div>
  </section>

  ${weekStrip()}

  ${shown.rest ? '' : `<section class="card">
    <div class="card-head"><h2>${esc(shown.name)} last time</h2></div>
    <ul class="plain-list">${shown.exercises.map((e) => {
      const last = lastSetsFor(S.sessions, e.id);
      return `<li><span>${esc(e.name)}</span><span class="muted num">${last ? setsLine(last.sets, last.session.unit) : 'First time'}</span></li>`;
    }).join('')}</ul>
  </section>`}
  `;
}

function setsLine(sets, from) {
  return sets.map((s) => `${fmtW(convert(Number(s.w) || 0, from || unit(), unit()))}×${s.r}`).join(', ');
}

function weekStrip() {
  const start = weekStart(ymd());
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const by = {};
  for (const s of S.sessions) if (s.status === 'done') (by[s.date] ||= []).push(s);
  const today = ymd();
  return `<section class="card week">
    <div class="card-head"><h2>This week</h2></div>
    <ol class="week-days">${days.map((d) => {
      const list = by[d] || [];
      const s = list[list.length - 1];
      return `<li class="${d === today ? 'today' : ''}${s ? ' has' : ''}" style="--day:${s ? plate(s.color) : 'transparent'}">
        <span class="wd">${parseYmd(d).toLocaleDateString(undefined, { weekday: 'narrow' })}</span>
        <span class="ring">${s ? '' : parseYmd(d).getDate()}</span>
        <span class="lbl">${s ? esc(s.dayName.split(' + ')[0].replace(' day', '')) : ''}</span></li>`;
    }).join('')}</ol>
  </section>`;
}

// ---------------------------------------------------------------- workout
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
        <button class="btn primary big" data-act="${editing ? 'wk-save' : 'wk-finish'}">${editing ? 'Save changes' : 'Finish workout'}</button>
        <button class="btn ghost danger" data-act="wk-discard">${editing ? 'Delete this workout' : 'Discard workout'}</button>
      </div>
    </div>
    ${S.rest && !editing ? restBar() : ''}
  </div>`;
}

const checkSvg = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

function exerciseCard(e, ei, w) {
  const u = unit();
  const last = lastSetsFor(S.sessions, e.id, w.id);
  const nDone = e.sets.filter((s) => s.done).length;
  const complete = nDone > 0 && nDone === e.sets.length;
  return `<section class="card ex ${complete ? 'complete' : ''}">
    <div class="ex-head">
      <div class="grow"><h2>${esc(e.name)}</h2>
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

// ---------------------------------------------------------------- history
function historyView() {
  const done = S.sessions.filter((s) => s.status === 'done').slice().reverse();
  if (!done.length) return `<header class="top"><h1 class="display">History</h1></header><div class="empty"><p>Finished workouts show up here.</p><button class="btn primary" data-act="tab" data-v="today">Go to today</button></div>`;
  const groups = {};
  for (const s of done) (groups[s.date.slice(0, 7)] ||= []).push(s);
  const u = unit();
  return `<header class="top"><h1 class="display">History</h1><p class="muted">${done.filter((s) => !s.rest).length} workouts</p></header>
  ${Object.entries(groups).map(([m, list]) => `<section class="month">
    <h2 class="month-title">${parseYmd(m + '-01').toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h2>
    <div class="card list">${list.map((s) => {
      const st = sessionStats(s, u);
      return `<button class="row-btn" data-act="open-session" data-id="${s.id}" style="--day:${plate(s.color)}">
        <span class="date-chip"><b>${parseYmd(s.date).getDate()}</b><span>${parseYmd(s.date).toLocaleDateString(undefined, { weekday: 'short' })}</span></span>
        <span class="pip lg"></span>
        <span class="grow"><b>${esc(s.dayName)}</b><br><span class="muted small">${s.rest ? 'Rest day' : `${st.sets} sets, ${fmtInt(st.volume)} ${u}${st.minutes ? `, ${st.minutes} min` : ''}`}</span></span>
        ${(s.exercises || []).some((e) => e.sets.some((x) => x.pr)) ? '<span class="pr">PR</span>' : ''}
      </button>`;
    }).join('')}</div>
  </section>`).join('')}`;
}

// ---------------------------------------------------------------- progress
function progressView() {
  const m = S.prog.mode;
  const tabs = [['overview', 'Overview'], ['lifts', 'Lifts'], ['steps', 'Steps'], ['body', 'Body']];
  return `<header class="top"><h1 class="display">Progress</h1></header>
  <div class="seg wide" role="tablist">${tabs.map(([k, l]) => `<button role="tab" aria-selected="${m === k}" class="${m === k ? 'on' : ''}" data-act="prog-mode" data-v="${k}">${l}</button>`).join('')}</div>
  ${{ overview: overviewView, lifts: liftsView, steps: stepsView, body: bodyView }[m]()}`;
}

function overviewView() {
  const u = unit();
  const done = S.sessions.filter((s) => s.status === 'done' && !s.rest);
  const thisWeek = weekStart(ymd());
  const weeks = Array.from({ length: 12 }, (_, i) => addDays(thisWeek, -7 * (11 - i)));
  const vol = Object.fromEntries(weeks.map((w) => [w, 0]));
  const cnt = Object.fromEntries(weeks.map((w) => [w, 0]));
  for (const s of done) { const k = weekStart(s.date); if (k in vol) { vol[k] += sessionStats(s, u).volume; cnt[k]++; } }
  const month = ymd().slice(0, 7);
  const monthCount = done.filter((s) => s.date.startsWith(month)).length;
  const prs = [];
  for (const s of [...done].reverse()) for (const e of s.exercises || []) for (const x of e.sets) if (x.pr && prs.length < 6) prs.push({ s, e, x });
  return `
  <div class="stats">
    <div class="stat"><b>${cnt[thisWeek]}</b><span>workouts this week</span></div>
    <div class="stat"><b>${monthCount}</b><span>this month</span></div>
    <div class="stat"><b>${done.length}</b><span>all time</span></div>
  </div>
  <section class="card"><div class="card-head"><h2>Weekly volume</h2><span class="muted small">${u} × reps, last 12 weeks</span></div>
    <div id="ch-weekly"></div></section>
  <section class="card"><div class="card-head"><h2>Recent bests</h2></div>
    ${prs.length ? `<ul class="plain-list">${prs.map(({ s, e, x }) => `<li><span>${esc(e.name)}<br><span class="muted small">${shortDate(s.date)}</span></span><span class="num">${fmtW(convert(Number(x.w), s.unit, u))} × ${x.r}</span></li>`).join('')}</ul>`
      : '<p class="muted">Beat a previous best on any lift and it lands here.</p>'}
  </section>`;
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

function liftsView() {
  const exs = allExercises();
  if (!S.prog.exId || !exs.some((e) => e.id === S.prog.exId)) S.prog.exId = exs[0]?.id;
  const cur = exs.find((e) => e.id === S.prog.exId);
  const u = unit();
  const hist = rangeFilter(exerciseHistory(S.sessions, S.prog.exId, u), S.prog.range);
  const metric = S.prog.metric;
  const val = (p) => (metric === 'e1rm' ? p.e1rm : metric === 'top' ? p.top.w : metric === 'reps' ? p.maxReps : p.volume);
  const ys = hist.map(val);
  const best = ys.length ? Math.max(...ys) : 0;
  const first = ys[0], lastv = ys[ys.length - 1];
  const change = ys.length > 1 ? lastv - first : null;
  const groups = routine().days.filter((d) => !d.rest);
  const mLabel = { e1rm: 'Est. 1-rep max', top: 'Heaviest set', volume: 'Volume', reps: 'Most reps' }[metric];
  return `
  <label class="field"><span>Exercise</span>
    <select data-act-change="prog-ex">${groups.map((d) => `<optgroup label="${esc(d.name)}">${d.exercises.map((e) => `<option value="${e.id}" ${e.id === S.prog.exId ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}</optgroup>`).join('')}
      ${exs.filter((e) => !e.day).length ? `<optgroup label="No longer in routine">${exs.filter((e) => !e.day).map((e) => `<option value="${e.id}" ${e.id === S.prog.exId ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}</optgroup>` : ''}
    </select></label>
  <div class="seg">${[['e1rm', 'Est. 1RM'], ['top', 'Heaviest'], ['reps', 'Reps'], ['volume', 'Volume']].map(([k, l]) => `<button class="${metric === k ? 'on' : ''}" data-act="prog-metric" data-v="${k}">${l}</button>`).join('')}</div>
  <section class="card" style="--day:${plate(cur?.day?.color)}">
    <div class="card-head"><h2>${esc(cur?.name || '')}</h2>
      <div class="seg tiny">${[['30', '1M'], ['90', '3M'], ['180', '6M'], ['all', 'All']].map(([k, l]) => `<button class="${S.prog.range === k ? 'on' : ''}" data-act="prog-range" data-v="${k}">${l}</button>`).join('')}</div></div>
    <p class="muted small">${mLabel}${metric === 'reps' ? '' : ` in ${u}`}, one point per session</p>
    <div id="ch-lift"></div>
    <div class="stats compact">
      <div class="stat"><b>${ys.length ? fmtNum(lastv) : '–'}</b><span>latest</span></div>
      <div class="stat"><b>${ys.length ? fmtNum(best) : '–'}</b><span>best</span></div>
      <div class="stat"><b>${change == null ? '–' : (change >= 0 ? '+' : '−') + fmtNum(Math.abs(change))}</b><span>since first shown</span></div>
    </div>
  </section>
  ${hist.length ? `<section class="card"><div class="card-head"><h2>Sessions</h2></div>
    <ul class="plain-list">${hist.slice().reverse().slice(0, 15).map((p) => `<li><span>${shortDate(p.date)}</span><span class="num muted">${p.sets.map((s) => `${fmtW(s.w)}×${s.r}`).join(', ')}</span></li>`).join('')}</ul></section>` : ''}`;
}
const fmtNum = (v) => (Math.abs(v) >= 1000 ? fmtInt(v) : String(Math.round(v * 10) / 10));

function stepsSeries(days) {
  const out = [];
  const today = ymd();
  for (let i = days - 1; i >= 0; i--) { const d = addDays(today, -i); out.push({ date: d, y: S.daily[d]?.steps || null }); }
  return out;
}

function stepsView() {
  const n = S.prog.stepRange;
  const series = stepsSeries(n);
  const logged = series.filter((b) => b.y);
  const avg = logged.length ? logged.reduce((a, b) => a + b.y, 0) / logged.length : 0;
  const goal = S.settings.stepGoal || 10000;
  const met = logged.filter((b) => b.y >= goal).length;
  const recent = Object.entries(S.daily).filter(([, v]) => v.steps).sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 10);
  return `
  <section class="card" style="--day:${PLATE.green}">
    <div class="card-head"><h2>Daily steps</h2>
      <div class="seg tiny">${[[7, '7D'], [30, '30D'], [90, '90D']].map(([k, l]) => `<button class="${n === k ? 'on' : ''}" data-act="step-range" data-v="${k}">${l}</button>`).join('')}</div></div>
    <p class="muted small">Bars are daily steps, faded below goal. The line is the 7-day average.</p>
    <div id="ch-steps"></div>
    <div class="stats compact">
      <div class="stat"><b>${logged.length ? fmtInt(avg) : '–'}</b><span>daily average</span></div>
      <div class="stat"><b>${logged.length ? fmtInt(Math.max(...logged.map((b) => b.y))) : '–'}</b><span>best day</span></div>
      <div class="stat"><b>${met}/${logged.length}</b><span>days at goal</span></div>
    </div>
  </section>
  <section class="card">
    <div class="card-head"><h2>Add or fix a day</h2></div>
    <div class="entry-row">
      <input type="date" id="steps-date" value="${ymd()}" max="${ymd()}" aria-label="Date">
      <input id="steps-val" inputmode="numeric" placeholder="Steps" aria-label="Steps">
      <button class="btn" data-act="save-steps-date">Save</button>
    </div>
    ${recent.length ? `<ul class="plain-list">${recent.map(([d, v]) => `<li><span>${shortDate(d)}</span><span class="num">${fmtInt(v.steps)}</span></li>`).join('')}</ul>` : ''}
  </section>`;
}

function bodyView() {
  const u = unit();
  const pts = Object.entries(S.daily).filter(([, v]) => v.bw).map(([d, v]) => ({ date: d, y: convert(Number(v.bw), v.unit || u, u) })).sort((a, b) => (a.date < b.date ? -1 : 1));
  const shown = rangeFilter(pts, S.prog.bodyRange);
  const ys = shown.map((p) => p.y);
  return `
  <section class="card">
    <div class="card-head"><h2>Body weight</h2>
      <div class="seg tiny">${[['30', '1M'], ['90', '3M'], ['all', 'All']].map(([k, l]) => `<button class="${S.prog.bodyRange === k ? 'on' : ''}" data-act="body-range" data-v="${k}">${l}</button>`).join('')}</div></div>
    <p class="muted small">In ${u}. Log it on the Today screen or below.</p>
    <div id="ch-body"></div>
    <div class="stats compact">
      <div class="stat"><b>${ys.length ? fmtNum(ys[ys.length - 1]) : '–'}</b><span>latest</span></div>
      <div class="stat"><b>${ys.length > 1 ? (ys[ys.length - 1] - ys[0] >= 0 ? '+' : '−') + fmtNum(Math.abs(ys[ys.length - 1] - ys[0])) : '–'}</b><span>change</span></div>
    </div>
  </section>
  <section class="card">
    <div class="card-head"><h2>Add or fix a day</h2></div>
    <div class="entry-row">
      <input type="date" id="bw-date" value="${ymd()}" max="${ymd()}" aria-label="Date">
      <input id="bw-val" inputmode="decimal" placeholder="${u}" aria-label="Body weight">
      <button class="btn" data-act="save-bw-date">Save</button>
    </div>
  </section>`;
}

// ---------------------------------------------------------------- settings
function settingsView() {
  const s = S.settings;
  const r = routine();
  return `<header class="top"><h1 class="display">Setup</h1></header>
  <section class="card">
    <div class="card-head"><h2>Preferences</h2></div>
    <div class="pref"><span>Weight unit</span><div class="seg tiny">${['lb', 'kg'].map((k) => `<button class="${s.unit === k ? 'on' : ''}" data-act="set-unit" data-v="${k}">${k}</button>`).join('')}</div></div>
    <div class="pref"><span>Rest timer</span><div class="seg tiny">${[0, 60, 90, 120, 180].map((k) => `<button class="${s.restSec === k ? 'on' : ''}" data-act="set-rest" data-v="${k}">${k ? (k < 120 ? k + 's' : k / 60 + 'm') : 'Off'}</button>`).join('')}</div></div>
    <label class="pref"><span>Daily step goal</span><input id="step-goal" inputmode="numeric" value="${s.stepGoal}" class="small-input"></label>
  </section>

  <section class="card">
    <div class="card-head"><h2>Warm-up before every training day</h2></div>
    ${r.warmup.map((w, i) => `<div class="routine-row">
      <input data-warm-def="${i}" data-k="name" value="${esc(w.name)}" aria-label="Warm-up name" class="grow">
      <label class="mini"><input data-warm-def="${i}" data-k="min" inputmode="numeric" value="${w.min}"><span>min</span></label>
    </div>`).join('')}
  </section>

  <h2 class="section-title">Your split</h2>
  <p class="muted small pad-x">Renaming an exercise keeps its history. Ab crunch and leg raises are shared between chest and leg days, so their charts include both.</p>
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
    <div class="card-head"><h2>Account</h2></div>
    <p class="muted small">Signed in as ${esc(S.user.email)}. Your log syncs to every device you sign in on.</p>
    <div class="stack gap-s">
      <button class="btn" data-act="export">Download all my data</button>
      <button class="btn ghost" data-act="signout">Sign out</button>
    </div>
  </section>`;
}

// ---------------------------------------------------------------- sheets
function sheetView() {
  const sh = S.sheet;
  let inner = '';
  if (sh.type === 'session') {
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
      <button class="btn primary big" data-act="sheet-close">Done</button></div>`;
  } else if (sh.type === 'confirm') {
    inner = `<h2 class="sheet-title">${esc(sh.title)}</h2><p class="muted">${esc(sh.body)}</p>
      <div class="stack gap-s"><button class="btn primary ${sh.danger ? 'danger-fill' : ''}" data-act="confirm-ok">${esc(sh.ok)}</button><button class="btn ghost" data-act="sheet-close">Cancel</button></div>`;
  }
  return `<div class="sheet-wrap" data-act="sheet-backdrop"><div class="sheet" role="dialog" aria-modal="true" data-keep="sheet"><div class="grabber"></div>${inner}</div></div>`;
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
  if (!S.draft && S.tab === 'progress') drawCharts();
}

function updateTimers() {
  const el = document.getElementById('elapsed');
  if (el && S.draft) el.textContent = elapsed(S.draft);
  if (S.rest) {
    const left = Math.ceil((S.rest.endsAt - Date.now()) / 1000);
    if (left <= 0) {
      S.rest = null;
      restDone();
      document.getElementById('restbar')?.remove();
      return;
    }
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

function drawCharts() {
  const u = unit();
  const m = S.prog.mode;
  if (m === 'overview') {
    const thisWeek = weekStart(ymd());
    const weeks = Array.from({ length: 12 }, (_, i) => addDays(thisWeek, -7 * (11 - i)));
    const vol = Object.fromEntries(weeks.map((w) => [w, 0]));
    for (const s of S.sessions) if (s.status === 'done' && !s.rest) { const k = weekStart(s.date); if (k in vol) vol[k] += sessionStats(s, u).volume; }
    const el = document.getElementById('ch-weekly');
    if (el) barChart(el, weeks.map((w) => ({ date: w, y: vol[w] })), {
      color: PLATE.yellow, empty: 'Finish a workout to start this chart.',
      tip: (b) => `<b>${fmtInt(b.y)} ${u}</b><span>Week of ${parseYmd(b.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>`,
    });
  } else if (m === 'lifts') {
    const exs = allExercises();
    const cur = exs.find((e) => e.id === S.prog.exId);
    const hist = rangeFilter(exerciseHistory(S.sessions, S.prog.exId, u), S.prog.range);
    const metric = S.prog.metric;
    const pts = hist.map((p) => ({ ...p, y: metric === 'e1rm' ? p.e1rm : metric === 'top' ? p.top.w : metric === 'reps' ? p.maxReps : p.volume }));
    const el = document.getElementById('ch-lift');
    if (el) lineChart(el, pts, {
      color: plate(cur?.day?.color), empty: 'Log this exercise to start its chart.',
      tip: (p) => `<b>${fmtNum(p.y)}${metric === 'reps' ? ' reps' : ' ' + u}</b><span>${parseYmd(p.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}: ${p.sets.map((s) => `${fmtW(s.w)}×${s.r}`).join(', ')}</span>`,
    });
  } else if (m === 'steps') {
    const n = S.prog.stepRange;
    const all = stepsSeries(n + 6);
    const series = all.slice(6);
    const avg = series.map((_, i) => {
      const win = all.slice(i, i + 7).filter((b) => b.y);
      return win.length >= 3 ? win.reduce((a, b) => a + b.y, 0) / win.length : null;
    });
    const el = document.getElementById('ch-steps');
    if (el) barChart(el, series, {
      color: PLATE.green, goal: S.settings.stepGoal, avgLine: avg, empty: 'Log your steps on the Today screen to start this chart.',
      tip: (b) => `<b>${b.y ? fmtInt(b.y) + ' steps' : 'Not logged'}</b><span>${parseYmd(b.date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</span>`,
    });
  } else if (m === 'body') {
    const pts = rangeFilter(Object.entries(S.daily).filter(([, v]) => v.bw).map(([d, v]) => ({ date: d, y: convert(Number(v.bw), v.unit || u, u) })).sort((a, b) => (a.date < b.date ? -1 : 1)), S.prog.bodyRange);
    const el = document.getElementById('ch-body');
    if (el) lineChart(el, pts, { color: PLATE.blue, empty: 'Log your body weight to start this chart.', tip: (p) => `<b>${fmtNum(p.y)} ${u}</b><span>${parseYmd(p.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>` });
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
function saveSettings() { S.db.saveSettings(S.user.uid, S.settings).catch(fail); }
function saveDaily(date, patch) {
  const cur = { ...(S.daily[date] || {}), ...patch, unit: unit() };
  for (const k of Object.keys(cur)) if (cur[k] === '' || cur[k] == null) delete cur[k];
  S.daily[date] = cur;
  S.db.saveDaily(S.user.uid, date, cur).catch(fail);
}

function startDay(dayId) {
  const r = routine();
  const day = r.days.find((d) => d.id === dayId);
  const active = S.sessions.find((s) => s.status === 'active');
  const go = () => {
    if (active) S.db.deleteSession(S.user.uid, active.id).catch(fail);
    const s = newSession(day, r, S.sessions, unit());
    S.db.saveSession(S.user.uid, s).catch(fail);
    S.sessions = [...S.sessions.filter((x) => x.id !== active?.id), s];
    S.sheet = null;
    if (day.rest) { toast('Rest day logged. Next up: ' + nextDay(r, S.sessions).name); render(); return; }
    S.draft = structuredClone(s);
    S.rest = null;
    render();
    window.scrollTo(0, 0);
  };
  if (active) confirmSheet(`Discard your unfinished ${active.dayName}?`, `Starting ${day.name} throws away the sets you logged in that workout.`, `Discard and start ${day.name}`, go);
  else go();
}

// ---------------------------------------------------------------- events
const ACT = {
  tab: (el) => { S.tab = el.dataset.v; if (el.dataset.mode) S.prog.mode = el.dataset.mode; render(); window.scrollTo(0, 0); },
  'auth-mode': () => { S.authMode = S.authMode === 'in' ? 'up' : 'in'; S.authMsg = ''; render(); },
  'auth-reset': async () => {
    const email = $app.querySelector('[name=email]').value.trim();
    if (!email) { S.authMsg = 'Type your email above, then tap Forgot password again.'; render(); return; }
    try { await S.db.resetPassword(email); S.authMsg = `Reset link sent to ${email}. Check your inbox and spam.`; } catch (e) { S.authMsg = AUTH_ERR[e.code] || e.message; }
    render();
  },
  start: (el) => startDay(el.dataset.day),
  resume: (el) => { const s = S.sessions.find((x) => x.id === el.dataset.id); if (s) { S.draft = structuredClone(s); render(); window.scrollTo(0, 0); } },
  'save-steps': () => {
    const v = num(document.getElementById('steps-today').value);
    const bw = num(document.getElementById('bw-today').value);
    saveDaily(ymd(), { steps: v === '' ? null : Math.round(v), bw: bw === '' ? null : bw });
    document.activeElement?.blur();
    toast('Saved');
    render();
  },
  'save-steps-date': () => {
    const d = document.getElementById('steps-date').value, v = num(document.getElementById('steps-val').value);
    if (!d || v === '') { toast('Pick a date and enter steps.'); return; }
    saveDaily(d, { steps: Math.round(v) }); toast(`Saved ${fmtInt(v)} steps for ${shortDate(d)}`); render();
  },
  'save-bw-date': () => {
    const d = document.getElementById('bw-date').value, v = num(document.getElementById('bw-val').value);
    if (!d || v === '') { toast('Pick a date and enter a weight.'); return; }
    saveDaily(d, { bw: v }); toast('Saved'); render();
  },

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
      S.draft = null; S.rest = null; S.tab = 'today';
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
  'warm-toggle': (el) => { const x = S.draft.warmup[el.dataset.i]; x.done = !x.done; persistDraft(); render(); },
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

  // history
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

  // progress
  'prog-mode': (el) => { S.prog.mode = el.dataset.v; render(); },
  'prog-metric': (el) => { S.prog.metric = el.dataset.v; render(); },
  'prog-range': (el) => { S.prog.range = el.dataset.v; render(); },
  'step-range': (el) => { S.prog.stepRange = Number(el.dataset.v); render(); },
  'body-range': (el) => { S.prog.bodyRange = el.dataset.v; render(); },

  // settings
  'set-unit': (el) => { S.settings.unit = el.dataset.v; saveSettings(); render(); },
  'set-rest': (el) => { S.settings.restSec = Number(el.dataset.v); saveSettings(); render(); },
  'ex-up': (el) => moveEx(el, -1),
  'ex-down': (el) => moveEx(el, 1),
  'ex-del': (el) => {
    const d = routine().days[el.dataset.day], e = d.exercises[el.dataset.ex];
    confirmSheet(`Remove ${e.name} from ${d.name}?`, 'Past sessions and charts for it are kept. You can add it back any time.', 'Remove', () => {
      d.exercises.splice(el.dataset.ex, 1); S.openDay = d.id; saveSettings(); render();
    });
  },
  'ex-add': (el) => {
    const d = routine().days[el.dataset.day];
    const input = document.getElementById(`add-ex-${el.dataset.day}`);
    const name = input.value.trim();
    if (!name) { toast('Type a name first.'); return; }
    // Reuse the id of an exercise with the same name (anywhere, including history) so its history carries over.
    const known = allExercises().find((e) => e.name.toLowerCase() === name.toLowerCase());
    let id = known?.id || slug(name);
    if (!known) { const taken = new Set(allExercises().map((e) => e.id)); let n = 2; const b = id; while (taken.has(id)) id = `${b}-${n++}`; }
    if (d.exercises.some((e) => e.id === id)) { toast(`${name} is already on this day.`); return; }
    d.exercises.push({ id, name, group: known?.group || d.name.split(' + ')[0] });
    S.openDay = d.id; input.value = ''; saveSettings(); render();
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
  S.openDay = d.id; saveSettings(); render();
}

document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-act]');
  if (!el || !$app.contains(el)) return;
  if (el.tagName === 'SELECT') return;
  const f = ACT[el.dataset.act];
  if (f) { if (el.dataset.act !== 'sheet-backdrop') ev.preventDefault(); f(el, ev); }
});

document.addEventListener('toggle', (ev) => {
  const d = ev.target;
  if (d.matches?.('details[data-day-id]')) S.openDay = d.open ? d.dataset.dayId : (S.openDay === d.dataset.dayId ? null : S.openDay);
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

// Typing into a field updates state quietly; no re-render until something discrete happens.
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
  }
});

document.addEventListener('change', (ev) => {
  const t = ev.target;
  if (t.dataset.actChange === 'prog-ex') { S.prog.exId = t.value; render(); return; }
  if (t.id === 'step-goal') { const v = num(t.value); if (v > 0) { S.settings.stepGoal = Math.round(v); saveSettings(); toast('Step goal saved'); } return; }
  if (t.dataset.warmDef != null) {
    const w = routine().warmup[t.dataset.warmDef];
    if (t.dataset.k === 'name') { if (t.value.trim()) w.name = t.value.trim(); } else { const v = num(t.value); if (v !== '') w.min = v; }
    saveSettings(); return;
  }
  if (t.dataset.day != null && t.dataset.k === 'name') { const d = routine().days[t.dataset.day]; if (t.value.trim()) { d.name = t.value.trim(); S.openDay = d.id; saveSettings(); } return; }
  if (t.dataset.day != null && t.dataset.k === 'exname') { const e = routine().days[t.dataset.day].exercises[t.dataset.ex]; if (t.value.trim()) { e.name = t.value.trim(); S.openDay = routine().days[t.dataset.day].id; saveSettings(); } return; }
  if (t.id === 'bw-today') { const v = num(t.value); saveDaily(ymd(), { bw: v === '' ? null : v }); }
});

document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && S.sheet) { S.sheet = null; render(); }
  if (ev.key === 'Enter' && ev.target.id === 'steps-today') ACT['save-steps']();
});

// Bring timers back in line after the phone was locked.
document.addEventListener('visibilitychange', () => { if (!document.hidden) updateTimers(); });

boot();
