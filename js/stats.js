/**
 * The admin page's data layer (ADR-0231): the request to the `usage-stats` function, what its
 * answer means, and the shaping and formatting of the aggregates. No DOM here, so Jest can test
 * all of it (web/__tests__/stats.test.ts).
 *
 * The code the founder types is a parameter of `requestStats` and nothing else: it is never
 * stored, logged or put in a URL, and the caller drops it as soon as the request is sent.
 */
import {
  STATS_ORIGINS,
  STATS_PATH,
  STATS_TIMEOUT_MS,
  SUPABASE_ANON_KEY,
  SUPABASE_URL,
} from './config.js';

export const RANGES = [7, 30, 90];

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * What an answer means for the page: `ok` with the stats, `wrong_code`, `locked` (with seconds
 * until the next try), `bad_request`, `origin` (this page's address is not allowed), `server`
 * (the function or the database failed), or `unexpected` for anything else (a gateway error).
 */
export function classifyResponse(status, body) {
  const reason = isRecord(body) && typeof body.reason === 'string' ? body.reason : null;
  if (status === 200 && isRecord(body) && body.ok === true) return { kind: 'ok', stats: body };
  if (status === 401 && reason === 'wrong_code') return { kind: 'wrong_code' };
  if (status === 429) {
    const raw = isRecord(body) ? Number(body.retryAfterSec) : NaN;
    const retryAfterSec = Number.isFinite(raw) && raw > 0 ? Math.ceil(raw) : 15 * 60;
    return { kind: 'locked', retryAfterSec };
  }
  if (status === 400) return { kind: 'bad_request' };
  if (status === 403 && reason === 'origin') return { kind: 'origin' };
  if (status >= 500) return { kind: 'server' };
  return { kind: 'unexpected', status };
}

/**
 * POSTs `{ code, range }` and resolves with a classified result; never rejects. `origin` is this
 * page's (the browser's `location.origin`): from an address the function does not answer, the
 * browser would hide its 403 and the failure would read as a network problem, so nothing is sent.
 */
export async function requestStats({
  code,
  range,
  fetch: fetchImpl,
  timeoutMs,
  origin = globalThis.location?.origin,
}) {
  if (typeof origin === 'string' && !STATS_ORIGINS.includes(origin)) return { kind: 'origin' };
  const doFetch = fetchImpl ?? globalThis.fetch;
  if (typeof doFetch !== 'function') return { kind: 'network' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs ?? STATS_TIMEOUT_MS);
  try {
    let response;
    try {
      response = await doFetch(`${SUPABASE_URL}${STATS_PATH}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ code, range }),
        cache: 'no-store',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        signal: controller.signal,
      });
    } catch {
      return { kind: 'network' };
    }
    let body = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    return classifyResponse(response.status, body);
  } finally {
    clearTimeout(timer);
  }
}

/** The line the page shows for a result that is not `ok`. */
export function resultMessage(result) {
  switch (result.kind) {
    case 'wrong_code':
      return 'That code is not right.';
    case 'locked':
      return `Locked after too many wrong codes. Try again in ${formatWait(result.retryAfterSec)}.`;
    case 'bad_request':
      return 'The server did not accept the request. Reload the page and try again.';
    case 'origin':
      return 'The server answers only the published page and http://localhost:8080. Open it from one of those.';
    case 'server':
      return 'The server could not load the numbers. Try again in a minute.';
    case 'network':
      return 'Could not reach the server. Check the connection and try again.';
    default:
      return `Unexpected answer from the server (${result.status ?? 'none'}).`;
  }
}

// ---------- Shaping ----------

function num(value) {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : 0;
}

function numOrNull(value) {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

function str(value) {
  return typeof value === 'string'
    ? value
    : value === null || value === undefined
      ? ''
      : String(value);
}

function list(value) {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

/**
 * The answer with every field the contract names present and typed: missing arrays become empty,
 * missing numbers 0 (or null where "not yet" means something), so a partial answer still renders.
 */
export function normalizeStats(body) {
  const b = isRecord(body) ? body : {};
  const overview = isRecord(b.overview) ? b.overview : {};
  const funnels = isRecord(b.funnels) ? b.funnels : {};
  const ares = isRecord(b.ares) ? b.ares : {};
  return {
    generatedAt: str(b.generatedAt),
    range: num(b.range),
    usersWindowDays: numOrNull(b.usersWindowDays),
    overview: {
      installs: num(overview.installs),
      activeToday: num(overview.activeToday),
      wau: num(overview.wau),
      mau: num(overview.mau),
      sessions: num(overview.sessions),
      avgSessionSec: num(overview.avgSessionSec),
      newInstalls: num(overview.newInstalls),
    },
    active: list(b.active).map((r) => ({
      day: str(r.day),
      dau: num(r.dau),
      wau: num(r.wau),
      mau: num(r.mau),
    })),
    sessions: list(b.sessions).map((r) => ({
      day: str(r.day),
      sessions: num(r.sessions),
      avgSec: num(r.avgSec),
    })),
    screens: list(b.screens).map((r) => ({
      screen: str(r.screen),
      views: num(r.views),
      users: num(r.users),
      seconds: num(r.seconds),
    })),
    features: list(b.features).map((r) => ({
      name: str(r.name),
      props: str(r.props),
      count: num(r.count),
      users: num(r.users),
    })),
    taps: list(b.taps).map((r) => ({
      control: str(r.control),
      screen: str(r.screen),
      count: num(r.count),
      users: num(r.users),
    })),
    stickiness: list(b.stickiness).map((r) => ({
      feature: str(r.feature),
      users: num(r.users),
      repeatUsers: num(r.repeatUsers),
      share: num(r.share),
    })),
    funnels: {
      onboarding: list(funnels.onboarding).map((r) => ({
        step: str(r.step),
        installs: num(r.installs),
      })),
      firstWeek: list(funnels.firstWeek).map((r) => ({
        milestone: str(r.milestone),
        installs: num(r.installs),
      })),
    },
    retention: list(b.retention).map((r) => ({
      cohortWeek: str(r.cohortWeek),
      installs: num(r.installs),
      d1: numOrNull(r.d1),
      d7: numOrNull(r.d7),
      d30: numOrNull(r.d30),
    })),
    versions: list(b.versions).map((r) => ({ build: num(r.build), installs: num(r.installs) })),
    ares: {
      chats: num(ares.chats),
      chatUsers: num(ares.chatUsers),
      tools: list(ares.tools).map((r) => ({
        tool: str(r.tool),
        status: str(r.status),
        count: num(r.count),
      })),
    },
    llmCost: list(b.llmCost).map((r) => ({
      fn: str(r.fn),
      calls: num(r.calls),
      costUsd: num(r.costUsd),
    })),
    dbBytes: num(b.dbBytes),
  };
}

/**
 * Features summed by event name (each row of `features` is one name and props combination).
 * People come from `stickiness`, which counts distinct phones per name; without it the largest
 * combination's count stands in (a floor, since one phone can use several combinations).
 */
export function featureTotals(features, stickiness) {
  const people = new Map(stickiness.map((s) => [s.feature, s.users]));
  const byName = new Map();
  for (const row of features) {
    const entry = byName.get(row.name) ?? { name: row.name, count: 0, users: 0, variants: 0 };
    entry.count += row.count;
    entry.users = Math.max(entry.users, row.users);
    entry.variants += 1;
    byName.set(row.name, entry);
  }
  return [...byName.values()]
    .map((entry) => ({
      ...entry,
      users: people.get(entry.name) ?? entry.users,
      usersExact: people.has(entry.name),
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/** Funnel rows with each step's share of the first step and of the step before it. */
export function funnelRows(steps) {
  const first = steps[0]?.installs ?? 0;
  return steps.map((step, i) => {
    const previous = i === 0 ? step.installs : steps[i - 1].installs;
    return {
      ...step,
      ofFirst: first > 0 ? step.installs / first : 0,
      ofPrevious: previous > 0 ? step.installs / previous : 0,
    };
  });
}

/** A retention cell: the share still active, or null while the cohort is too young to tell. */
export function retentionShare(count, installs) {
  if (count === null || installs <= 0) return null;
  return Math.min(1, Math.max(0, count / installs));
}

export const TOOL_STATUSES = ['done', 'failed', 'waiting', 'not_run'];

/** Ares tool runs, one row per tool with a column per status, busiest first. */
export function toolRows(tools) {
  const byTool = new Map();
  for (const row of tools) {
    const entry = byTool.get(row.tool) ?? {
      tool: row.tool,
      done: 0,
      failed: 0,
      waiting: 0,
      not_run: 0,
      other: 0,
      total: 0,
    };
    if (TOOL_STATUSES.includes(row.status)) entry[row.status] += row.count;
    else entry.other += row.count;
    entry.total += row.count;
    byTool.set(row.tool, entry);
  }
  return [...byTool.values()].sort((a, b) => b.total - a.total || a.tool.localeCompare(b.tool));
}

// ---------- Names ----------

const STEP_LABELS = {
  welcome_seen: 'Saw the welcome screen',
  signed_in: 'Signed in',
  page_1: 'Tour page 1',
  page_2: 'Tour page 2',
  page_3: 'Tour page 3',
  page_4: 'Tour page 4',
  page_5: 'Tour page 5',
  intake_completed: 'Finished the questions',
  onboarding_complete: 'Finished the tour',
  first_seen: 'New phones',
  first_workout_started: 'Started a workout',
  first_set_logged: 'Logged a set',
  first_workout_finished: 'Finished a workout',
  first_food_logged: 'Logged food',
  first_weight_logged: 'Logged a weigh-in',
  first_map_opened: 'Opened the map',
  first_report_opened: 'Opened the weekly report',
  first_ares_chat: 'Asked Ares',
  first_plan_accepted: 'Accepted a plan',
};

/** `set_logged` -> "Set logged". */
export function humanizeName(name) {
  const text = str(name).replace(/_/g, ' ').trim();
  return text ? text[0].toUpperCase() + text.slice(1) : '(none)';
}

export function stepLabel(step) {
  return STEP_LABELS[step] ?? humanizeName(step);
}

/** `set_type=normal;cardio=false` -> "set type normal · cardio false"; '' -> ''. */
export function humanizeProps(propsKey) {
  return str(propsKey)
    .split(';')
    .filter(Boolean)
    .map((pair) => {
      const [key, value = ''] = pair.split('=');
      return `${key.replace(/_/g, ' ')} ${value.replace(/_/g, ' ')}`.trim();
    })
    .join(' · ');
}

// ---------- Formatting ----------

const INTEGER = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const COMPACT = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

/** 1284 -> "1,284". */
export function formatCount(n) {
  return INTEGER.format(Math.round(num(n)));
}

/** 12900 -> "12.9K"; under 10,000 the full number. */
export function formatCompact(n) {
  const v = num(n);
  return Math.abs(v) < 10000 ? formatCount(v) : COMPACT.format(v);
}

/** 0.4231 -> "42%"; under 10% one decimal ("4.5%"). */
export function formatPercent(share) {
  const p = num(share) * 100;
  if (p > 0 && p < 10) return `${(Math.round(p * 10) / 10).toFixed(1)}%`;
  return `${Math.round(p)}%`;
}

/** Seconds as "45 s", "4 min 12 s", "1 h 5 min". */
export function formatDuration(seconds) {
  const s = Math.max(0, Math.round(num(seconds)));
  if (s < 60) return `${s} s`;
  if (s < 3600) {
    const m = Math.floor(s / 60);
    const rest = s % 60;
    return rest ? `${m} min ${rest} s` : `${m} min`;
  }
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** A lockout wait: "45 s", "14 min", rounded up to whole minutes past one minute. */
export function formatWait(seconds) {
  const s = Math.max(0, Math.ceil(num(seconds)));
  if (s < 60) return `${s} s`;
  return `${Math.ceil(s / 60)} min`;
}

/** Bytes as "512 KB", "48.2 MB", "1.3 GB". */
export function formatBytes(bytes) {
  const b = Math.max(0, num(bytes));
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  return `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** US dollars: "$12.30", and four decimals under a cent ("$0.0042"). */
export function formatUsd(amount) {
  const v = num(amount);
  if (v > 0 && v < 0.01) return `$${v.toFixed(4)}`;
  return `$${v.toFixed(2)}`;
}

const SHORT_DAY = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});
const DATE_TIME = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'UTC',
});

/** "2026-10-03" -> "Oct 3" (UTC). */
export function formatDay(day) {
  const time = Date.parse(`${str(day)}T00:00:00Z`);
  return Number.isFinite(time) ? SHORT_DAY.format(new Date(time)) : str(day);
}

/** An ISO time as "9 Oct 2026, 18:30 UTC". */
export function formatGeneratedAt(iso) {
  const time = Date.parse(str(iso));
  return Number.isFinite(time) ? `${DATE_TIME.format(new Date(time))} UTC` : '';
}

/**
 * Round numbers for an axis from 0 to at least `max`: steps of 1, 2, 2.5 or 5 x 10^k, about
 * `ticks` of them; whole numbers only when `integer` (counts of people never read 0.5).
 */
export function niceTicks(max, ticks = 4, integer = true) {
  const top = num(max);
  if (top <= 0) return [0, 1];
  const rough = top / ticks;
  const power = 10 ** Math.floor(Math.log10(rough));
  let step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= rough) ?? 10 * power;
  if (integer) step = Math.max(1, Math.ceil(step));
  const out = [];
  for (let v = 0; v < top + step * 0.999; v += step) out.push(Math.round(v * 1e6) / 1e6);
  if (out[out.length - 1] < top) out.push(out[out.length - 1] + step);
  return out;
}
