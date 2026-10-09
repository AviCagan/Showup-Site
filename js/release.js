/**
 * The newest Android test build, read live from `public.app_releases` the way the app's update
 * check reads it (src/services/appUpdate/latestRelease.ts, ADR-0227): one GET with the public
 * anon key, a 6 s timeout, a shape check of the row, and a link trusted only when it is an https
 * link on drive.google.com itself. Every failure leaves the page as it was: the download button
 * keeps the Drive folder link it was written with and the build line stays hidden.
 */
import {
  LATEST_RELEASE_FOLDER_URL,
  RELEASE_PATH,
  RELEASE_TIMEOUT_MS,
  SUPABASE_ANON_KEY,
  SUPABASE_URL,
} from './config.js';

/** latestRelease.ts DRIVE_LINK: https, the host exactly drive.google.com, printable ASCII after. */
const DRIVE_LINK = /^https:\/\/drive\.google\.com(?:[/?#][\x21-\x7e]*)?$/;
const URL_MAX_CHARS = 2048;
const ALPHA_MAX = 1000000;

/** The row's link when it is a Google Drive https link, else the Latest Release folder. */
export function safeReleaseUrl(value) {
  return typeof value === 'string' && value.length <= URL_MAX_CHARS && DRIVE_LINK.test(value)
    ? value
    : LATEST_RELEASE_FOLDER_URL;
}

export function isReleaseAlpha(value) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= ALPHA_MAX;
}

function parseDate(value) {
  if (typeof value !== 'string') return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time) : null;
}

/**
 * PostgREST's answer as `{ alpha, url, publishedAt }`, null for an empty list, 'invalid' for
 * anything else.
 */
export function parseLatestRelease(body) {
  if (!Array.isArray(body)) return 'invalid';
  if (body.length === 0) return null;
  const row = body[0];
  if (typeof row !== 'object' || row === null || !isReleaseAlpha(row.alpha)) return 'invalid';
  return {
    alpha: row.alpha,
    url: safeReleaseUrl(row.download_url),
    publishedAt: parseDate(row.published_at),
  };
}

const DATE_FORMAT = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

/** "Alpha 26 · 9 Oct 2026", or "Alpha 26" when the date is missing. */
export function releaseLabel(release) {
  const name = `Alpha ${release.alpha}`;
  return release.publishedAt ? `${name} · ${DATE_FORMAT.format(release.publishedAt)}` : name;
}

/**
 * Asks for the newest build. Resolves with `{ ok: true, latest }` (latest is null when none is
 * recorded) or `{ ok: false, reason }`; never rejects.
 */
export async function fetchLatestRelease(options = {}) {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') return { ok: false, reason: 'unsupported' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? RELEASE_TIMEOUT_MS);
  try {
    let response;
    try {
      response = await fetchImpl(`${SUPABASE_URL}${RELEASE_PATH}`, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
        signal: controller.signal,
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      });
    } catch {
      return { ok: false, reason: 'network' };
    }
    if (!response.ok) return { ok: false, reason: 'server' };
    let body;
    try {
      body = await response.json();
    } catch {
      return { ok: false, reason: 'server' };
    }
    const latest = parseLatestRelease(body);
    if (latest === 'invalid') return { ok: false, reason: 'invalid' };
    return { ok: true, latest };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Shows the build on the page: every `[data-release-label]` gets "Alpha 26 · 9 Oct 2026" and is
 * unhidden; every `[data-release-link]` points at the row's (checked) link. Anything else leaves
 * the page untouched.
 */
export function applyRelease(root, result) {
  if (!result.ok || !result.latest) return false;
  const label = releaseLabel(result.latest);
  for (const element of root.querySelectorAll('[data-release-label]')) {
    element.textContent = label;
    element.hidden = false;
  }
  for (const link of root.querySelectorAll('[data-release-link]')) {
    link.setAttribute('href', result.latest.url);
  }
  return true;
}

/** Reads the build and shows it, when the page has a place for it. */
export async function initRelease(root) {
  if (!root.querySelector('[data-release-label], [data-release-link]')) return false;
  return applyRelease(root, await fetchLatestRelease());
}
