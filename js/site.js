/**
 * Entry for the product and download pages (ADR-0231): the live build line and download link,
 * and the slide navigation. Both are enhancements; the pages read fine without them.
 */
import { initDeck } from './deck.js';
import { initRelease } from './release.js';

initDeck(document, window);
initRelease(document);
