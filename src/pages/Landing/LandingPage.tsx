/* The public face of Garagiox, at /marketing/ (Hebrew) and /marketing/ar/
   (Arabic). A page of its own, loaded by main.tsx beside the app — it shares
   no state, styles or routing with it. Title, description and structured data
   live in the two HTML files, where crawlers and link previews read them. */

import type { FormEvent } from 'react';
import { CONTACT, whatsappUrl } from './contact';
import { COPY } from './copy';
import { FEATURE_ICONS } from './icons';
import { LANDING_PATHS, type Lang } from './languages';
import styles from './landing.module.css';
import TicketMockup from './TicketMockup';

const SECTIONS = ['features', 'how', 'screens', 'demo'] as const;

function SectionHead({ eyebrow, title, lead }: { eyebrow: string; title: string; lead?: string }) {
  return (
    <header className={styles.sectionHead}>
      <span className={styles.eyebrow}>{eyebrow}</span>
      <h2>{title}</h2>
      {lead && <p className={styles.lead}>{lead}</p>}
    </header>
  );
}

export default function LandingPage({ lang }: { lang: Lang }) {
  const t = COPY[lang];
  const other: Lang = lang === 'he' ? 'ar' : 'he';

  /* No backend for leads: the form becomes a prefilled WhatsApp message, which
     is where the conversation would continue anyway. */
  function requestDemo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const m = t.demo.message;
    const text = [
      m.greeting,
      `${m.name}: ${form.get('name')}`,
      `${m.garage}: ${form.get('garage') || '-'}`,
      `${m.phone}: ${form.get('phone')}`,
    ].join('\n');
    window.open(whatsappUrl(text), '_blank', 'noopener');
  }

  return (
    <div className={styles.page} lang={lang}>
      <header className={styles.nav}>
        <div className={styles.container}>
          <a href="#top" className={styles.brand}>
            <img src="/marketing/images/logo.png" alt="" width="44" height="44" />
            <span>Garagiox</span>
          </a>
          <nav aria-label={t.nav.label} className={styles.navLinks}>
            {SECTIONS.map((id) => <a key={id} href={`#${id}`}>{t.nav.links[id]}</a>)}
          </nav>
          <div className={styles.navActions}>
            <a href={LANDING_PATHS[other]} lang={other} hrefLang={other} className={styles.login}>
              {t.nav.switchLang}
            </a>
            {/* The app itself: the login form, or the board for someone already signed in. */}
            <a href="/" className={styles.login}>{t.nav.login}</a>
            <a href="#demo" className={styles.btnPrimary}>{t.nav.demo}</a>
          </div>
        </div>
      </header>

      <main>
        <section id="top" className={`${styles.section} ${styles.heroBg}`}>
          <div className={`${styles.container} ${styles.hero}`}>
            <div className={styles.heroCopy}>
              <p className={styles.badge}>{t.hero.badge}</p>
              <h1>{t.hero.title[0]}<br /><span className={styles.accent}>{t.hero.title[1]}</span>{t.hero.title[2]}</h1>
              <p className={styles.heroLead}>{t.hero.lead}</p>
              <div className={styles.ctaRow}>
                <a href="#demo" className={`${styles.btnPrimary} ${styles.btnLarge}`}>{t.hero.demo}</a>
                <a href="#screens" className={`${styles.btnGhost} ${styles.btnLarge}`}>{t.hero.screens}</a>
              </div>
              <ul className={styles.highlights}>
                {t.hero.highlights.map((h) => <li key={h}>{h}</li>)}
              </ul>
            </div>

            <div className={styles.heroVisual}>
              <div className={styles.browser}>
                <div className={styles.browserBar} aria-hidden="true"><span /><span /><span /></div>
                <img src="/marketing/images/board.jpg" width="2000" height="1089" alt={t.hero.boardAlt} />
              </div>
              <div className={`${styles.phone} ${styles.heroPhone}`}>
                <img src="/marketing/images/jobcard.jpg" width="900" height="1954" alt={t.hero.phoneAlt} />
              </div>
            </div>
          </div>
        </section>

        <section id="features" className={styles.section}>
          <div className={styles.container}>
            <SectionHead eyebrow={t.features.eyebrow} title={t.features.title} lead={t.features.lead} />
            <div className={styles.grid}>
              {t.features.items.map((f, i) => (
                <article key={f.title} className={styles.feature}>
                  <span className={styles.featureIcon}>{FEATURE_ICONS[i]}</span>
                  <h3>{f.title}</h3>
                  <p>{f.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="how" className={`${styles.section} ${styles.tinted}`}>
          <div className={styles.container}>
            <SectionHead eyebrow={t.steps.eyebrow} title={t.steps.title} />
            <ol className={styles.grid}>
              {t.steps.items.map((s, i) => (
                <li key={s.title} className={styles.step}>
                  <span className={styles.stepNo} aria-hidden="true">{i + 1}</span>
                  <h3>{s.title}</h3>
                  <p>{s.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="screens" className={styles.section}>
          <div className={styles.container}>
            <SectionHead eyebrow={t.screens.eyebrow} title={t.screens.title} lead={t.screens.lead} />
            <div className={styles.screens}>
              <figure className={styles.screenWide}>
                <TicketMockup copy={t.mock} />
                <figcaption>
                  <strong>{t.screens.tablet.title}</strong>
                  <span>{t.screens.tablet.body}</span>
                </figcaption>
              </figure>
              <div className={styles.phones}>
                {([['jobcard', t.screens.approval], ['parts', t.screens.parts]] as const).map(([shot, s]) => (
                  <figure key={shot}>
                    <div className={styles.phone}>
                      <img src={`/marketing/images/${shot}.jpg`} width="900" height="1954" loading="lazy" alt={s.alt} />
                    </div>
                    <figcaption>
                      <strong>{s.title}</strong>
                      <span>{s.body}</span>
                    </figcaption>
                  </figure>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className={`${styles.section} ${styles.tinted}`}>
          <div className={styles.container}>
            <SectionHead eyebrow={t.reasons.eyebrow} title={t.reasons.title} />
            <div className={styles.grid}>
              {t.reasons.items.map((r) => (
                <div key={r.title} className={styles.reason}>
                  <h3>{r.title}</h3>
                  <p>{r.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="demo" className={`${styles.section} ${styles.dark}`}>
          <div className={`${styles.container} ${styles.demo}`}>
            <div className={styles.demoCopy}>
              <h2>{t.demo.title}</h2>
              <p>{t.demo.lead}</p>
              <a href={whatsappUrl()} target="_blank" rel="noopener noreferrer" className={styles.btnOutline}>
                {t.demo.whatsapp}
              </a>
            </div>
            <form className={styles.form} onSubmit={requestDemo}>
              <label>{t.demo.name}<input name="name" required autoComplete="name" /></label>
              <label>{t.demo.garage}<input name="garage" autoComplete="organization" /></label>
              <label>{t.demo.phone}<input name="phone" type="tel" required autoComplete="tel" dir="ltr" /></label>
              <button type="submit" className={`${styles.btnPrimary} ${styles.btnLarge}`}>{t.demo.submit}</button>
            </form>
          </div>
        </section>
      </main>

      <footer className={styles.footer}>
        <div className={styles.container}>
          <div className={styles.brand}>
            <img src="/marketing/images/logo.png" alt="" width="36" height="36" loading="lazy" />
            <span>Garagiox</span>
          </div>
          <div className={styles.footerLinks}>
            {CONTACT.phone && <a href={`tel:${CONTACT.phone}`} dir="ltr">{CONTACT.phone}</a>}
            {CONTACT.email && <a href={`mailto:${CONTACT.email}`}>{CONTACT.email}</a>}
            <a href="/privacy.html">{t.footer.privacy}</a>
          </div>
          <span>© {new Date().getFullYear()} Garagiox. {t.footer.rights}</span>
        </div>
      </footer>
    </div>
  );
}
