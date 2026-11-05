// Small dependency-free SVG charts with a crosshair / per-bar tooltip.
import { parseYmd } from './data.js';

const NS = 'http://www.w3.org/2000/svg';
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtDate = (s) => parseYmd(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

function niceTicks(min, max, count = 4) {
  if (min === max) { const pad = Math.abs(min) * 0.1 || 1; min -= pad; max += pad; }
  const span = max - min;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count + 0.5);
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v * 1000) / 1000);
  return { lo, hi, ticks };
}

function mount(el, render) {
  el.classList.add('chart');
  let last = 0;
  const draw = () => {
    const w = el.clientWidth;
    if (!w || w === last) return;
    last = w;
    render(w);
  };
  draw();
  if (el._ro) el._ro.disconnect();
  el._ro = new ResizeObserver(draw);
  el._ro.observe(el);
}

function shortNum(v) {
  if (Math.abs(v) >= 10000) return Math.round(v / 1000) + 'k';
  if (Math.abs(v) >= 1000) return (Math.round(v / 100) / 10) + 'k';
  return String(Math.round(v * 10) / 10);
}

function frame(w, h, pad, yTicks, yScale) {
  let s = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="${NS}" role="img">`;
  for (const t of yTicks) {
    const y = yScale(t);
    s += `<line x1="${pad.l}" x2="${w - pad.r}" y1="${y}" y2="${y}" class="grid"/>`;
    s += `<text x="${pad.l - 8}" y="${y + 4}" class="tick" text-anchor="end">${shortNum(t)}</text>`;
  }
  return s;
}

function xLabels(points, xScale, h, pad, w) {
  if (!points.length) return '';
  const idx = points.length <= 2 ? points.map((_, i) => i) : [0, Math.floor((points.length - 1) / 2), points.length - 1];
  return [...new Set(idx)].map((i, k, arr) => {
    const anchor = arr.length > 1 && k === 0 ? 'start' : k === arr.length - 1 && arr.length > 1 ? 'end' : 'middle';
    return `<text x="${Math.min(Math.max(xScale(i), pad.l), w - pad.r)}" y="${h - 6}" class="tick" text-anchor="${anchor}">${fmtDate(points[i].date)}</text>`;
  }).join('');
}

function attachHover(el, svg, points, xs, tipHtml, onIndex) {
  const tip = document.createElement('div');
  tip.className = 'chart-tip';
  tip.hidden = true;
  el.appendChild(tip);
  const pick = (ev) => {
    const r = svg.getBoundingClientRect();
    const x = ev.clientX - r.left;
    let best = 0;
    for (let i = 1; i < xs.length; i++) if (Math.abs(xs[i] - x) < Math.abs(xs[best] - x)) best = i;
    tip.innerHTML = tipHtml(points[best]);
    tip.hidden = false;
    const tw = tip.offsetWidth;
    tip.style.left = Math.min(Math.max(xs[best] - tw / 2, 0), el.clientWidth - tw) + 'px';
    onIndex(best);
  };
  const hide = () => { tip.hidden = true; onIndex(-1); };
  svg.addEventListener('pointermove', pick);
  svg.addEventListener('pointerdown', pick);
  svg.addEventListener('pointerleave', hide);
}

// points: [{date, y, ...}], sorted by date. Evenly spaced by session, not by calendar,
// so a gap week doesn't squash the line.
export function lineChart(el, points, { color = 'var(--accent)', height = 200, tip, empty = 'No data yet' } = {}) {
  if (!points.length) { el.innerHTML = `<p class="chart-empty">${esc(empty)}</p>`; return; }
  mount(el, (w) => {
    const h = height, pad = { l: 40, r: 14, t: 14, b: 26 };
    const ys = points.map((p) => p.y);
    const { lo, hi, ticks } = niceTicks(Math.min(...ys), Math.max(...ys));
    const yScale = (v) => pad.t + (h - pad.t - pad.b) * (1 - (v - lo) / (hi - lo || 1));
    const n = points.length;
    const xScale = (i) => (n === 1 ? (pad.l + w - pad.r) / 2 : pad.l + 6 + (w - pad.l - pad.r - 12) * (i / (n - 1)));
    const xs = points.map((_, i) => xScale(i));
    let s = frame(w, h, pad, ticks, yScale);
    const d = points.map((p, i) => `${i ? 'L' : 'M'}${xs[i].toFixed(1)},${yScale(p.y).toFixed(1)}`).join('');
    const area = `${d}L${xs[n - 1].toFixed(1)},${h - pad.b}L${xs[0].toFixed(1)},${h - pad.b}Z`;
    s += `<path d="${area}" fill="${color}" opacity=".10"/>`;
    s += `<path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    if (n <= 40) points.forEach((p, i) => { s += `<circle cx="${xs[i]}" cy="${yScale(p.y)}" r="3.5" fill="${color}" stroke="var(--surface)" stroke-width="2"/>`; });
    s += `<line class="cross" x1="0" x2="0" y1="${pad.t}" y2="${h - pad.b}" visibility="hidden"/>`;
    s += `<circle class="cross-dot" r="5" fill="${color}" stroke="var(--surface)" stroke-width="2" visibility="hidden"/>`;
    s += xLabels(points, xScale, h, pad, w);
    s += `<rect x="0" y="0" width="${w}" height="${h}" fill="transparent"/></svg>`;
    el.innerHTML = s;
    const svg = el.querySelector('svg');
    const cross = svg.querySelector('.cross'), dot = svg.querySelector('.cross-dot');
    attachHover(el, svg, points, xs, tip || ((p) => `<b>${shortNum(p.y)}</b><span>${fmtDate(p.date)}</span>`), (i) => {
      const vis = i < 0 ? 'hidden' : 'visible';
      cross.setAttribute('visibility', vis); dot.setAttribute('visibility', vis);
      if (i >= 0) {
        cross.setAttribute('x1', xs[i]); cross.setAttribute('x2', xs[i]);
        dot.setAttribute('cx', xs[i]); dot.setAttribute('cy', yScale(points[i].y));
      }
    });
  });
}

// bars: [{date, y}] one per day (y may be null for a day with nothing logged).
export function barChart(el, bars, { color = 'var(--accent)', height = 200, goal, avgLine, tip, empty = 'No data yet' } = {}) {
  if (!bars.some((b) => b.y)) { el.innerHTML = `<p class="chart-empty">${esc(empty)}</p>`; return; }
  mount(el, (w) => {
    const h = height, pad = { l: 40, r: 14, t: 14, b: 26 };
    const vals = bars.map((b) => b.y || 0);
    const { hi, ticks } = niceTicks(0, Math.max(...vals, goal || 0));
    const yScale = (v) => pad.t + (h - pad.t - pad.b) * (1 - v / (hi || 1));
    const n = bars.length;
    const slot = (w - pad.l - pad.r) / n;
    const bw = Math.max(2, Math.min(28, slot - 2));
    const xScale = (i) => pad.l + slot * i + slot / 2;
    const xs = bars.map((_, i) => xScale(i));
    let s = frame(w, h, pad, ticks.filter((t) => t >= 0), yScale);
    bars.forEach((b, i) => {
      if (!b.y) return;
      const y = yScale(b.y), base = h - pad.b, x = xs[i] - bw / 2, r = Math.min(4, bw / 2, base - y);
      const met = goal && b.y >= goal;
      s += `<path class="bar" data-i="${i}" d="M${x},${base}V${y + r}Q${x},${y} ${x + r},${y}H${x + bw - r}Q${x + bw},${y} ${x + bw},${y + r}V${base}Z" fill="${color}" opacity="${met ? 1 : 0.55}"/>`;
    });
    if (goal) {
      const gy = yScale(goal);
      s += `<line x1="${pad.l}" x2="${w - pad.r}" y1="${gy}" y2="${gy}" class="goal"/>`;
      s += `<text x="${w - pad.r}" y="${gy - 5}" class="tick goal-label" text-anchor="end">Goal ${shortNum(goal)}</text>`;
    }
    if (avgLine) {
      const d = avgLine.map((v, i) => (v == null ? null : [xs[i], yScale(v)])).filter(Boolean)
        .map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('');
      if (d) s += `<path d="${d}" fill="none" stroke="var(--ink)" stroke-width="2" stroke-linejoin="round" opacity=".85"/>`;
    }
    s += xLabels(bars, xScale, h, pad, w);
    s += `<rect x="0" y="0" width="${w}" height="${h}" fill="transparent"/></svg>`;
    el.innerHTML = s;
    const svg = el.querySelector('svg');
    attachHover(el, svg, bars, xs, tip || ((b) => `<b>${b.y ? shortNum(b.y) : '–'}</b><span>${fmtDate(b.date)}</span>`), (i) => {
      svg.querySelectorAll('.bar').forEach((p) => p.classList.toggle('dim', i >= 0 && Number(p.dataset.i) !== i));
    });
  });
}
