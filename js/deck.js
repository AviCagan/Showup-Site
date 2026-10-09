/**
 * The product page's slide navigation (ADR-0231). The page works without it: the dot links are
 * plain anchors and the browser scrolls. This adds two things: the dot of the slide in view is
 * marked (`aria-current`), and the left and right arrow keys move one slide back or forward.
 */

/** The slide to go to from `index` when `key` is pressed, or -1 for none. */
export function slideForKey(key, index, count) {
  if (key === 'ArrowRight') return Math.min(count - 1, index + 1);
  if (key === 'ArrowLeft') return Math.max(0, index - 1);
  return -1;
}

function isTyping(target) {
  const tag = target && target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable;
}

export function initDeck(root, win) {
  const slides = Array.from(root.querySelectorAll('.slide[id]'));
  const dots = Array.from(root.querySelectorAll('.deck-dots a[href^="#"]'));
  if (slides.length === 0) return false;
  let current = 0;

  const mark = (index) => {
    current = index;
    const id = slides[index].id;
    for (const dot of dots) {
      if (dot.getAttribute('href') === `#${id}`) dot.setAttribute('aria-current', 'true');
      else dot.removeAttribute('aria-current');
    }
  };

  if (typeof win.IntersectionObserver === 'function') {
    const observer = new win.IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) mark(slides.indexOf(entry.target));
        }
      },
      { rootMargin: '-45% 0px -45% 0px' },
    );
    for (const slide of slides) observer.observe(slide);
  }

  win.addEventListener('keydown', (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey || isTyping(event.target)) return;
    const next = slideForKey(event.key, current, slides.length);
    if (next < 0 || next === current) return;
    event.preventDefault();
    const reduce = win.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    slides[next].scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    mark(next);
  });
  mark(0);
  return true;
}
