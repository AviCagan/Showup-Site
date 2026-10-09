/**
 * The website's configuration (ADR-0231). Public values only.
 *
 * The anon key is the project's public key (role "anon"), the same one every APK ships with.
 * Row-level security lets it read `app_releases` and call functions that check their own input;
 * it reads nothing personal. Never put a service-role key, the admin code or any other secret in
 * this folder: web/__tests__/site.test.ts fails when one appears.
 */

export const SUPABASE_URL = 'https://lkamzjbnbgkrzbdnymdo.supabase.co';

export const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxrYW16amJuYmdrcnpiZG55bWRvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg4ODA1MDIsImV4cCI6MjEwNDQ1NjUwMn0.0MBORUeSvn3hBstSzbUbEvmiC9OgClf23K65rb3Uy7s';

/**
 * The Drive folder every Android test build is uploaded to (src/constants/release.ts
 * LATEST_RELEASE_FOLDER_URL; a test keeps the two equal). The download button falls back to it.
 */
export const LATEST_RELEASE_FOLDER_URL =
  'https://drive.google.com/drive/folders/13I0DaDsG_P3ZN90aHb_2YQKR6-gk0VIZ';

/**
 * The newest Android build: the app's own query (src/services/appUpdate/latestRelease.ts
 * LATEST_RELEASE_PATH) plus `published_at` for the date. A test keeps the two in step.
 */
export const RELEASE_PATH =
  '/rest/v1/app_releases?select=alpha,download_url,published_at&platform=eq.android' +
  '&order=alpha.desc&limit=1';

/** Short, like the app's check: a slow answer is worth nothing to someone reading the page. */
export const RELEASE_TIMEOUT_MS = 6000;

/** The admin page's aggregates (supabase/functions/usage-stats, ADR-0229). */
export const STATS_PATH = '/functions/v1/usage-stats';

/**
 * The page addresses the usage-stats function answers (its ALLOWED_ORIGINS in
 * supabase/functions/usage-stats/handler.ts; web/__tests__/stats.test.js keeps the two equal).
 * From any other address the browser hides the function's answer, so the page says so before it
 * sends anything.
 */
export const STATS_ORIGINS = ['https://avicagan.github.io', 'http://localhost:8080'];

/** The stats function answers within 25 s; the page waits a little longer before giving up. */
export const STATS_TIMEOUT_MS = 30000;
