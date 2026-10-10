/**
 * The product page's entrance motion (ADR-0234): each `.reveal` element fades and rises once as
 * it scrolls into view. The page is complete without it: the hiding rule in site.css applies only
 * under `html.reveal-ready`, which this adds, and it adds nothing under Reduce Motion or in a
 * browser without IntersectionObserver. Whatever is already on screen is shown at once, so
 * nothing in view blinks out while the script starts.
 */

export const READY_CLASS = 'reveal-ready';
export const IN_CLASS = 'is-in';

/** Starts the motion; returns false when it stays off (nothing to move, no observer, Reduce Motion). */
export function initReveal(root, win) {
  const items = Array.from(root.querySelectorAll('.reveal'));
  if (items.length === 0 || typeof win.IntersectionObserver !== 'function') return false;
  if (win.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return false;

  const height = win.innerHeight || 0;
  const pending = [];
  for (const item of items) {
    if (item.getBoundingClientRect().top < height) item.classList.add(IN_CLASS);
    else pending.push(item);
  }

  const observer = new win.IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add(IN_CLASS);
        observer.unobserve(entry.target);
      }
    },
    { rootMargin: '0px 0px -8% 0px' },
  );
  for (const item of pending) observer.observe(item);
  root.documentElement.classList.add(READY_CLASS);
  return true;
}
