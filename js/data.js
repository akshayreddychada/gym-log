// Default routine, rotation logic and the numbers behind progress charts.
import { DEFAULT_APT, DEFAULT_ABS, DEFAULT_SUPPS, muscleOf } from './library.js';
import { DEFAULT_PROFILE, DEFAULT_TARGETS } from './nutrition.js';

const ex = (id, name, group) => ({ id, name, group });

// Plate colours (competition bumper plates) give each training day its identity.
export const PLATE = {
  red: '#D8463B',
  blue: '#3F7CE0',
  yellow: '#E7B53A',
  green: '#3FA66B',
  white: '#C9CED6',
};

export const DEFAULT_ROUTINE = {
  days: [
    {
      id: 'chest', name: 'Chest + Abs', color: 'red',
      exercises: [
        ex('flat-bench', 'Flat bench press', 'Chest'),
        ex('incline-bench', 'Incline bench press', 'Chest'),
        ex('decline-bench', 'Decline bench press', 'Chest'),
        ex('chest-fly', 'Chest flys', 'Chest'),
        ex('ab-crunch', 'Ab crunch', 'Abs'),
        ex('leg-raise', 'Leg raises', 'Abs'),
      ],
    },
    {
      id: 'shoulders', name: 'Shoulders + Biceps', color: 'green',
      exercises: [
        ex('ohp', 'Overhead press', 'Shoulders'),
        ex('lateral-raise', 'Lateral raises', 'Shoulders'),
        ex('front-raise', 'Front raises', 'Shoulders'),
        ex('rear-delt-row', 'Rear delt row', 'Shoulders'),
        ex('preacher-curl', 'Preacher curl', 'Biceps'),
        ex('incline-curl', 'Incline curl', 'Biceps'),
        ex('hammer-curl', 'Hammer curl', 'Biceps'),
        ex('zottman-curl', 'Zottman curl', 'Biceps'),
      ],
    },
    {
      id: 'legs', name: 'Legs + Abs', color: 'yellow',
      exercises: [
        ex('squat', 'Squat', 'Legs'),
        ex('leg-press', 'Leg press', 'Legs'),
        ex('ham-curl', 'Hamstring curl', 'Legs'),
        ex('calf-raise', 'Calf raises', 'Legs'),
        ex('hip-thrust', 'Hip thrust', 'Glutes'),
        ex('adductor', 'Inner thigh (adductor)', 'Legs'),
        ex('abductor', 'Outer thigh (abductor)', 'Glutes'),
        ex('leg-ext', 'Leg extension', 'Legs'),
        ex('ab-crunch', 'Ab crunch', 'Abs'),
        ex('leg-raise', 'Leg raises', 'Abs'),
      ],
    },
    {
      id: 'back', name: 'Back + Triceps', color: 'blue',
      exercises: [
        ex('seated-row', 'Seated row', 'Back'),
        ex('face-pull', 'Face pulls', 'Back'),
        ex('cs-row', 'Chest-supported row', 'Back'),
        ex('lat-pulldown', 'Lat pulldown', 'Back'),
        ex('dips', 'Dips', 'Triceps'),
        ex('oh-ext', 'Overhead extension', 'Triceps'),
        ex('pushdown', 'Cable pushdown', 'Triceps'),
        ex('jm-press', 'JM press', 'Triceps'),
      ],
    },
    { id: 'rest', name: 'Rest day', color: 'white', rest: true, exercises: [] },
  ],
  warmup: [
    { id: 'apt', name: 'Anterior pelvic tilt fix', min: 20 },
    { id: 'walk', name: 'Incline walk', min: 20, incline: 4, speed: 3 },
  ],
};

export const DEFAULT_SETTINGS = {
  unit: 'lb',
  waterUnit: 'oz',
  restSec: 90,
  stepGoal: 10000,
  routine: DEFAULT_ROUTINE,
  profile: { ...DEFAULT_PROFILE },
  targets: { ...DEFAULT_TARGETS },
  supps: DEFAULT_SUPPS.map((s) => ({ ...s, on: true })),
  apt: DEFAULT_APT.map((x) => ({ ...x })),
  abs: DEFAULT_ABS.map((x) => ({ ...x })),
  customFoods: [],
  favFoods: [],
};

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'ex';

// ---------- dates (local calendar days, stored as YYYY-MM-DD) ----------
export function ymd(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
export function parseYmd(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function addDays(s, n) {
  const d = parseYmd(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
}
export function daysBetween(a, b) {
  return Math.round((parseYmd(b) - parseYmd(a)) / 86400000);
}

// ---------- rotation ----------
// The next day in the cycle follows whatever was logged last, so a missed
// day never throws the split out of order.
export function nextDay(routine, sessions) {
  const days = routine.days;
  // Custom (body-map) workouts don't move the split forward.
  const done = sessions.filter((s) => s.status === 'done' && days.some((d) => d.id === s.dayId)).sort(bySessionTime);
  const last = done[done.length - 1];
  if (!last) return days[0];
  const i = days.findIndex((d) => d.id === last.dayId);
  return days[(i + 1) % days.length] || days[0];
}

export function bySessionTime(a, b) {
  return a.date === b.date ? (a.startedAt || 0) - (b.startedAt || 0) : a.date < b.date ? -1 : 1;
}

// ---------- weights ----------
export const LB_PER_KG = 2.20462;
export function convert(w, from, to) {
  if (w == null || w === '' || from === to) return w;
  const v = from === 'kg' ? w * LB_PER_KG : w / LB_PER_KG;
  return Math.round(v * 2) / 2;
}
export function fmtW(w) {
  if (w == null || w === '') return '–';
  if (Number(w) === 0) return 'BW';
  return String(Math.round(w * 10) / 10);
}
// Epley estimate. Above 12 reps the estimate stops meaning much, so cap it.
export function e1rm(w, r) {
  if (!w || !r) return 0;
  return w * (1 + Math.min(r, 12) / 30);
}

export function doneSets(exercise) {
  return (exercise.sets || []).filter((s) => s.done && Number(s.r) > 0);
}

export function sessionStats(s, unit) {
  let sets = 0, volume = 0, reps = 0;
  for (const e of s.exercises || []) {
    for (const st of doneSets(e)) {
      const w = convert(Number(st.w) || 0, s.unit || unit, unit);
      sets++;
      reps += Number(st.r);
      volume += w * Number(st.r);
    }
  }
  const minutes = s.finishedAt && s.startedAt ? Math.round((s.finishedAt - s.startedAt) / 60000) : null;
  return { sets, volume: Math.round(volume), reps, minutes };
}

// One point per finished session in which the exercise had at least one done set.
export function exerciseHistory(sessions, exId, unit) {
  const out = [];
  for (const s of [...sessions].filter((x) => x.status === 'done').sort(bySessionTime)) {
    const e = (s.exercises || []).find((x) => x.id === exId);
    if (!e) continue;
    const sets = doneSets(e).map((st) => ({ w: convert(Number(st.w) || 0, s.unit || unit, unit), r: Number(st.r) }));
    if (!sets.length) continue;
    let top = sets[0], best1rm = 0, volume = 0, maxReps = 0;
    for (const st of sets) {
      if (st.w > top.w || (st.w === top.w && st.r > top.r)) top = st;
      best1rm = Math.max(best1rm, e1rm(st.w, st.r));
      volume += st.w * st.r;
      maxReps = Math.max(maxReps, st.r);
    }
    out.push({ date: s.date, sessionId: s.id, sets, top, e1rm: Math.round(best1rm * 10) / 10, volume: Math.round(volume), maxReps });
  }
  return out;
}

// Most recent finished sets for an exercise, excluding a given session.
export function lastSetsFor(sessions, exId, excludeId) {
  const done = sessions.filter((s) => s.status === 'done' && s.id !== excludeId).sort(bySessionTime);
  for (let i = done.length - 1; i >= 0; i--) {
    const e = (done[i].exercises || []).find((x) => x.id === exId);
    if (e && doneSets(e).length) return { session: done[i], sets: doneSets(e) };
  }
  return null;
}

export function bestE1rm(sessions, exId, unit, excludeId) {
  let best = 0;
  for (const s of sessions) {
    if (s.status !== 'done' || s.id === excludeId) continue;
    const e = (s.exercises || []).find((x) => x.id === exId);
    if (!e) continue;
    for (const st of doneSets(e)) best = Math.max(best, e1rm(convert(Number(st.w) || 0, s.unit || unit, unit), Number(st.r)));
  }
  return best;
}

// Builds a fresh session for a day, prefilled with last time's numbers.
// opts.exercises / opts.muscles override the day's list (body-map workouts).
export function newSession(day, routine, sessions, unit, opts = {}) {
  const list = opts.exercises || day.exercises;
  const exercises = list.map((e) => {
    const last = lastSetsFor(sessions, e.id);
    const sets = last
      ? last.sets.map((st) => ({ w: convert(Number(st.w) || 0, last.session.unit || unit, unit), r: Number(st.r), done: false }))
      : [0, 1, 2].map(() => ({ w: '', r: 10, done: false }));
    return { id: e.id, name: e.name, group: e.group || '', muscle: muscleOf(e), sets };
  });
  const warm = day.rest || opts.warmup === false ? [] : routine.warmup;
  return {
    id: uid(),
    date: opts.date || ymd(),
    muscles: opts.muscles || [...new Set(exercises.map((e) => e.muscle).filter(Boolean))],
    dayId: day.id,
    dayName: day.name,
    color: day.color,
    unit,
    status: day.rest ? 'done' : 'active',
    startedAt: Date.now(),
    finishedAt: day.rest ? Date.now() : null,
    rest: !!day.rest,
    // Warm-up numbers (minutes, incline, speed) carry over from last time.
    warmup: warm.map((w) => {
      const prev = [...sessions].filter((s) => s.status === 'done').sort(bySessionTime).reverse()
        .flatMap((s) => s.warmup || []).find((x) => x.id === w.id && x.done);
      return { ...w, ...(prev ? { min: prev.min, incline: prev.incline, speed: prev.speed } : {}), name: w.name, done: false };
    }),
    exercises,
  };
}

// Monday-start week key for weekly roll-ups.
export function weekStart(s) {
  const d = parseYmd(s);
  const dow = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dow);
  return ymd(d);
}

export function streakDays(sessions) {
  // Consecutive cycle adherence: count days back from today where something
  // (training or rest) was logged, allowing today to still be open.
  const dates = new Set(sessions.filter((s) => s.status === 'done').map((s) => s.date));
  let d = ymd();
  if (!dates.has(d)) d = addDays(d, -1);
  let n = 0;
  while (dates.has(d)) { n++; d = addDays(d, -1); }
  return n;
}

// Most recent date each muscle had a finished set.
export function muscleLastTrained(sessions) {
  const out = {};
  for (const s of sessions) {
    if (s.status !== 'done' || s.rest) continue;
    for (const e of s.exercises || []) {
      const m = muscleOf(e);
      if (m && doneSets(e).length && (!out[m] || out[m] < s.date)) out[m] = s.date;
    }
  }
  return out;
}

// Done sets per muscle across sessions in [from, to].
export function setsByMuscle(sessions, from, to) {
  const out = {};
  for (const s of sessions) {
    if (s.status !== 'done' || s.rest || s.date < from || s.date > to) continue;
    for (const e of s.exercises || []) { const m = muscleOf(e); if (m) out[m] = (out[m] || 0) + doneSets(e).length; }
  }
  return out;
}
