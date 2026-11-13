// Tappable front/back body map. Each muscle shape carries data-m="<muscle id>".
// Coordinates live in a 120 × 250 box per figure; right side is mirrored from the left.

const mirror = (d) => d.replace(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g, (m, x, y) => `${+(120 - Number(x)).toFixed(1)},${y}`);
const pair = (d) => [d, mirror(d)];
const ell = (cx, cy, rx, ry, rot = 0) => ({ cx, cy, rx, ry, rot });
const ellPair = (cx, cy, rx, ry, rot = 0) => [ell(cx, cy, rx, ry, rot), ell(120 - cx, cy, rx, ry, -rot)];

// Silhouette, drawn underneath the muscles.
const SIL = `
  <ellipse cx="60" cy="19" rx="10.5" ry="12.5"/>
  <rect x="54" y="28" width="12" height="12" rx="4"/>
  <path d="M38,40 L82,40 Q93,43 93,56 L87,116 Q85,128 80,132 L40,132 Q35,128 33,116 L27,56 Q27,43 38,40Z"/>
  <path d="M33,46 L22,100 L19,124" class="limb arm"/><path d="M87,46 L98,100 L101,124" class="limb arm"/>
  <path d="M48,128 L47,190 L48,238" class="limb leg"/><path d="M72,128 L73,190 L72,238" class="limb leg"/>
  <ellipse cx="18" cy="128" rx="4.5" ry="6"/><ellipse cx="102" cy="128" rx="4.5" ry="6"/>
  <ellipse cx="46" cy="243" rx="8" ry="4"/><ellipse cx="74" cy="243" rx="8" ry="4"/>`;

const FRONT = {
  shoulders: { e: ellPair(35, 51, 8.5, 9.5, 18) },
  chest: { p: pair('M59,45 L42,45 Q35,49 36,60 Q42,71 59,69Z') },
  biceps: { e: ellPair(28.5, 74, 5.6, 12, 12) },
  forearms: { e: ellPair(22.5, 102, 4.6, 14, 8) },
  abs: { p: [0, 1, 2].flatMap((r) => [`M50.5,${73 + r * 14} L59,${73 + r * 14} L59,${84 + r * 14} L51,${84 + r * 14}Z`, `M61,${73 + r * 14} L69.5,${73 + r * 14} L69,${84 + r * 14} L61,${84 + r * 14}Z`]) },
  obliques: { p: pair('M41,74 L48,76 L49,114 Q44,116 40,110 L38,90Z') },
  quads: { p: pair('M41,132 Q47,128 56,134 L55,176 Q50,188 45,184 Q38,160 41,132Z') },
  adductors: { p: pair('M57,134 Q59,136 59.5,142 L56,166 Q55,150 54,140Z') },
  calves: { e: ellPair(46.5, 212, 5.5, 17, 2) },
};
const BACK = {
  traps: { p: ['M60,31 L74,42 L66,48 L60,60 L54,48 L46,42Z'] },
  shoulders: { e: ellPair(35, 51, 8.5, 9.5, 18) },
  upperback: { p: pair('M59,62 L54,49 L44,47 Q40,54 43,62 L52,72 L59,76Z') },
  lats: { p: pair('M42,65 L53,75 L58,80 L56,104 Q48,106 44,100 Q38,84 42,65Z') },
  triceps: { e: ellPair(28.5, 74, 5.8, 12.5, 12) },
  forearms: { e: ellPair(22.5, 102, 4.6, 14, 8) },
  lowerback: { p: ['M57,84 L63,84 L66,106 L66,118 L54,118 L54,106Z'] },
  glutes: { p: pair('M59,120 L59,146 Q49,150 43,142 Q39,128 46,121Z') },
  abductors: { e: ellPair(38.5, 133, 3.6, 10, -6) },
  hamstrings: { p: pair('M43,150 Q50,154 58,150 L56,186 Q50,192 46,186 Q41,170 43,150Z') },
  calves: { e: ellPair(47, 210, 6.5, 17, 2) },
};

function shapes(map, cls) {
  let s = '';
  for (const [m, g] of Object.entries(map)) {
    const c = `${cls(m)}`;
    for (const d of g.p || []) s += `<path d="${d}" data-m="${m}" class="mu ${c}"/>`;
    for (const e of g.e || []) s += `<ellipse cx="${e.cx}" cy="${e.cy}" rx="${e.rx}" ry="${e.ry}" transform="rotate(${e.rot} ${e.cx} ${e.cy})" data-m="${m}" class="mu ${c}"/>`;
  }
  return s;
}

// state(muscleId) -> class string ('sel', 'd0', 'd2', 'd4' ...)
export function bodyMap(state) {
  const fig = (map, label) => `<figure class="body-fig">
    <svg viewBox="0 0 120 250" role="group" aria-label="${label} muscles">
      <g class="sil">${SIL}</g>
      ${shapes(map, state)}
    </svg>
    <figcaption>${label}</figcaption></figure>`;
  return `<div class="body-map" data-act="body">${fig(FRONT, 'Front')}${fig(BACK, 'Back')}</div>`;
}
