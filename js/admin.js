/**
 * The admin page (ADR-0231): asks for the code on every load, POSTs it with the chosen range to
 * the `usage-stats` function, and draws every field of the answer. The code lives only in the
 * submit handler's local variable for the one request; the field is cleared as soon as it is
 * read, nothing goes to storage or the URL, and a page restored from the back-forward cache
 * reloads so it asks again. The numbers stay in memory only to redraw on a resize.
 */
import { columnChart, dataTable, h, hbarList, lineChart, tooltipRow } from './charts.js';
import {
  featureTotals,
  formatBytes,
  formatCompact,
  formatCount,
  formatDay,
  formatDuration,
  formatGeneratedAt,
  formatPercent,
  formatUsd,
  formatWait,
  funnelRows,
  humanizeName,
  humanizeProps,
  normalizeStats,
  requestStats,
  resultMessage,
  retentionShare,
  stepLabel,
  toolRows,
} from './stats.js';

/** Supabase's free plan caps the database at 500 MB; the meter reads against it. */
const DB_LIMIT_BYTES = 500 * 1024 * 1024;
const TOP_ROWS = 15;

function plural(n, one, many) {
  return `${formatCount(n)} ${n === 1 ? one : many}`;
}

function section(doc, title, sub) {
  const panel = h(doc, 'section', { class: 'panel' });
  const id = `panel-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  panel.setAttribute('aria-labelledby', id);
  panel.append(h(doc, 'h2', { id }, title));
  if (sub) panel.append(h(doc, 'p', { class: 'panel-sub' }, sub));
  return panel;
}

function empty(doc, text = 'Nothing recorded in this range yet.') {
  return h(doc, 'p', { class: 'empty' }, text);
}

function tile(doc, label, value, note, hero = false) {
  const item = h(doc, 'li', { class: hero ? 'tile tile-hero' : 'tile' });
  item.append(
    h(doc, 'p', { class: 'tile-label' }, label),
    h(doc, 'p', { class: 'tile-value' }, value),
  );
  if (note) item.append(h(doc, 'p', { class: 'tile-note' }, note));
  return item;
}

const INK_DARK = [0x10, 0x12, 0x15];
const INK_LIGHT = [0xf5, 0xf6, 0xf8];

/** WCAG relative luminance of an sRGB color (channels 0 to 255). */
export function relativeLuminance(rgb) {
  const [r, g, b] = rgb.map((c) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio of two sRGB colors, from 1 to 21. */
export function contrastRatio(a, b) {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const hex = (rgb) => `#${rgb.map((c) => c.toString(16).padStart(2, '0')).join('')}`;

/**
 * The ramp stops 78% of the way to the series color: past that, up to about 88%, neither ink
 * reaches 4.5:1 (WCAG AA for the table's small text), and light ink keeps at least 4.6:1 below it.
 */
const RAMP_END = 0.78;

/**
 * Mixes the card surface toward the first series color by `share` (a one-hue ramp), with the
 * ink (dark or light) that has the higher contrast on it.
 */
export function heatColor(share) {
  const from = [0x1b, 0x1e, 0x23];
  const to = [0xe8, 0x5c, 0x0f];
  const t = Math.min(1, Math.max(0, share)) * RAMP_END;
  const mix = from.map((c, i) => Math.round(c + (to[i] - c) * t));
  const ink = contrastRatio(mix, INK_DARK) > contrastRatio(mix, INK_LIGHT) ? INK_DARK : INK_LIGHT;
  return { background: `rgb(${mix.join(', ')})`, ink: hex(ink), rgb: mix, inkRgb: ink };
}

/** Builds every panel from normalized stats into a fragment. */
export function renderDashboard(doc, stats, width) {
  const out = doc.createDocumentFragment();
  const chartWidth = Math.max(280, width - 42);
  const users = stats.usersWindowDays
    ? `People are counted over the last ${stats.usersWindowDays} days.`
    : '';

  out.append(
    h(
      doc,
      'p',
      { class: 'dash-meta' },
      `Last ${stats.range} days, as of ${formatGeneratedAt(stats.generatedAt)}. ${users} ` +
        'To change the range, pick it above and enter the code again.',
    ),
  );

  // At a glance
  const o = stats.overview;
  const tiles = h(doc, 'ul', { class: 'tiles', 'aria-label': 'At a glance' });
  tiles.append(
    tile(doc, 'Active in the last 7 days', formatCompact(o.wau), 'Distinct phones', true),
    tile(doc, 'Active today', formatCompact(o.activeToday)),
    tile(doc, 'Active in the last 30 days', formatCompact(o.mau)),
    tile(
      doc,
      'New phones',
      formatCompact(o.newInstalls),
      `In the last ${stats.range} days. Testers from before alpha 27 are not counted.`,
    ),
    tile(doc, 'All phones', formatCompact(o.installs), 'Since counting began'),
    tile(doc, 'Sessions', formatCompact(o.sessions), `In the last ${stats.range} days`),
    tile(doc, 'Average session', formatDuration(o.avgSessionSec)),
  );
  out.append(tiles);

  // Active people
  const active = section(
    doc,
    'Active people',
    'Distinct phones that used the app that day, in the 7 days and in the 30 days up to it.',
  );
  if (stats.active.length === 0) active.append(empty(doc));
  else {
    active.append(
      lineChart(doc, {
        rows: stats.active,
        series: [
          { key: 'dau', label: 'That day' },
          { key: 'wau', label: 'Last 7 days' },
          { key: 'mau', label: 'Last 30 days' },
        ],
        width: chartWidth,
        formatY: formatCompact,
        formatX: (row) => formatDay(row.day),
        ariaLabel: 'Active phones per day, as three lines. The table below has every value.',
      }),
      dataTable(doc, {
        caption: 'Active phones per day',
        columns: [
          { label: 'Day', value: (r) => r.day },
          { label: 'That day', value: (r) => formatCount(r.dau), num: true },
          { label: '7 days', value: (r) => formatCount(r.wau), num: true },
          { label: '30 days', value: (r) => formatCount(r.mau), num: true },
        ],
        rows: stats.active,
      }),
    );
  }
  out.append(active);

  // Sessions
  const sessions = section(
    doc,
    'Sessions',
    'Times the app was opened each day. Hover or use the arrow keys for the average length.',
  );
  if (stats.sessions.length === 0) sessions.append(empty(doc));
  else {
    sessions.append(
      columnChart(doc, {
        rows: stats.sessions,
        value: (row) => row.sessions,
        width: chartWidth,
        formatY: formatCompact,
        formatX: (row) => formatDay(row.day),
        ariaLabel: 'Sessions per day, as columns. The table below has every value.',
        describe: (row) => [
          tooltipRow(
            doc,
            null,
            formatCount(row.sessions),
            row.sessions === 1 ? 'session' : 'sessions',
          ),
          tooltipRow(doc, null, formatDuration(row.avgSec), 'on average'),
        ],
      }),
      dataTable(doc, {
        caption: 'Sessions per day',
        columns: [
          { label: 'Day', value: (r) => r.day },
          { label: 'Sessions', value: (r) => formatCount(r.sessions), num: true },
          { label: 'Average length', value: (r) => formatDuration(r.avgSec), num: true },
        ],
        rows: stats.sessions,
      }),
    );
  }
  out.append(sessions);

  // Features and stickiness side by side on wide screens
  const pair = h(doc, 'div', { class: 'panel-grid two' });
  const totals = featureTotals(stats.features, stats.stickiness);
  const features = section(
    doc,
    'What gets used',
    'Feature events by count in the range, with the people who used each one.',
  );
  if (totals.length === 0) features.append(empty(doc));
  else {
    features.append(
      hbarList(doc, {
        rows: totals.slice(0, TOP_ROWS).map((f) => ({
          label: humanizeName(f.name),
          sub: `${f.usersExact ? '' : 'at least '}${plural(f.users, 'person', 'people')}`,
          value: f.count,
          text: formatCompact(f.count),
        })),
      }),
      dataTable(doc, {
        caption: 'Feature events by name and detail',
        columns: [
          { label: 'Feature', value: (r) => humanizeName(r.name) },
          { label: 'Detail', value: (r) => humanizeProps(r.props) || 'none' },
          { label: 'Count', value: (r) => formatCount(r.count), num: true },
          { label: 'People', value: (r) => formatCount(r.users), num: true },
        ],
        rows: stats.features,
      }),
    );
  }
  const sticky = section(
    doc,
    'Useful or not',
    'Share of everyone active who used a feature on two or more days. Low means tried, not kept.',
  );
  if (stats.stickiness.length === 0) sticky.append(empty(doc));
  else {
    sticky.append(
      hbarList(doc, {
        max: 1,
        rows: stats.stickiness.slice(0, TOP_ROWS).map((r) => ({
          label: humanizeName(r.feature),
          sub: `${formatCount(r.repeatUsers)} of ${plural(r.users, 'person', 'people')} came back to it`,
          value: r.share,
          text: formatPercent(r.share),
        })),
      }),
      dataTable(doc, {
        caption: 'Repeat use by feature',
        columns: [
          { label: 'Feature', value: (r) => humanizeName(r.feature) },
          { label: 'People', value: (r) => formatCount(r.users), num: true },
          { label: 'On 2+ days', value: (r) => formatCount(r.repeatUsers), num: true },
          { label: 'Share of active', value: (r) => formatPercent(r.share), num: true },
        ],
        rows: stats.stickiness,
      }),
    );
  }
  pair.append(features, sticky);
  out.append(pair);

  // Screens and taps
  const pair2 = h(doc, 'div', { class: 'panel-grid two' });
  const screens = section(doc, 'Screens', 'Views in the range, with people and time on screen.');
  if (stats.screens.length === 0) screens.append(empty(doc));
  else {
    screens.append(
      hbarList(doc, {
        rows: stats.screens.slice(0, TOP_ROWS).map((r) => ({
          label: r.screen || '(unknown)',
          sub: `${plural(r.users, 'person', 'people')} · ${formatDuration(r.seconds)}`,
          value: r.views,
          text: formatCompact(r.views),
        })),
      }),
      dataTable(doc, {
        caption: 'Screen views',
        columns: [
          { label: 'Screen', value: (r) => r.screen },
          { label: 'Views', value: (r) => formatCount(r.views), num: true },
          { label: 'People', value: (r) => formatCount(r.users), num: true },
          { label: 'Time', value: (r) => formatDuration(r.seconds), num: true },
        ],
        rows: stats.screens,
      }),
    );
  }
  const taps = section(doc, 'Taps', 'Controls by taps in the range, with the screen they were on.');
  if (stats.taps.length === 0) taps.append(empty(doc));
  else {
    taps.append(
      hbarList(doc, {
        rows: stats.taps.slice(0, TOP_ROWS).map((r) => ({
          label: r.control || '(unlabeled)',
          sub: `${r.screen || '(unknown)'} · ${plural(r.users, 'person', 'people')}`,
          value: r.count,
          text: formatCompact(r.count),
        })),
      }),
      dataTable(doc, {
        caption: 'Taps by control',
        columns: [
          { label: 'Control', value: (r) => r.control },
          { label: 'Screen', value: (r) => r.screen },
          { label: 'Taps', value: (r) => formatCount(r.count), num: true },
          { label: 'People', value: (r) => formatCount(r.users), num: true },
        ],
        rows: stats.taps,
      }),
    );
  }
  pair2.append(screens, taps);
  out.append(pair2);

  // Funnels
  const pair3 = h(doc, 'div', { class: 'panel-grid two' });
  const funnel = (title, sub, steps, labelOf) => {
    const panel = section(doc, title, sub);
    const rows = funnelRows(steps.map((r) => ({ label: labelOf(r), installs: r.installs })));
    if (rows.length === 0 || rows[0].installs === 0) {
      panel.append(empty(doc, 'No new phones in this window yet.'));
      return panel;
    }
    panel.append(
      hbarList(doc, {
        max: rows[0].installs,
        rows: rows.map((r, i) => ({
          label: r.label,
          sub:
            i === 0
              ? 'Everyone in this group'
              : `${formatPercent(r.ofPrevious)} of the step before`,
          value: r.installs,
          text: `${formatCount(r.installs)} · ${formatPercent(r.ofFirst)}`,
        })),
      }),
      dataTable(doc, {
        caption: title,
        columns: [
          { label: 'Step', value: (r) => r.label },
          { label: 'Phones', value: (r) => formatCount(r.installs), num: true },
          { label: 'Of first', value: (r) => formatPercent(r.ofFirst), num: true },
          { label: 'Of previous', value: (r) => formatPercent(r.ofPrevious), num: true },
        ],
        rows,
      }),
    );
    return panel;
  };
  pair3.append(
    funnel(
      'Onboarding',
      'Only phones that finished the tour send counts, so the steps up to page 5 read close to ' +
        '100% and people who quit earlier are missing. This shows skipped pages and unfinished ' +
        'questions, not where people quit: compare new phones with downloads for that. Replays ' +
        'do not count.',
      stats.funnels.onboarding,
      (r) => stepLabel(r.step),
    ),
    funnel(
      'First week',
      'New phones first seen at least 7 days ago, by what they did in their first 7 days. ' +
        'Testers from before alpha 27 are left out, and so are people who quit before the end ' +
        'of the tour.',
      stats.funnels.firstWeek,
      (r) => stepLabel(r.milestone),
    ),
  );
  out.append(pair3);

  // Retention
  const retention = section(
    doc,
    'Retention',
    'New phones by the week they were first seen, and the share active again on day 1, 7 or 30 or later. Testers from before alpha 27 are left out. A dash means too soon to tell.',
  );
  if (stats.retention.length === 0) retention.append(empty(doc));
  else {
    const wrap = h(doc, 'div', { class: 'table-wrap' });
    const table = h(doc, 'table', { class: 'data-table' });
    table.append(h(doc, 'caption', { class: 'visually-hidden' }, 'Retention by first week'));
    const head = h(doc, 'tr');
    for (const [label, num] of [
      ['First week', false],
      ['Phones', true],
      ['Day 1', true],
      ['Day 7', true],
      ['Day 30', true],
    ]) {
      head.append(h(doc, 'th', { scope: 'col', class: num ? 'num' : undefined }, label));
    }
    const thead = h(doc, 'thead');
    thead.append(head);
    const tbody = h(doc, 'tbody');
    for (const row of stats.retention) {
      const tr = h(doc, 'tr');
      tr.append(
        h(doc, 'td', {}, `Week of ${formatDay(row.cohortWeek)}`),
        h(doc, 'td', { class: 'num' }, formatCount(row.installs)),
      );
      for (const count of [row.d1, row.d7, row.d30]) {
        const share = retentionShare(count, row.installs);
        const cell = h(doc, 'td', { class: 'heat' });
        if (share === null) cell.textContent = '–';
        else {
          const color = heatColor(share);
          cell.style.backgroundColor = color.background;
          cell.style.color = color.ink;
          cell.textContent = `${formatPercent(share)} (${formatCount(count)})`;
        }
        tr.append(cell);
      }
      tbody.append(tr);
    }
    table.append(thead, tbody);
    wrap.append(table);
    retention.append(wrap);
  }
  out.append(retention);

  // Builds, Ares, AI cost, database
  const pair4 = h(doc, 'div', { class: 'panel-grid two' });
  const builds = section(doc, 'Builds', 'Phones active in the range, by the build they last ran.');
  if (stats.versions.length === 0) builds.append(empty(doc));
  else {
    builds.append(
      hbarList(doc, {
        rows: stats.versions.map((r) => ({
          label: `Alpha ${r.build}`,
          value: r.installs,
          text: formatCount(r.installs),
        })),
      }),
      dataTable(doc, {
        caption: 'Phones by build',
        columns: [
          { label: 'Build', value: (r) => `Alpha ${r.build}` },
          { label: 'Phones', value: (r) => formatCount(r.installs), num: true },
        ],
        rows: stats.versions,
      }),
    );
  }
  const cost = section(
    doc,
    'AI cost',
    'Calls to the language model by function, with the estimated cost.',
  );
  if (stats.llmCost.length === 0) cost.append(empty(doc));
  else {
    const total = stats.llmCost.reduce((sum, r) => sum + r.costUsd, 0);
    const calls = stats.llmCost.reduce((sum, r) => sum + r.calls, 0);
    const summary = h(doc, 'ul', { class: 'tiles' });
    summary.append(
      tile(doc, 'Estimated cost', formatUsd(total)),
      tile(doc, 'Calls', formatCompact(calls)),
    );
    cost.append(
      summary,
      h(doc, 'div', { class: 'spacer' }),
      hbarList(doc, {
        rows: stats.llmCost.map((r) => ({
          label: r.fn,
          sub: plural(r.calls, 'call', 'calls'),
          value: r.costUsd,
          text: formatUsd(r.costUsd),
        })),
      }),
      dataTable(doc, {
        caption: 'AI cost by function',
        columns: [
          { label: 'Function', value: (r) => r.fn },
          { label: 'Calls', value: (r) => formatCount(r.calls), num: true },
          { label: 'Cost', value: (r) => formatUsd(r.costUsd), num: true },
        ],
        rows: stats.llmCost,
      }),
    );
  }
  pair4.append(builds, cost);
  out.append(pair4);

  const ares = section(
    doc,
    'Ares',
    'Questions sent in the chat (retries not counted) and the actions Ares ran.',
  );
  const aresTiles = h(doc, 'ul', { class: 'tiles' });
  aresTiles.append(
    tile(doc, 'Questions', formatCompact(stats.ares.chats)),
    tile(doc, 'People who asked', formatCompact(stats.ares.chatUsers)),
  );
  ares.append(aresTiles);
  const tools = toolRows(stats.ares.tools);
  if (tools.length > 0) {
    ares.append(
      h(doc, 'div', { class: 'spacer' }),
      hbarList(doc, {
        rows: tools.slice(0, TOP_ROWS).map((r) => ({
          label: humanizeName(r.tool),
          sub: `${formatCount(r.done)} done · ${formatCount(r.failed)} failed · ${formatCount(r.waiting)} waiting · ${formatCount(r.not_run)} not run`,
          value: r.total,
          text: formatCompact(r.total),
        })),
      }),
      dataTable(doc, {
        caption: 'Ares actions by tool and outcome',
        columns: [
          { label: 'Action', value: (r) => humanizeName(r.tool) },
          { label: 'Done', value: (r) => formatCount(r.done), num: true },
          { label: 'Failed', value: (r) => formatCount(r.failed), num: true },
          { label: 'Waiting', value: (r) => formatCount(r.waiting), num: true },
          { label: 'Not run', value: (r) => formatCount(r.not_run), num: true },
          { label: 'Total', value: (r) => formatCount(r.total), num: true },
        ],
        rows: tools,
      }),
    );
  } else {
    ares.append(empty(doc, 'No Ares actions in this range yet.'));
  }
  out.append(ares);

  const db = section(
    doc,
    'Database',
    "The project's database size. Supabase's free plan allows 500 MB.",
  );
  const share = Math.min(1, stats.dbBytes / DB_LIMIT_BYTES);
  db.append(
    h(doc, 'p', { class: 'tile-value' }, formatBytes(stats.dbBytes)),
    h(doc, 'p', { class: 'tile-note' }, `${formatPercent(share)} of 500 MB`),
  );
  const meter = h(doc, 'div', {
    class: 'meter',
    role: 'meter',
    'aria-label': 'Database size against 500 MB',
    'aria-valuemin': 0,
    'aria-valuemax': 100,
    'aria-valuenow': Math.round(share * 100),
  });
  const fill = h(doc, 'div', { class: 'meter-fill' });
  fill.style.width = `${(share * 100).toFixed(1)}%`;
  meter.append(fill);
  db.append(meter);
  out.append(db);
  return out;
}

/** Wires the page. Exported for the DOM test; runs on load in the browser. */
export function initAdmin(doc, win, deps = {}) {
  const form = doc.getElementById('unlock');
  const input = doc.getElementById('code');
  const button = doc.getElementById('unlock-button');
  const notice = doc.getElementById('notice');
  const dashboard = doc.getElementById('dashboard');
  if (!form || !input || !button || !notice || !dashboard) return null;
  const now = deps.now ?? (() => Date.now());
  const request = deps.requestStats ?? requestStats;

  let stats = null;
  // The width the charts were last drawn at; a resize that keeps it (a phone's toolbar hiding as
  // the page scrolls) draws nothing.
  let drawnWidth = 0;
  let lockedUntil = 0;
  let countdown = null;
  let busy = false;

  const say = (text, tone) => {
    notice.textContent = text;
    notice.className = `notice${tone ? ` notice-${tone}` : ''}`;
  };

  const draw = ({ keepOpen = false } = {}) => {
    if (!stats) return;
    // Shown first: a hidden element measures 0 wide, and the charts are drawn at the real width
    // so their text stays at its real size on a phone.
    dashboard.hidden = false;
    const width = dashboard.clientWidth || 720;
    // A redraw of the same numbers keeps the table views that were open.
    const open = keepOpen ? [...dashboard.querySelectorAll('details')].map((d) => d.open) : [];
    drawnWidth = width;
    dashboard.replaceChildren(renderDashboard(doc, stats, width));
    dashboard.querySelectorAll('details').forEach((d, i) => {
      if (open[i]) d.open = true;
    });
  };

  const tickLock = () => {
    const left = Math.ceil((lockedUntil - now()) / 1000);
    if (left <= 0) {
      win.clearInterval(countdown);
      countdown = null;
      lockedUntil = 0;
      button.disabled = false;
      say('You can try again now.');
      return;
    }
    say(`Locked after too many wrong codes. Try again in ${formatWait(left)}.`, 'locked');
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy || now() < lockedUntil) return;
    // The only copy of the code: read, cleared from the field at once, sent once, dropped.
    let code = input.value.trim();
    input.value = '';
    if (!code) {
      say('Enter the code.', 'error');
      input.focus();
      return;
    }
    const range = Number(new win.FormData(form).get('range')) || 30;
    busy = true;
    button.disabled = true;
    dashboard.setAttribute('aria-busy', 'true');
    say(`Loading the last ${range} days…`);
    const result = await request({ code, range });
    code = '';
    busy = false;
    dashboard.removeAttribute('aria-busy');
    if (result.kind === 'ok') {
      stats = normalizeStats(result.stats);
      button.disabled = false;
      say(`Loaded the last ${stats.range || range} days.`, 'ok');
      draw();
      return;
    }
    if (result.kind === 'locked') {
      lockedUntil = now() + result.retryAfterSec * 1000;
      if (countdown) win.clearInterval(countdown);
      countdown = win.setInterval(tickLock, 1000);
      tickLock();
      return;
    }
    button.disabled = false;
    say(resultMessage(result), 'error');
    input.focus();
  });

  // Back and forward: a page restored from the cache reloads, so the code is asked again and
  // no numbers from the last visit linger.
  win.addEventListener('pageshow', (event) => {
    if (event.persisted) win.location.reload();
  });
  win.addEventListener('pagehide', () => {
    input.value = '';
  });

  let resizeTimer = null;
  win.addEventListener('resize', () => {
    if (resizeTimer) win.clearTimeout(resizeTimer);
    resizeTimer = win.setTimeout(() => {
      resizeTimer = null;
      if (!stats || (dashboard.clientWidth || 720) === drawnWidth) return;
      draw({ keepOpen: true });
    }, 200);
  });

  return { draw };
}
