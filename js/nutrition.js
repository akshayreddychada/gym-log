// Daily nutrition totals and personal targets.
const LB_PER_KG = 2.20462;

export const MEALS = [
  { id: 'breakfast', name: 'Breakfast' },
  { id: 'lunch', name: 'Lunch' },
  { id: 'snack', name: 'Snacks' },
  { id: 'dinner', name: 'Dinner' },
];

export const ML_PER_OZ = 29.5735;

export const DEFAULT_PROFILE = { name: 'Akshay', sex: 'male', age: '', heightIn: '', activity: 'moderate', goal: 'recomp' };
export const DEFAULT_TARGETS = { auto: true, kcal: 2400, p: 170, c: 250, f: 75, fib: 35, waterMl: 3500 };

const ACTIVITY = { light: 1.375, moderate: 1.55, high: 1.725 };
const GOAL_ADJ = { cut: -450, recomp: -150, maintain: 0, bulk: 300 };

// Supplements/powders taken count toward the day's totals.
export function dayTotals(day, supps = []) {
  const t = { kcal: 0, p: 0, c: 0, f: 0, fib: 0 };
  for (const e of day?.food || []) for (const k in t) t[k] += Number(e[k]) || 0;
  for (const s of supps) {
    const n = Number(day?.supps?.[s.id]) || 0;
    if (!n || s.kind !== 'powder') continue;
    for (const k of ['kcal', 'p', 'c', 'f']) t[k] += (Number(s[k]) || 0) * n;
  }
  for (const k in t) t[k] = Math.round(t[k] * 10) / 10;
  t.kcal = Math.round(t.kcal);
  return t;
}

// Mifflin-St Jeor with activity factor, then a goal adjustment.
// Protein 1 g per lb of body weight (capped at 220), fat 27% of calories, carbs fill the rest.
export function calcTargets(profile, bwLb) {
  const age = Number(profile.age), hIn = Number(profile.heightIn);
  if (!age || !hIn || !bwLb) return null;
  const kg = bwLb / LB_PER_KG, cm = hIn * 2.54;
  const bmr = 10 * kg + 6.25 * cm - 5 * age + (profile.sex === 'female' ? -161 : 5);
  const tdee = bmr * (ACTIVITY[profile.activity] || 1.55);
  const kcal = Math.round((tdee + (GOAL_ADJ[profile.goal] ?? 0)) / 10) * 10;
  const p = Math.min(220, Math.round(bwLb * (profile.goal === 'bulk' ? 0.9 : 1)));
  const f = Math.round((kcal * 0.27) / 9);
  const c = Math.max(0, Math.round((kcal - p * 4 - f * 9) / 4));
  const waterMl = Math.round((kg * 35 + 500) / 100) * 100; // ~35 ml/kg plus training
  return { kcal, p, c, f, fib: Math.round((kcal / 1000) * 14), waterMl, bmr: Math.round(bmr), tdee: Math.round(tdee) };
}
