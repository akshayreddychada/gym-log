// The birthday cut: Nov 20, 2026 → Feb 26, 2027 (99 days).
// Everything here is pure (no DOM, no storage) so it can be tested from Node.
import { FOODS } from './foods.js';
import { addDays, daysBetween, parseYmd } from './data.js';
import { libById } from './library.js';

export const JOURNEY_DEFAULTS = {
  on: true,
  start: '2026-11-20',
  end: '2027-02-26',
  startKg: 79,
  goalKg: 69,
  maintenance: 2650,
  legsFrom: '2026-12-03', // foot injury: no leg training before this date
  trainTime: 'evening',
  calAdj: 0, // running total of check-in adjustments
  shifts: [], // [{ from: 'YYYY-MM-DD', n: 1 }] when a day was missed
  checkins: {},
};

// ---------------------------------------------------------------- calorie & macro targets
export const PROTEIN = 170;
export const FAT = 60;
export const KCAL = { train: 2050, rest: 1700 };
export const FLEX_DAYS = ['2026-12-25', '2026-12-31'];
export const CHECKIN_DAYS = [14, 28, 42, 56, 70, 84];

export function dayTargets(type, j) {
  const flex = type === 'flex';
  // Floors: never below 1,600 on rest days or 1,850 on training days, whatever the check-ins say.
  const kcal = flex ? j.maintenance : Math.max(type === 'rest' ? 1600 : 1850, (type === 'rest' ? KCAL.rest : KCAL.train) + (j.calAdj || 0));
  const p = PROTEIN, f = flex ? 75 : FAT;
  const c = Math.round((kcal - p * 4 - f * 9) / 4);
  return { kcal, p, f, c, fib: 35, waterMl: 3500 };
}

// ---------------------------------------------------------------- split
const E = (id, sets, reps, note = '') => ({ id, sets, reps, note });
export const SPLIT = {
  push: {
    id: 'push', name: 'Push', color: 'red', focus: 'Chest, shoulders, triceps',
    exercises: [E('flat-bench', 3, '6–10'), E('incline-bench', 3, '8–12'), E('ohp', 3, '8–10'), E('chest-fly', 2, '12–15'),
      E('lateral-raise', 3, '12–15'), E('pushdown', 3, '10–12'), E('oh-ext', 2, '10–12')],
  },
  pull: {
    id: 'pull', name: 'Pull', color: 'blue', focus: 'Lats, upper back, rear delts, biceps',
    exercises: [E('lat-pulldown', 3, '8–12'), E('seated-row', 3, '8–12'), E('cs-row', 3, '10–12'), E('face-pull', 3, '12–15'),
      E('rear-delt-row', 2, '12–15'), E('preacher-curl', 3, '10–12'), E('hammer-curl', 2, '10–12')],
  },
  quads: {
    id: 'quads', name: 'Quads', color: 'yellow', focus: 'Quads, inner thigh, calves, abs',
    exercises: [E('squat', 3, '6–10'), E('leg-press', 3, '10–12'), E('leg-ext', 3, '12–15'), E('adductor', 2, '12–15'),
      E('calf-raise', 3, '12–15'), E('ab-crunch', 3, '12–15')],
  },
  upper: {
    id: 'upper', name: 'Upper', color: 'green', focus: 'Chest, back, shoulders, arms',
    exercises: [E('decline-bench', 3, '8–10'), E('cs-row', 3, '8–12'), E('dips', 3, '8–12'), E('lateral-raise', 3, '12–15'),
      E('front-raise', 2, '12–15'), E('jm-press', 2, '8–10'), E('incline-curl', 2, '10–12'), E('zottman-curl', 2, '10–12')],
  },
  hams: {
    id: 'hams', name: 'Hamstrings', color: 'yellow', focus: 'Hamstrings, glutes, outer thigh, calves, abs',
    exercises: [E('rdl', 3, '8–10'), E('ham-curl', 3, '10–12'), E('hip-thrust', 3, '8–12'), E('abductor', 2, '12–15'),
      E('calf-raise', 3, '12–15'), E('leg-raise', 3, '12–15')],
  },
  rest: { id: 'rest', name: 'Rest day', color: 'white', rest: true, focus: 'Walk, posture routine, sleep', exercises: [] },
  // Foot-injury swaps: seated or supported only, nothing loaded through the feet.
  arms: {
    id: 'arms', name: 'Arms + Core', color: 'green', focus: 'Seated arm work while your foot heals', injury: true,
    exercises: [E('preacher-curl', 3, '10–12'), E('incline-curl', 3, '10–12', 'Seated on an incline bench'), E('hammer-curl', 2, '10–12', 'Seated'),
      E('pushdown', 3, '10–12'), E('oh-ext', 3, '10–12', 'Seated, cable or dumbbell'), E('jm-press', 2, '8–10'), E('ab-crunch', 3, '12–15'), E('leg-raise', 3, '10–12', 'Lying down')],
  },
  delts: {
    id: 'delts', name: 'Shoulders + Back', color: 'blue', focus: 'Seated shoulder and back work while your foot heals', injury: true,
    exercises: [E('ohp', 3, '8–10', 'Seated dumbbell press'), E('lateral-raise', 3, '12–15', 'Seated'), E('rear-delt-row', 3, '12–15'), E('face-pull', 3, '12–15', 'Kneeling or seated'),
      E('lat-pulldown', 3, '8–12'), E('cs-row', 2, '10–12'), E('ab-crunch', 3, '12–15')],
  },
};
export const CYCLE = ['push', 'pull', 'quads', 'rest', 'upper', 'hams'];
const LEG_DAYS = { quads: 'arms', hams: 'delts' };

// ---------------------------------------------------------------- phases
export function phaseOf(n) {
  if (n <= 14) return { id: 'ramp', name: 'Ease back in', weeks: 'Weeks 1–2', effort: 'Use about 70–80% of your old weights and stop 3 reps short of failure. Your joints and tendons need two weeks to catch up with your muscles.' };
  if (n <= 56) return { id: 'build', name: 'Build', weeks: 'Weeks 3–8', effort: 'Full sets. End each set with 1–2 reps left. Beat last time by one rep or one weight jump.' };
  if (n <= 63) return { id: 'deload', name: 'Deload week', weeks: 'Week 9', effort: 'Same weights, about 40% fewer sets, nothing to failure. Recovery week so the last push lands.' };
  return { id: 'push', name: 'Final push', weeks: 'Weeks 10–15', effort: 'Full sets. Take the last set of each exercise to 0–1 reps left. Hold your strength while the scale drops.' };
}

export function setsFor(base, phase, firstLegWeek) {
  if (phase.id === 'ramp' || firstLegWeek) return Math.max(2, base - 1);
  if (phase.id === 'deload') return Math.max(1, Math.round(base * 0.6));
  return base;
}

// ---------------------------------------------------------------- calendar
export const dayNumber = (j, date) => daysBetween(j.start, date) + 1;
export const totalDays = (j) => daysBetween(j.start, j.end) + 1;
export const inJourney = (j, date) => j?.on && date >= j.start && date <= j.end;

export function planFor(j, date) {
  const n = dayNumber(j, date);
  const shift = (j.shifts || []).filter((s) => s.from <= date).reduce((a, s) => a + s.n, 0);
  const idx = (((n - 1 - shift) % CYCLE.length) + CYCLE.length) % CYCLE.length;
  let type = CYCLE[idx];
  const legsOut = date < j.legsFrom;
  let base = SPLIT[type];
  if (legsOut && LEG_DAYS[type]) base = SPLIT[LEG_DAYS[type]];
  const birthday = date === j.end;
  if (birthday) base = { ...SPLIT.rest, name: 'Birthday weigh-in', focus: 'Weigh in, take photos, celebrate' };
  const phase = phaseOf(n);
  const firstLegWeek = !base.rest && !base.injury && LEG_DAYS[type] && daysBetween(j.legsFrom, date) < 10 && date >= j.legsFrom;
  const flex = FLEX_DAYS.includes(date);
  const kind = flex ? 'flex' : base.rest ? 'rest' : 'train';
  const workout = base.rest ? null : {
    ...base,
    exercises: base.exercises.map((e) => ({ ...e, sets: setsFor(e.sets, phase, firstLegWeek) })),
  };
  const tags = [];
  if (CHECKIN_DAYS.includes(n)) tags.push(n === 14 ? 'First look' : 'Check-in');
  if (flex) tags.push('Flex day');
  if (phase.id === 'deload' && !base.rest) tags.push('Deload');
  if (firstLegWeek) tags.push('Legs back');
  if (base.injury) tags.push('Foot-safe');
  if (birthday) tags.push('Birthday');
  return {
    date, n, total: totalDays(j), type: base.id, kind, phase, workout, day: base, tags, birthday, flex,
    legsOut, firstLegWeek,
    steps: legsOut ? 'Only pain-free walking' : '10,000–12,000 steps',
    stepGoal: legsOut ? 6000 : 11000,
    targets: dayTargets(kind, j),
    walkWarmup: !legsOut,
  };
}

// Target weight on a date: a straight line from start to goal.
export function targetKg(j, date) {
  const t = Math.min(1, Math.max(0, daysBetween(j.start, date) / daysBetween(j.start, j.end)));
  return Math.round((j.startKg + (j.goalKg - j.startKg) * t) * 10) / 10;
}

// ---------------------------------------------------------------- meals
// Each item: [foodId, grams]. Items marked as the meal's carb source get scaled
// so the day lands on its calorie target. 'whey' is a scoop from Supplements.
const M = (id, name, items, carb, note = '') => ({ id, name, items, carb, note });
export const MEAL_OPTIONS = {
  breakfast: [
    M('b-omelette', 'Veggie omelette + sourdough', [['egg', 100], ['egg-white', 132], ['spinach', 30], ['bell-pepper', 60], ['onion', 30], ['avocado', 35], ['strawberries', 150]], 'sourdough', '2 whole eggs + 4 whites, cooked in a non-stick pan with spray oil'),
    M('b-oats', 'Protein oats + egg whites', [['whey', 1], ['chia', 12], ['blueberries', 100], ['almonds', 10], ['egg-white', 66]], 'oats', 'Stir the whey in after cooking, top with chopped almonds. 2 egg whites scrambled on the side.'),
    M('b-bhurji', 'Paneer + egg white bhurji, sourdough', [['paneer', 70], ['egg-white', 132], ['tomato', 60], ['onion', 40], ['spinach', 30], ['guava', 110]], 'sourdough', 'Crumble paneer into the whites with onion, tomato and spices'),
    M('b-avo', 'Eggs + avocado on sourdough', [['egg', 100], ['egg-white', 132], ['avocado', 50], ['tomato', 60], ['orange', 130]], 'sourdough', 'Boiled or poached eggs on the toast, 4 scrambled whites on the side'),
  ],
  lunch: [
    M('l-chicken-rice', 'Chicken rice bowl', [['chicken-breast', 140], ['broccoli', 150], ['bell-pepper', 60], ['green-beans', 100], ['olive-oil', 9]], 'basmati', 'Grilled chicken, broccoli and beans tossed in 2 tsp olive oil'),
    M('l-fish-quinoa', 'Fish + quinoa salad bowl', [['tilapia', 160], ['salad-greens', 85], ['cucumber', 100], ['tomato', 60], ['avocado', 35], ['pumpkin-seeds', 9]], 'quinoa', 'Lemon, chilli and herbs as dressing'),
    M('l-chicken-millet', 'Chicken, millet + sabzi', [['chicken-breast', 140], ['mixed-sabzi', 150], ['cucumber', 100], ['onion', 30], ['olive-oil', 4.5]], 'millet', 'Light-oil sabzi, cucumber-onion salad'),
    M('l-shrimp', 'Shrimp veg stir-fry + rice', [['shrimp', 180], ['broccoli', 80], ['bell-pepper', 80], ['mushroom', 70], ['zucchini', 100], ['olive-oil', 9]], 'basmati', '2 tsp oil, garlic, ginger, soy or chilli sauce'),
  ],
  snack: [
    M('s-whey-banana', 'Whey shake + banana + almonds', [['whey', 1], ['banana', 118], ['almonds', 15]], null, 'Whey in water'),
    M('s-chicken-toast', 'Chicken + cucumber on sourdough', [['chicken-breast', 80], ['cucumber', 100], ['avocado', 35]], 'sourdough', 'Leftover grilled chicken, mashed avocado as the spread'),
    M('s-eggs-fruit', 'Boiled eggs + whites + papaya', [['egg', 100], ['egg-white', 165], ['papaya', 200]], null, 'Boil a batch for the week'),
    M('s-whey-apple', 'Whey shake + apple + pumpkin seeds', [['whey', 1], ['apple', 182], ['pumpkin-seeds', 10]], null, 'Whey in water'),
  ],
  dinner: [
    M('d-salmon', 'Salmon, quinoa + asparagus', [['salmon', 130], ['egg-white', 99], ['asparagus', 120], ['salad-greens', 85]], 'quinoa', 'Bake the salmon. 3 scrambled whites on the side or stirred into the quinoa.'),
    M('d-tandoori', 'Tandoori chicken, rice + salad', [['tandoori-chicken', 170], ['mixed-sabzi', 150], ['salad-greens', 85], ['cucumber', 100], ['tomato', 60]], 'basmati', 'Oven or air-fryer tandoori, no skin'),
    M('d-fish-millet', 'White fish, millet + green beans', [['tilapia', 180], ['green-beans', 120], ['olive-oil', 9], ['avocado', 35]], 'millet', 'Pan-sear the fish in 2 tsp oil'),
    M('d-paneer-chicken', 'Chicken + paneer tikka plate', [['chicken-breast', 110], ['paneer', 50], ['bell-pepper', 80], ['onion', 50], ['cauliflower', 150], ['salad-greens', 85]], 'basmati', 'Skewered and grilled, roasted gobi on the side'),
  ],
};
export const WHEY = { kcal: 120, p: 24, c: 3, f: 1.5, fib: 0 };

const foodMap = Object.fromEntries(FOODS.map((f) => [f.id, f]));
function itemMacros(id, g) {
  if (id === 'whey') return { ...WHEY, g: 30 };
  const f = foodMap[id];
  if (!f) throw new Error('Unknown food ' + id);
  const k = g / 100;
  return { g, kcal: f.kcal * k, p: f.p * k, c: f.c * k, f: f.f * k, fib: f.fib * k };
}
const CARB_LIMITS = { sourdough: [25, 125, 5], oats: [30, 90, 5], basmati: [60, 330, 10], quinoa: [60, 330, 10], millet: [60, 330, 10] };

// Meal slots and times. Pre-workout snack and post-workout dinner on training days.
export function slotsFor(trainTime, kind) {
  const train = kind === 'train';
  if (trainTime === 'morning') return [
    ...(train ? [{ slot: 'pre', meal: 'snack', time: '6:15 AM', label: 'Pre-workout', opt: null, light: true }] : []),
    { slot: 'breakfast', meal: 'breakfast', time: train ? '8:45 AM' : '8:00 AM', label: train ? 'Breakfast (post-workout)' : 'Breakfast' },
    { slot: 'lunch', meal: 'lunch', time: '1:00 PM', label: 'Lunch' },
    { slot: 'snack', meal: 'snack', time: '4:30 PM', label: 'Afternoon snack' },
    { slot: 'dinner', meal: 'dinner', time: '8:00 PM', label: 'Dinner' },
  ];
  return [
    { slot: 'breakfast', meal: 'breakfast', time: '7:30 AM', label: 'Breakfast' },
    { slot: 'lunch', meal: 'lunch', time: '12:30 PM', label: 'Lunch' },
    { slot: 'snack', meal: 'snack', time: train ? '4:30 PM' : '4:00 PM', label: train ? 'Pre-workout snack' : 'Afternoon snack' },
    { slot: 'dinner', meal: 'dinner', time: train ? '8:00 PM' : '7:30 PM', label: train ? 'Dinner (post-workout)' : 'Dinner' },
  ];
}
// Share of the day's flexible carb calories per slot.
const CARB_SHARE = {
  train: { breakfast: 0.25, lunch: 0.3, snack: 0.15, dinner: 0.3 },
  rest: { breakfast: 0.35, lunch: 0.4, snack: 0.0, dinner: 0.25 },
};

// Pick the default option for each slot by rotating with the day number; swaps override.
export function mealChoices(n, swaps = {}) {
  const k = (slot, off) => (swaps[slot] != null ? swaps[slot] : (n + off) % MEAL_OPTIONS[slot].length);
  return { breakfast: k('breakfast', 0), lunch: k('lunch', 1), snack: k('snack', 3), dinner: k('dinner', 2) };
}

// Builds the day's meals with gram amounts that hit the calorie target.
export const FLEX_TREAT = 600;
// locked: { slot: carb grams } for meals already eaten, so only the rest re-balance.
export function buildMeals(plan, trainTime = 'evening', swaps = {}, locked = {}) {
  const kind = plan.kind === 'flex' ? 'train' : plan.kind;
  // Flex days follow the normal plan; the extra ~600 kcal is a holiday meal of your choice.
  const t = plan.kind === 'flex' ? { ...plan.targets, kcal: plan.targets.kcal - FLEX_TREAT } : plan.targets;
  const choice = mealChoices(plan.n, swaps);
  const slots = slotsFor(trainTime, kind);
  const meals = slots.filter((s) => s.slot !== 'pre').map((s) => {
    const o = MEAL_OPTIONS[s.slot][choice[s.slot]];
    return { ...s, option: o, optIndex: choice[s.slot], items: o.items.map(([id, g]) => ({ id, g })) };
  });
  // Fixed calories from everything except carb sources.
  let fixed = 0;
  for (const m of meals) for (const it of m.items) fixed += itemMacros(it.id, it.g).kcal;
  // Morning trainers get a small pre-workout of fruit, taken from the snack's share.
  const pre = slots.find((s) => s.slot === 'pre');
  if (pre) fixed += itemMacros('banana', 118).kcal;
  let left = t.kcal - fixed;
  const share = CARB_SHARE[kind];
  const allCarb = meals.filter((m) => m.option.carb);
  for (const m of allCarb) if (locked[m.slot] != null) { m.carbG = locked[m.slot]; left -= (foodMap[m.option.carb].kcal / 100) * m.carbG; }
  const carbMeals = allCarb.filter((m) => locked[m.slot] == null);
  const shareSum = carbMeals.reduce((a, m) => a + (share[m.slot] || 0.1), 0) || 1;
  for (const m of carbMeals) {
    const id = m.option.carb, [lo, hi, step] = CARB_LIMITS[id];
    const kcalPer = foodMap[id].kcal / 100;
    const want = (left * ((share[m.slot] || 0.1) / shareSum)) / kcalPer;
    m.carbG = Math.min(hi, Math.max(lo, Math.round(want / step) * step));
  }
  // One correction pass on the biggest carb meal to absorb rounding and limits.
  const tot0 = totals(meals, pre);
  const big = [...carbMeals].sort((a, b) => b.carbG - a.carbG)[0];
  if (big) {
    const [lo, hi, step] = CARB_LIMITS[big.option.carb];
    const kcalPer = foodMap[big.option.carb].kcal / 100;
    big.carbG = Math.min(hi, Math.max(lo, Math.round((big.carbG + (t.kcal - tot0.kcal) / kcalPer) / step) * step));
  }
  for (const m of allCarb) m.items = [...m.items, { id: m.option.carb, g: m.carbG, carb: true }];
  const out = meals.map((m) => ({ ...m, macros: sumItems(m.items) }));
  if (pre) out.unshift({ ...pre, option: { id: 'pre', name: 'Banana + black coffee', note: 'Small and fast. The protein comes right after you train.' }, items: [{ id: 'banana', g: 118 }, { id: 'black-coffee', g: 240 }], macros: sumItems([{ id: 'banana', g: 118 }, { id: 'black-coffee', g: 240 }]) });
  out.sort((a, b) => toMin(a.time) - toMin(b.time));
  return { meals: out, total: sumItems(out.flatMap((m) => m.items)) };
}
const toMin = (t) => { const [hm, ap] = t.split(' '); const [h, m] = hm.split(':').map(Number); return ((h % 12) + (ap === 'PM' ? 12 : 0)) * 60 + m; };
function sumItems(items) {
  const s = { kcal: 0, p: 0, c: 0, f: 0, fib: 0 };
  for (const it of items) { const m = itemMacros(it.id, it.g); for (const k in s) s[k] += m[k]; }
  for (const k in s) s[k] = Math.round(s[k] * 10) / 10;
  s.kcal = Math.round(s.kcal);
  return s;
}
function totals(meals, pre) {
  const items = meals.flatMap((m) => [...m.items, ...(m.carbG ? [{ id: m.option.carb, g: m.carbG }] : [])]);
  if (pre) items.push({ id: 'banana', g: 118 });
  return sumItems(items);
}
export const itemName = (id) => (id === 'whey' ? 'Whey protein' : foodMap[id]?.name || id);
// Friendly amount: eggs as counts, slices for bread, scoops for whey.
export function itemAmount(id, g) {
  if (id === 'whey') return `${g} scoop`;
  if (id === 'egg') return `${Math.round(g / 50)} whole`;
  if (id === 'egg-white') return `${Math.round(g / 33)} whites`;
  if (id === 'sourdough') { const sl = Math.round((g / 50) * 2) / 2; return `${sl} slice${sl === 1 ? '' : 's'} (${g} g)`; }
  if (id === 'olive-oil') return `${Math.round((g / 4.5) * 2) / 2} tsp`;
  if (id === 'banana') return '1 medium';
  if (id === 'apple') return '1 medium';
  if (id === 'orange') return '1 medium';
  if (id === 'black-coffee') return '1 cup';
  return `${Math.round(g)} g`;
}

// ---------------------------------------------------------------- groceries
// Cooked → what to buy. Meat and fish lose ~25% cooking; rice/quinoa/millet triple when cooked.
const RAW = { 'chicken-breast': [1.33, 'raw'], 'tandoori-chicken': [1.33, 'raw chicken'], tilapia: [1.25, 'raw'], salmon: [1.25, 'raw'], shrimp: [1.2, 'raw'], basmati: [1 / 3, 'dry'], quinoa: [1 / 2.7, 'dry'], millet: [1 / 3.3, 'dry'] };
export function groceries(plans, trainTime, swapsByDate = {}) {
  const sum = {};
  for (const p of plans) for (const m of buildMeals(p, trainTime, swapsByDate[p.date] || {}).meals) for (const it of m.items) sum[it.id] = (sum[it.id] || 0) + (it.id === 'whey' ? it.g : it.g);
  return Object.entries(sum).map(([id, g]) => {
    const f = foodMap[id];
    const raw = RAW[id];
    let buy;
    if (id === 'whey') buy = `${g} scoops`;
    else if (id === 'egg') buy = `${Math.ceil(g / 50)} eggs`;
    else if (id === 'egg-white') buy = `${Math.ceil(g / 33)} whites, or ${fmtKg(g)} liquid whites`;
    else if (id === 'sourdough') buy = `${Math.ceil(g / 50)} slices`;
    else if (['banana', 'apple', 'orange'].includes(id)) buy = `${Math.round(g / (id === 'banana' ? 118 : id === 'apple' ? 182 : 130))}`;
    else if (id === 'olive-oil') buy = `${Math.round(g / 4.5)} tsp`;
    else if (raw) buy = `${fmtKg(g * raw[0])} ${raw[1]}`;
    else buy = fmtKg(g);
    return { id, name: itemName(id), cat: id === 'whey' ? 'protein' : f?.cat || 'other', g, buy, cooked: !!raw && raw[1] !== 'dry' };
  }).sort((a, b) => (a.cat === b.cat ? b.g - a.g : a.cat < b.cat ? -1 : 1));
}
const fmtKg = (g) => (g >= 1000 ? `${Math.round(g / 100) / 10} kg` : `${Math.round(g / 10) * 10} g`);

// ---------------------------------------------------------------- check-ins
// weights: [{date, kg}] sorted. liftDrop: number of exercises whose best estimated 1RM fell >3%.
export function checkinAdvice(n, weights, liftDrop, j, date) {
  const win = (a, b) => weights.filter((w) => w.date > addDays(date, -b) && w.date <= addDays(date, -a));
  const last = win(0, 7), prev = win(7, 14);
  const avg = (a) => a.reduce((x, w) => x + w.kg, 0) / a.length;
  if (last.length < 3 || prev.length < 3) return { status: 'data', title: 'Not enough weigh-ins yet', body: 'Weigh yourself at least 3 mornings a week, after the bathroom and before food or water. The check-in compares your last two weekly averages.', adj: 0 };
  const rate = Math.round((avg(prev) - avg(last)) * 100) / 100;
  const nowAvg = Math.round(avg(last) * 10) / 10;
  const target = targetKg(j, date);
  const base = { rate, nowAvg, target };
  if (n <= 14) return { ...base, status: 'info', title: 'First look: don’t change anything yet', body: `You’re losing about ${fmt(rate)} kg a week. In the first weeks back, your muscles store extra water and carbs, which hides fat loss. Keep the plan as it is. The first real adjustment is at day 28.`, adj: 0 };
  if (rate < 0.5 && (j.calAdj || 0) <= -200) return { ...base, status: 'cut', title: `Losing ${fmt(rate)} kg a week, under 0.5`, body: 'Calories are already as low as this plan goes. Add 2,000–3,000 steps a day instead, and check the hidden calories: oil, sauces, drinks, weekend meals.', adj: 0 };
  if (rate < 0.5) return { ...base, status: 'cut', title: `Losing ${fmt(rate)} kg a week, under 0.5`, body: 'Eat 100 kcal less each day (about 25 g fewer carbs), or add 2,000–3,000 steps a day. Protein stays at 170 g.', adj: -100 };
  if (rate > 1.0 && liftDrop >= 3) return { ...base, status: 'add', title: `Losing ${fmt(rate)} kg a week and lifts are dropping`, body: 'You’re losing too fast and it’s costing strength. Eat 150 kcal more each day, all from carbs, ideally around training.', adj: 150 };
  if (liftDrop >= 3) return { ...base, status: 'add', title: `${liftDrop} lifts went down`, body: 'Your weight loss is fine, but several lifts dropped. Add 100 kcal of carbs on training days, and check you’re sleeping 7+ hours.', adj: 100 };
  return { ...base, status: 'ok', title: `On track: ${fmt(rate)} kg a week`, body: 'Weight is dropping at a good pace and your lifts are holding. Change nothing.', adj: 0 };
}
const fmt = (v) => String(Math.round(v * 100) / 100);

export const daysToGo = (j, date) => Math.max(0, daysBetween(date, j.end));
export const birthdayLabel = (j) => parseYmd(j.end).toLocaleDateString(undefined, { month: 'long', day: 'numeric' });

// ---------------------------------------------------------------- routine for the Train tab
export function routineFromSplit(warmup) {
  const day = (id) => {
    const d = SPLIT[id];
    return { id, name: d.name, color: d.color, ...(d.rest ? { rest: true } : {}), exercises: d.exercises.map((e) => ({ id: e.id, name: libById[e.id]?.name || e.id, group: '', muscle: libById[e.id]?.muscle })) };
  };
  return { days: CYCLE.map(day), warmup };
}
// Sets × reps for an exercise on a split day (falls back to 3 × 8–12 for ones you added).
export function prescription(type, exId) {
  return SPLIT[type]?.exercises.find((e) => e.id === exId) || Object.values(SPLIT).flatMap((d) => d.exercises).find((e) => e.id === exId) || { id: exId, sets: 3, reps: '8–12' };
}
