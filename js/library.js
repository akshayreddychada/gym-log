// Muscles, exercise library, core/posture routines and default supplements.

export const MUSCLES = [
  { id: 'chest', name: 'Chest', color: 'red', side: 'front' },
  { id: 'shoulders', name: 'Shoulders', color: 'green', side: 'both' },
  { id: 'biceps', name: 'Biceps', color: 'green', side: 'front' },
  { id: 'forearms', name: 'Forearms', color: 'green', side: 'both' },
  { id: 'abs', name: 'Abs', color: 'white', side: 'front' },
  { id: 'obliques', name: 'Obliques', color: 'white', side: 'front' },
  { id: 'quads', name: 'Quads', color: 'yellow', side: 'front' },
  { id: 'adductors', name: 'Inner thigh', color: 'yellow', side: 'front' },
  { id: 'calves', name: 'Calves', color: 'yellow', side: 'both' },
  { id: 'traps', name: 'Traps', color: 'blue', side: 'back' },
  { id: 'upperback', name: 'Upper back', color: 'blue', side: 'back' },
  { id: 'lats', name: 'Lats', color: 'blue', side: 'back' },
  { id: 'triceps', name: 'Triceps', color: 'blue', side: 'back' },
  { id: 'lowerback', name: 'Lower back', color: 'blue', side: 'back' },
  { id: 'glutes', name: 'Glutes', color: 'yellow', side: 'back' },
  { id: 'abductors', name: 'Outer thigh', color: 'yellow', side: 'back' },
  { id: 'hamstrings', name: 'Hamstrings', color: 'yellow', side: 'back' },
];
export const muscleById = Object.fromEntries(MUSCLES.map((m) => [m.id, m]));

// mine: part of Akshay's own split, picked first when that muscle is selected.
const X = (id, name, muscle, mine = false, equip = '') => ({ id, name, muscle, mine, equip });
export const LIBRARY = [
  X('flat-bench', 'Flat bench press', 'chest', true, 'Barbell'),
  X('incline-bench', 'Incline bench press', 'chest', true, 'Barbell'),
  X('decline-bench', 'Decline bench press', 'chest', true, 'Barbell'),
  X('chest-fly', 'Chest flys', 'chest', true, 'Cable / DB'),
  X('db-bench', 'Dumbbell bench press', 'chest', false, 'Dumbbell'),
  X('incline-db', 'Incline dumbbell press', 'chest', false, 'Dumbbell'),
  X('pec-deck', 'Pec deck', 'chest', false, 'Machine'),
  X('cable-cross', 'Cable crossover', 'chest', false, 'Cable'),
  X('push-up', 'Push-ups', 'chest', false, 'Bodyweight'),

  X('ohp', 'Overhead press', 'shoulders', true, 'Barbell / DB'),
  X('lateral-raise', 'Lateral raises', 'shoulders', true, 'Dumbbell'),
  X('front-raise', 'Front raises', 'shoulders', true, 'Dumbbell'),
  X('rear-delt-row', 'Rear delt row', 'shoulders', true, 'Cable / DB'),
  X('arnold-press', 'Arnold press', 'shoulders', false, 'Dumbbell'),
  X('cable-lateral', 'Cable lateral raise', 'shoulders', false, 'Cable'),
  X('reverse-fly', 'Reverse pec deck', 'shoulders', false, 'Machine'),

  X('preacher-curl', 'Preacher curl', 'biceps', true, 'EZ bar / DB'),
  X('incline-curl', 'Incline curl', 'biceps', true, 'Dumbbell'),
  X('hammer-curl', 'Hammer curl', 'biceps', true, 'Dumbbell'),
  X('zottman-curl', 'Zottman curl', 'biceps', true, 'Dumbbell'),
  X('barbell-curl', 'Barbell curl', 'biceps', false, 'Barbell'),
  X('cable-curl', 'Cable curl', 'biceps', false, 'Cable'),
  X('spider-curl', 'Spider curl', 'biceps', false, 'Dumbbell'),

  X('dips', 'Dips', 'triceps', true, 'Bodyweight'),
  X('oh-ext', 'Overhead extension', 'triceps', true, 'Cable / DB'),
  X('pushdown', 'Cable pushdown', 'triceps', true, 'Cable'),
  X('jm-press', 'JM press', 'triceps', true, 'Barbell'),
  X('skullcrusher', 'Skull crushers', 'triceps', false, 'EZ bar'),
  X('cg-bench', 'Close-grip bench press', 'triceps', false, 'Barbell'),
  X('kickback', 'Tricep kickback', 'triceps', false, 'Dumbbell'),

  X('seated-row', 'Seated row', 'upperback', true, 'Cable'),
  X('face-pull', 'Face pulls', 'upperback', true, 'Cable'),
  X('cs-row', 'Chest-supported row', 'upperback', true, 'Machine / DB'),
  X('lat-pulldown', 'Lat pulldown', 'lats', true, 'Cable'),
  X('pull-up', 'Pull-ups', 'lats', false, 'Bodyweight'),
  X('sa-row', 'Single-arm dumbbell row', 'lats', false, 'Dumbbell'),
  X('straight-arm', 'Straight-arm pulldown', 'lats', false, 'Cable'),
  X('tbar-row', 'T-bar row', 'upperback', false, 'Barbell'),
  X('shrug', 'Shrugs', 'traps', false, 'Dumbbell'),
  X('farmer-carry', 'Farmer carry', 'traps', false, 'Dumbbell'),
  X('back-ext', 'Back extension', 'lowerback', false, 'Bench'),
  X('bird-dog-w', 'Weighted bird dog', 'lowerback', false, 'Bodyweight'),

  X('squat', 'Squat', 'quads', true, 'Barbell'),
  X('leg-press', 'Leg press', 'quads', true, 'Machine'),
  X('leg-ext', 'Leg extension', 'quads', true, 'Machine'),
  X('ham-curl', 'Hamstring curl', 'hamstrings', true, 'Machine'),
  X('calf-raise', 'Calf raises', 'calves', true, 'Machine'),
  X('hip-thrust', 'Hip thrust', 'glutes', true, 'Barbell'),
  X('adductor', 'Inner thigh (adductor)', 'adductors', true, 'Machine'),
  X('abductor', 'Outer thigh (abductor)', 'abductors', true, 'Machine'),
  X('rdl', 'Romanian deadlift', 'hamstrings', false, 'Barbell'),
  X('bss', 'Bulgarian split squat', 'quads', false, 'Dumbbell'),
  X('lunge', 'Walking lunges', 'quads', false, 'Dumbbell'),
  X('hack-squat', 'Hack squat', 'quads', false, 'Machine'),
  X('seated-calf', 'Seated calf raise', 'calves', false, 'Machine'),
  X('glute-kickback', 'Cable glute kickback', 'glutes', false, 'Cable'),
  X('cable-abduction', 'Cable hip abduction', 'abductors', false, 'Cable'),

  X('ab-crunch', 'Ab crunch', 'abs', true, 'Machine / mat'),
  X('leg-raise', 'Leg raises', 'abs', true, 'Bodyweight'),
  X('cable-crunch', 'Cable crunch', 'abs', false, 'Cable'),
  X('hanging-knee', 'Hanging knee raise', 'abs', false, 'Bodyweight'),
  X('ab-wheel', 'Ab wheel rollout', 'abs', false, 'Ab wheel'),
  X('russian-twist', 'Russian twist', 'obliques', false, 'Plate'),
  X('woodchop', 'Cable woodchop', 'obliques', false, 'Cable'),
  X('side-plank', 'Side plank (reps = seconds)', 'obliques', false, 'Bodyweight'),

  X('wrist-curl', 'Wrist curl', 'forearms', false, 'Dumbbell'),
  X('reverse-curl', 'Reverse curl', 'forearms', false, 'EZ bar'),
];
export const libById = Object.fromEntries(LIBRARY.map((e) => [e.id, e]));

// Old routine groups (and names the user types in Setup) mapped to a muscle.
const GROUP_MUSCLE = { chest: 'chest', abs: 'abs', shoulders: 'shoulders', biceps: 'biceps', triceps: 'triceps', back: 'upperback', legs: 'quads', glutes: 'glutes' };
export function muscleOf(ex) {
  if (!ex) return null;
  if (ex.muscle && muscleById[ex.muscle]) return ex.muscle;
  if (libById[ex.id]) return libById[ex.id].muscle;
  return GROUP_MUSCLE[String(ex.group || '').toLowerCase()] || null;
}

// The muscles each split day covers. Used to light up the body map for a preset.
export const DAY_MUSCLES = {
  push: ['chest', 'shoulders', 'triceps'],
  pull: ['lats', 'upperback', 'biceps', 'shoulders'],
  quads: ['quads', 'adductors', 'calves', 'abs'],
  upper: ['chest', 'upperback', 'shoulders', 'triceps', 'biceps'],
  hams: ['hamstrings', 'glutes', 'abductors', 'calves', 'abs'],
  chest: ['chest', 'abs'],
  shoulders: ['shoulders', 'biceps'],
  legs: ['quads', 'hamstrings', 'glutes', 'adductors', 'abductors', 'calves', 'abs'],
  back: ['upperback', 'lats', 'triceps'],
};

// ---------- posture & core
export const DEFAULT_APT = [
  { id: 'hip-flexor', name: 'Kneeling hip flexor stretch', target: '2 × 45 s each side' },
  { id: 'couch', name: 'Couch stretch', target: '2 × 45 s each side' },
  { id: 'glute-bridge', name: 'Glute bridge', target: '3 × 15, squeeze 2 s' },
  { id: 'dead-bug', name: 'Dead bug', target: '3 × 10 each side' },
  { id: 'ppt-hold', name: 'Posterior pelvic tilt hold', target: '3 × 20 s' },
  { id: 'bird-dog', name: 'Bird dog', target: '3 × 10 each side' },
  { id: 'rkc-plank', name: 'RKC plank', target: '3 × 30 s' },
  { id: 'cat-cow', name: 'Cat–cow', target: '1 × 10 slow' },
];
export const DEFAULT_ABS = [
  { id: 'crunch', name: 'Ab crunch', target: '3 × 15' },
  { id: 'leg-raise', name: 'Leg raises', target: '3 × 12' },
  { id: 'plank', name: 'Plank', target: '3 × 45 s' },
  { id: 'bicycle', name: 'Bicycle crunch', target: '3 × 20' },
  { id: 'russian', name: 'Russian twist', target: '3 × 20' },
  { id: 'hollow', name: 'Hollow hold', target: '3 × 20 s' },
];

// ---------- supplements & powders
// kind: 'powder' entries can carry nutrition per serving, which counts toward the day's food totals.
export const DEFAULT_SUPPS = [
  { id: 'whey', name: 'Whey protein', dose: '1 scoop (30 g)', kind: 'powder', when: 'Post-workout', kcal: 120, p: 24, c: 3, f: 1.5 },
  { id: 'creatine', name: 'Creatine monohydrate', dose: '5 g', kind: 'powder', when: 'Any time', kcal: 0, p: 0, c: 0, f: 0 },
  { id: 'greens', name: 'Greens powder', dose: '1 scoop (10 g)', kind: 'powder', when: 'Morning', kcal: 40, p: 2, c: 7, f: 0.5 },
  { id: 'multi', name: 'Multivitamin', dose: '1 tablet', kind: 'pill', when: 'Breakfast' },
  { id: 'omega3', name: 'Omega-3 fish oil', dose: '2 softgels', kind: 'pill', when: 'With a meal' },
  { id: 'vitd', name: 'Vitamin D3', dose: '2000 IU', kind: 'pill', when: 'With a meal' },
  { id: 'magnesium', name: 'Magnesium glycinate', dose: '400 mg', kind: 'pill', when: 'Bedtime' },
];
