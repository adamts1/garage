// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import LandingPage from './LandingPage';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('LandingPage', () => {
  it.each([
    ['he', 'המוסך מתקדם.הניהול מתקדם איתו.', 'العربية', '/marketing/ar/'],
    ['ar', 'الكراج يتقدّم.والإدارة تتقدّم معه.', 'עברית', '/marketing/'],
  ] as const)('renders in %s and links to the other language', (lang, heading, switchLabel, switchHref) => {
    render(<LandingPage lang={lang} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(heading);
    expect(screen.getByRole('link', { name: switchLabel }).getAttribute('href')).toBe(switchHref);
  });

  it('sends the demo request as a WhatsApp message in the page language', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    render(<LandingPage lang="ar" />);
    fireEvent.change(screen.getByLabelText('الاسم الكامل'), { target: { value: 'سامي' } });
    fireEvent.change(screen.getByLabelText('الهاتف'), { target: { value: '0501234567' } });
    fireEvent.submit(screen.getByRole('button', { name: 'نسّقوا لي عرضًا' }));

    const url = new URL(open.mock.calls[0][0] as string);
    expect(url.origin + url.pathname).toBe('https://wa.me/972525600493');
    expect(url.searchParams.get('text')).toBe(
      'مرحبًا، أودّ تنسيق عرض تجريبي لـ Garagiox\nالاسم: سامي\nالكراج: -\nالهاتف: 0501234567',
    );
  });
});
