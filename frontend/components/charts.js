// Chart.js helpers following the dataviz rules: one axis, thin marks, 4px rounded bar ends,
// recessive grid, hover tooltips, legend only for 2+ series, and a table view for every chart.
// Palette validated with the dataviz validator (light surface): primary #3A6EA5, secondary #B8862F.
import { esc } from '/assets/js/ui.js';

export const SERIES = ['#3A6EA5', '#B8862F'];
const INK = '#30343B';
const MUTED = '#6B7079';
const GRID = 'rgba(48,52,59,.08)';

let loader;
export function loadChartJs() {
  if (window.Chart) return Promise.resolve(window.Chart);
  loader = loader || new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = '/vendor/chart.js/chart.umd.min.js';
    s.onload = () => {
      const C = window.Chart;
      C.defaults.font.family = "'Inter', system-ui, sans-serif";
      C.defaults.font.size = 12;
      C.defaults.color = MUTED;
      C.defaults.plugins.tooltip.backgroundColor = '#172B3A';
      C.defaults.plugins.tooltip.padding = 10;
      C.defaults.plugins.tooltip.cornerRadius = 6;
      C.defaults.plugins.tooltip.titleColor = '#fff';
      C.defaults.plugins.tooltip.bodyColor = '#fff';
      C.defaults.maintainAspectRatio = false;
      resolve(C);
    };
    s.onerror = () => reject(new Error('Could not load the chart library.'));
    document.head.appendChild(s);
  });
  return loader;
}

const charts = new WeakMap();

/**
 * Render a chart into `box` (a .chart-box). kind: 'line' | 'bar' | 'hbar'.
 * series: [{ label, data }]; fmt formats values for ticks/tooltips/table.
 */
export async function renderChart(box, { kind, labels, series, fmt = (v) => v, tickLabel = (l) => l, ariaLabel }) {
  const Chart = await loadChartJs();
  charts.get(box)?.destroy();
  const empty = !labels.length || series.every((s) => s.data.every((v) => !v));
  box.innerHTML = empty
    ? '<div class="state small" style="padding:40px 0"><p>No data for this period yet.</p></div>'
    : `<canvas role="img" aria-label="${esc(ariaLabel || '')}"></canvas>`;
  if (empty) return;
  const multi = series.length > 1;
  const horizontal = kind === 'hbar';
  const datasets = series.map((s, i) => {
    const color = s.color || SERIES[i];
    return kind === 'line'
      ? { label: s.label, data: s.data, borderColor: color, backgroundColor: color, borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, pointHitRadius: 12, tension: 0.25, fill: false }
      : { label: s.label, data: s.data, backgroundColor: color, hoverBackgroundColor: color, borderRadius: 4, borderSkipped: horizontal ? 'left' : 'bottom', maxBarThickness: horizontal ? 22 : 28, categoryPercentage: 0.8, barPercentage: 0.9 };
  });
  const valueAxis = { beginAtZero: true, grid: { color: GRID, drawTicks: false }, border: { display: false }, ticks: { padding: 8, callback: (v) => fmt(v, true), maxTicksLimit: 6 } };
  const catAxis = { grid: { display: false }, border: { color: GRID }, ticks: { padding: 6, autoSkip: true, maxRotation: 0, callback(v) { return tickLabel(this.getLabelForValue(v)); } } };
  const chart = new Chart(box.querySelector('canvas'), {
    type: kind === 'line' ? 'line' : 'bar',
    data: { labels, datasets },
    options: {
      indexAxis: horizontal ? 'y' : 'x',
      interaction: { mode: 'index', intersect: false },
      animation: { duration: 400 },
      scales: horizontal ? { x: valueAxis, y: { ...catAxis, ticks: { ...catAxis.ticks, color: INK } } } : { x: catAxis, y: valueAxis },
      plugins: {
        legend: { display: multi, position: 'top', align: 'end', labels: { usePointStyle: true, pointStyle: 'rectRounded', boxWidth: 10, color: INK } },
        tooltip: { callbacks: { title: (items) => tickLabel(items[0].label, true), label: (c) => ` ${multi ? `${c.dataset.label}: ` : ''}${fmt(c.parsed[horizontal ? 'x' : 'y'])}` } },
      },
    },
  });
  charts.set(box, chart);
}

/** Toggle a chart card between canvas and an accessible table of the same numbers. */
export function tableHtml(labels, series, fmt = (v) => v, tickLabel = (l) => l) {
  return `<div class="table-wrap" style="max-height:260px;overflow:auto"><table class="table"><thead><tr><th>Period</th>${series.map((s) => `<th class="num">${esc(s.label)}</th>`).join('')}</tr></thead><tbody>
    ${labels.map((l, i) => `<tr><td>${esc(tickLabel(l, true))}</td>${series.map((s) => `<td class="num">${esc(fmt(s.data[i]))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
