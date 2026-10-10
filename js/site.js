/**
 * Entry for the product and download pages (ADR-0231, ADR-0234): the live build line and
 * download link, and the entrance motion. Both are enhancements; the pages read fine without them.
 */
import { initRelease } from './release.js';
import { initReveal } from './reveal.js';

initReveal(document, window);
initRelease(document);
