export type PageId = 'garages' | 'onboard' | 'migrations' | 'functions' | 'mobile';

/** Moves to a page. The page lives in the address (#onboard), so a refresh —
 *  or the dev server's own reload after an edit — keeps you where you were. */
export const goTo = (id: PageId) => {
  window.location.hash = id;
};
