// @vitest-environment jsdom

/* The seam between the works table and the parts table.
 *
 * The two tables stack, share a column layout, and the lower one silently swaps
 * its contents when a row in the upper one is clicked — so "which of these am I
 * reading" was a real question in front of a customer. The separator and the
 * two surfaces are the answer, and they are structure rather than decoration:
 * a class name typo in a CSS module fails silently, and so does a divider that
 * renders only on the branch nobody hits.
 */

import type { TicketWork } from '@garage/shared';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WorksStep from './WorksStep';
import styles from './WorksStep.module.css';

vi.mock('../usePickers', () => ({
  usePickWork: () => vi.fn(),
  usePickPart: () => vi.fn(),
}));

// i18next is not initialised here, so t() returns the key.
const work = (uid: string, over: Partial<TicketWork> = {}): TicketWork => ({
  uid, code: 'BR1', name: `עבודה ${uid}`, labor: 100, items: [], ...over,
});

const panels = (container: HTMLElement) => ({
  works: container.querySelector(`.${styles.worksCol}`),
  parts: container.querySelector(`.${styles.partsCol}`),
  divider: container.querySelector(`.${styles.divider}`),
});

afterEach(cleanup);

describe('the works / parts split', () => {
  it('draws a labelled separator between the two halves', () => {
    const { container } = render(<WorksStep works={[work('w1')]} setWorks={vi.fn()} />);
    const { divider } = panels(container);

    expect(divider).not.toBeNull();
    expect(screen.getByText('works.partsDivider')).not.toBeNull();
  });

  /* An empty ticket is where the two panels look most alike — both are empty
     states with an icon and a button — so it is the case the separation exists
     for, not one to skip. */
  it('separates them on an empty ticket too', () => {
    const { container } = render(<WorksStep works={[]} setWorks={vi.fn()} />);
    const { works, parts, divider } = panels(container);

    expect(works).not.toBeNull();
    expect(parts).not.toBeNull();
    expect(divider).not.toBeNull();
  });

  it('gives each half its own surface, in order: works, seam, parts', () => {
    const { container } = render(<WorksStep works={[work('w1')]} setWorks={vi.fn()} />);
    const { works, parts, divider } = panels(container);

    // Distinct elements, not one panel matching both class names.
    expect(works).not.toBe(parts);
    expect(works!.compareDocumentPosition(divider!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(divider!.compareDocumentPosition(parts!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  /* combinedEmpty is the new-ticket page's one shared empty state — one panel,
     no seam, because there is nothing yet to be on either side of it. */
  it('draws no seam when the two halves collapse into one empty state', () => {
    const { container } = render(<WorksStep works={[]} setWorks={vi.fn()} combinedEmpty />);
    expect(panels(container).divider).toBeNull();
  });
});
