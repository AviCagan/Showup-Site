/**
 * The admin page's charts (ADR-0231): inline SVG and HTML, no chart library. One axis per chart,
 * 2 px lines, columns at most 24 px wide with a 4 px rounded end and a 2 px gap, recessive
 * hairline grid, a legend for two or more series, a crosshair tooltip that also works from the
 * keyboard, and a table under every chart. Every label goes in through textContent.
 */
import { niceTicks } from './stats.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

export function h(doc, tag, attrs = {}, text) {
  const node = doc.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== undefined && value !== null && value !== false)
      node.setAttribute(key, String(value));
  }
  if (text !== undefined) node.textContent = text;
  return node;
}

function s(doc, tag, attrs = {}, text) {
  const node = doc.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  if (text !== undefined) node.textContent = text;
  return node;
}

/** A collapsed table view: `columns` are `{ label, value(row), num }`. */
export function dataTable(doc, { caption, columns, rows, open = false }) {
  const details = h(doc, 'details', { class: 'table-view', open: open || undefined });
  details.append(
    h(doc, 'summary', {}, `Table (${rows.length} ${rows.length === 1 ? 'row' : 'rows'})`),
  );
  const wrap = h(doc, 'div', { class: 'table-wrap' });
  const table = h(doc, 'table', { class: 'data-table' });
  table.append(h(doc, 'caption', { class: 'visually-hidden' }, caption));
  const head = h(doc, 'tr');
  for (const column of columns) {
    head.append(
      h(doc, 'th', { scope: 'col', class: column.num ? 'num' : undefined }, column.label),
    );
  }
  const thead = h(doc, 'thead');
  thead.append(head);
  table.append(thead);
  const body = h(doc, 'tbody');
  for (const row of rows) {
    const tr = h(doc, 'tr');
    for (const column of columns) {
      tr.append(h(doc, 'td', { class: column.num ? 'num' : undefined }, String(column.value(row))));
    }
    body.append(tr);
  }
  table.append(body);
  wrap.append(table);
  details.append(wrap);
  return details;
}

/**
 * Ranked horizontal bars, one series: `rows` are `{ label, sub, value, text }`; the bar length is
 * `value / max`, the number at the tip is `text`, `sub` is a muted second line under the label.
 */
export function hbarList(doc, { rows, max }) {
  const top = max ?? Math.max(0, ...rows.map((r) => r.value));
  const list = h(doc, 'ul', { class: 'hbars' });
  for (const row of rows) {
    const item = h(doc, 'li', { class: 'hbar' });
    const label = h(doc, 'span', { class: 'hbar-label' }, row.label);
    if (row.sub) label.append(h(doc, 'small', {}, row.sub));
    const track = h(doc, 'span', { class: 'hbar-track' });
    const fill = h(doc, 'span', { class: 'hbar-fill' });
    const share = top > 0 ? Math.max(0, Math.min(1, row.value / top)) : 0;
    // The bar takes at most 72% of the track so the number at its tip always fits.
    fill.style.width = `${(share * 72).toFixed(2)}%`;
    track.append(fill, h(doc, 'span', { class: 'hbar-value' }, row.text));
    item.append(label, track);
    list.append(item);
  }
  return list;
}

function legend(doc, series) {
  const list = h(doc, 'ul', { class: 'legend-row' });
  series.forEach((entry, i) => {
    const item = h(doc, 'li');
    item.append(
      h(doc, 'span', { class: `key-line key-${i + 1}`, 'aria-hidden': 'true' }),
      entry.label,
    );
    list.append(item);
  });
  return list;
}

function tooltipRow(doc, keyClass, value, label) {
  const row = h(doc, 'p', { class: 'tip-row' });
  if (keyClass)
    row.append(h(doc, 'span', { class: `key-line ${keyClass}`, 'aria-hidden': 'true' }));
  row.append(h(doc, 'strong', {}, value), ` ${label}`);
  return row;
}

const HEIGHT = 220;
const MARGIN = { left: 44, right: 14, top: 12, bottom: 28 };

/**
 * The frame both chart kinds share: axis, grid, x labels, the tooltip and the pointer and
 * keyboard handling that picks a row. `draw(svg, geometry)` adds the marks; `describe(row)`
 * fills the tooltip.
 */
function frame(doc, options) {
  const { rows, width, maxValue, formatY, formatX, ariaLabel, draw, describe, highlight } = options;
  const W = Math.max(280, Math.round(width));
  const plotW = W - MARGIN.left - MARGIN.right;
  const plotH = HEIGHT - MARGIN.top - MARGIN.bottom;
  const ticks = niceTicks(maxValue);
  const top = ticks[ticks.length - 1] || 1;
  const yAt = (v) => MARGIN.top + plotH - (Math.max(0, v) / top) * plotH;
  const n = rows.length;

  const wrapper = h(doc, 'div', { class: 'chart' });
  const svg = s(doc, 'svg', {
    viewBox: `0 0 ${W} ${HEIGHT}`,
    width: W,
    height: HEIGHT,
    role: 'img',
    'aria-label': ariaLabel,
    tabindex: 0,
  });
  for (const tick of ticks) {
    const y = yAt(tick);
    svg.append(
      s(doc, 'line', {
        class: tick === 0 ? 'baseline' : 'gridline',
        x1: MARGIN.left,
        x2: W - MARGIN.right,
        y1: y,
        y2: y,
      }),
    );
    svg.append(
      s(doc, 'text', { x: MARGIN.left - 8, y: y + 4, 'text-anchor': 'end' }, formatY(tick)),
    );
  }
  const geometry = { W, plotW, plotH, yAt, n, left: MARGIN.left, base: yAt(0) };
  const xAt = draw(svg, geometry);
  if (n > 0) {
    const picks = n === 1 ? [0] : n === 2 ? [0, 1] : [0, Math.floor((n - 1) / 2), n - 1];
    picks.forEach((i, k) => {
      const anchor =
        picks.length === 1
          ? 'middle'
          : k === 0
            ? 'start'
            : k === picks.length - 1
              ? 'end'
              : 'middle';
      svg.append(
        s(doc, 'text', { x: xAt(i), y: HEIGHT - 8, 'text-anchor': anchor }, formatX(rows[i])),
      );
    });
  }
  const crosshair = s(doc, 'line', {
    class: 'crosshair',
    y1: MARGIN.top,
    y2: MARGIN.top + plotH,
    visibility: 'hidden',
  });
  svg.append(crosshair);
  const tooltip = h(doc, 'div', { class: 'tooltip', hidden: true, role: 'presentation' });
  wrapper.append(svg, tooltip);

  let active = -1;
  const show = (i) => {
    if (n === 0) return;
    active = Math.max(0, Math.min(n - 1, i));
    const x = xAt(active);
    crosshair.setAttribute('x1', String(x));
    crosshair.setAttribute('x2', String(x));
    crosshair.setAttribute('visibility', 'visible');
    highlight?.(active, geometry, xAt);
    tooltip.replaceChildren(...describe(rows[active]));
    tooltip.hidden = false;
    const scale = svg.getBoundingClientRect().width / W || 1;
    const px = x * scale;
    const boxWidth = tooltip.offsetWidth || 160;
    const room = (svg.getBoundingClientRect().width || W) - boxWidth;
    tooltip.style.left = `${Math.max(0, Math.min(room, px + 12))}px`;
    tooltip.style.top = '0px';
  };
  const hide = () => {
    active = -1;
    crosshair.setAttribute('visibility', 'hidden');
    highlight?.(-1, geometry, xAt);
    tooltip.hidden = true;
  };
  const indexAt = (clientX) => {
    const rect = svg.getBoundingClientRect();
    const x = ((clientX - rect.left) / (rect.width || W)) * W;
    let best = 0;
    for (let i = 1; i < n; i += 1) if (Math.abs(xAt(i) - x) < Math.abs(xAt(best) - x)) best = i;
    return best;
  };
  svg.addEventListener('pointermove', (event) => show(indexAt(event.clientX)));
  svg.addEventListener('pointerleave', hide);
  svg.addEventListener('focus', () => show(n - 1));
  svg.addEventListener('blur', hide);
  svg.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      show((active < 0 ? n - 1 : active) + (event.key === 'ArrowLeft' ? -1 : 1));
    } else if (event.key === 'Escape') {
      hide();
    }
  });
  return wrapper;
}

/**
 * A line chart over days: `series` are `{ key, label }` (at most three, colored in the fixed
 * order series-1, -2, -3), `rows` hold `x` and every series key.
 */
export function lineChart(doc, { rows, series, width, formatY, formatX, ariaLabel }) {
  const maxValue = Math.max(0, ...rows.flatMap((r) => series.map((sr) => r[sr.key])));
  const markers = [];
  const chart = frame(doc, {
    rows,
    width,
    maxValue,
    formatY,
    formatX,
    ariaLabel,
    draw: (svg, g) => {
      const xAt = (i) => g.left + (g.n <= 1 ? g.plotW / 2 : (i * g.plotW) / (g.n - 1));
      series.forEach((entry, k) => {
        const cls = `series-${k + 1}`;
        if (g.n > 1) {
          const d = rows
            .map(
              (r, i) =>
                `${i === 0 ? 'M' : 'L'}${xAt(i).toFixed(1)} ${g.yAt(r[entry.key]).toFixed(1)}`,
            )
            .join('');
          svg.append(s(doc, 'path', { class: `line ${cls}`, d }));
        }
        if (g.n > 0) {
          const last = rows[g.n - 1];
          svg.append(
            s(doc, 'circle', {
              class: `dot ${cls}`,
              cx: xAt(g.n - 1),
              cy: g.yAt(last[entry.key]),
              r: 4,
            }),
          );
        }
        const marker = s(doc, 'circle', { class: `dot ${cls}`, r: 4, visibility: 'hidden' });
        markers.push(marker);
        svg.append(marker);
      });
      return xAt;
    },
    describe: (row) => [
      h(doc, 'p', { class: 'tip-title' }, formatX(row, true)),
      ...series.map((entry, k) =>
        tooltipRow(doc, `key-${k + 1}`, formatY(row[entry.key]), entry.label),
      ),
    ],
    highlight: (i, g, xAt) => {
      markers.forEach((marker, k) => {
        if (i < 0) {
          marker.setAttribute('visibility', 'hidden');
          return;
        }
        marker.setAttribute('cx', String(xAt(i)));
        marker.setAttribute('cy', String(g.yAt(rows[i][series[k].key])));
        marker.setAttribute('visibility', 'visible');
      });
    },
  });
  if (series.length >= 2) chart.prepend(legend(doc, series));
  return chart;
}

/** Columns over days, one series: `value(row)` sets the height, `describe(row)` the tooltip. */
export function columnChart(doc, { rows, value, width, formatY, formatX, ariaLabel, describe }) {
  const maxValue = Math.max(0, ...rows.map(value));
  const columns = [];
  return frame(doc, {
    rows,
    width,
    maxValue,
    formatY,
    formatX,
    ariaLabel,
    draw: (svg, g) => {
      const slot = g.n > 0 ? g.plotW / g.n : g.plotW;
      const barW = Math.max(1, Math.min(24, slot - 2));
      const xAt = (i) => g.left + slot * i + slot / 2;
      rows.forEach((row, i) => {
        const v = value(row);
        if (v <= 0) return;
        const x = xAt(i) - barW / 2;
        const y = g.yAt(v);
        const height = g.base - y;
        const r = Math.min(4, barW / 2, height);
        const d =
          `M${x.toFixed(1)} ${g.base.toFixed(1)}V${(y + r).toFixed(1)}` +
          `Q${x.toFixed(1)} ${y.toFixed(1)} ${(x + r).toFixed(1)} ${y.toFixed(1)}` +
          `H${(x + barW - r).toFixed(1)}` +
          `Q${(x + barW).toFixed(1)} ${y.toFixed(1)} ${(x + barW).toFixed(1)} ${(y + r).toFixed(1)}` +
          `V${g.base.toFixed(1)}Z`;
        const column = s(doc, 'path', { class: 'column', d });
        columns[i] = column;
        svg.append(column);
      });
      return xAt;
    },
    describe: (row) => [h(doc, 'p', { class: 'tip-title' }, formatX(row, true)), ...describe(row)],
    highlight: (i) => {
      columns.forEach((column, k) => {
        if (!column) return;
        column.classList.toggle('is-active', k === i);
      });
    },
  });
}

export { tooltipRow };
