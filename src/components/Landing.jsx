import { lazy, Suspense, useEffect, useRef } from "react";
import { Icon } from "./shared.jsx";
import {
  LandingComparison,
  LandingTestimonials,
  LandingPricing,
  LandingNews,
} from "./LandingContent.jsx";
import { applyLandingSeo } from "../seo/landingSeo.js";
import {
  landingCopy,
  landingDate,
  landingTimestamp,
} from "../i18n/landing.js";
import {
  siteConfig,
  socialMeta,
  mapEmbedUrl,
  mapOpenUrl,
} from "../config/site.js";
import {
  useScrollProgress,
  useRevealOnScroll,
  useSpotlight,
  useTiltCards,
  useCursorRing,
  useRipple,
} from "../hooks/useLandingEffects.js";

const LandingAnalytics = lazy(() =>
  import("./LandingAnalytics.jsx").then((module) => ({
    default: module.LandingAnalytics,
  })),
);

const APP_VERSION =
  typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "1.0.0";
const BUILD_TIME = typeof __BUILD_TIME__ !== "undefined" ? __BUILD_TIME__ : "";

function scrollTo(id) {
  if (typeof document === "undefined") return;
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function Landing({
  theme = "light",
  rtl = true,
  onToggleTheme,
  onToggleRtl,
  onEnter,
}) {
  const lang = rtl ? "fa" : "en";
  const copy = landingCopy[lang];
  const digits = (value) =>
    lang === "fa" ? value.toLocaleString("fa-IR") : String(value);

  const address =
    lang === "fa" ? siteConfig.location.addressFa : siteConfig.location.addressEn;
  const socialLinks = socialMeta
    .map((item) => ({ ...item, href: siteConfig.social[item.key] }))
    .filter((item) => Boolean(item.href));
  const buildDate = BUILD_TIME ? landingTimestamp(lang, BUILD_TIME) : "";

  const rootRef = useRef(null);
  const cursorRef = useRef(null);
  const progressRef = useScrollProgress();
  useRevealOnScroll(rootRef);
  useSpotlight(rootRef);
  useTiltCards(rootRef);
  useCursorRing(rootRef, cursorRef);
  useRipple(rootRef);

  useEffect(() => applyLandingSeo(lang, copy), [lang, copy]);

  return (
    <div className="landing" ref={rootRef} dir={rtl ? "rtl" : "ltr"}>
      <div className="landing-cursor-ring" ref={cursorRef} aria-hidden="true">
        <i />
      </div>
      <div className="landing-scroll-progress" aria-hidden="true">
        <span
          ref={progressRef}
          style={{ transformOrigin: rtl ? "right" : "left" }}
        />
      </div>

      <div className="landing-bg" aria-hidden="true">
        <span className="landing-blob blob-a" />
        <span className="landing-blob blob-b" />
        <span className="landing-blob blob-c" />
      </div>

      <header className="landing-header">
        <div className="landing-header-inner">
          <button
            type="button"
            className="landing-brand"
            onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
            aria-label={copy.brandAria}
          >
            <span className="brand-mark">
              <Icon name="bi-fingerprint" />
            </span>
            <span className="landing-brand-text">
              <strong>{copy.brand}</strong>
              <small>{copy.brandTagline}</small>
            </span>
          </button>

          <nav className="landing-nav" aria-label={copy.navAria}>
            {copy.nav.map((link) => (
              <button
                key={link.id}
                type="button"
                onClick={() => scrollTo(link.id)}
              >
                {link.label}
              </button>
            ))}
          </nav>

          <div className="landing-header-actions">
            <button
              type="button"
              className="lang-toggle-btn"
              aria-label={copy.languageAria}
              title={copy.languageAria}
              onClick={onToggleRtl}
            >
              <Icon name="bi-translate" />
              {copy.languageButton}
            </button>
            <button
              type="button"
              className="icon-button landing-theme"
              aria-label={theme === "dark" ? copy.themeLight : copy.themeDark}
              title={theme === "dark" ? copy.themeLightTitle : copy.themeDarkTitle}
              onClick={onToggleTheme}
            >
              <Icon name={theme === "dark" ? "bi-sun" : "bi-moon-stars"} />
            </button>
            <button
              type="button"
              className="btn btn-primary landing-cta-sm"
              onClick={onEnter}
            >
              <Icon name="bi-box-arrow-in-left" /> {copy.signIn}
            </button>
          </div>
        </div>
      </header>

      <main>
        <section className="landing-hero" id="top">
          <div className="landing-hero-inner">
            <div className="landing-hero-copy" data-reveal>
              <span className="landing-badge">
                <i className="live-dot" /> {copy.badge}
              </span>
              <h1>
                {copy.heroTitleStart}{" "}
                <span className="landing-grad">{copy.heroTitleHighlight}</span>
              </h1>
              <p>{copy.heroLead}</p>
              <div className="landing-hero-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={onEnter}
                >
                  <Icon name="bi-rocket-takeoff" /> {copy.start}
                </button>
                <button
                  type="button"
                  className="btn btn-light-outline"
                  onClick={() => scrollTo("features")}
                >
                  <Icon name="bi-grid-1x2" /> {copy.explore}
                </button>
              </div>
              <ul className="landing-trust">
                {copy.trust.map((item) => (
                  <li key={item}>
                    <Icon name="bi-check2-circle" /> {item}
                  </li>
                ))}
              </ul>
            </div>

            <div className="landing-hero-visual" aria-hidden="true" data-reveal>
              <div className="landing-dash">
                <div className="landing-dash-head">
                  <span className="landing-dash-live">
                    <span className="live-dot" /> {copy.todayReport}
                  </span>
                  <span className="landing-dash-date">
                    {landingDate(lang)}
                  </span>
                </div>
                <div className="landing-dash-body">
                  <div
                    className="landing-ring"
                    style={{
                      background:
                        "conic-gradient(#54deb0 0deg 331deg, rgba(255,255,255,.16) 331deg 360deg)",
                    }}
                  >
                    <div className="landing-ring-inner">
                      <strong>{copy.ringValue}</strong>
                      <span>{copy.todayAttendance}</span>
                    </div>
                  </div>
                  <div className="landing-dash-stats">
                    <div>
                      <strong>{digits(28)}</strong>
                      <span>{copy.dashStudents}</span>
                    </div>
                    <div>
                      <strong>{digits(26)}</strong>
                      <span>{copy.dashPresent}</span>
                    </div>
                    <div>
                      <strong>{digits(2)}</strong>
                      <span>{copy.dashAbsent}</span>
                    </div>
                  </div>
                </div>
                <div className="landing-dash-bars">
                  {[72, 88, 64, 94, 80, 90, 68].map((height, index) => (
                    <span key={index} style={{ height: `${height}%` }} />
                  ))}
                </div>
              </div>
              <div className="landing-chip chip-face">
                <Icon name="bi-camera-video" /> {copy.chipFace}
              </div>
              <div className="landing-chip chip-voice">
                <Icon name="bi-mic" /> {copy.chipVoice}
              </div>
              <div className="landing-chip chip-secure">
                <Icon name="bi-shield-check" /> {copy.chipSecure}
              </div>
            </div>
          </div>
        </section>

        <section className="landing-stats" aria-label={copy.statsAria}>
          <div className="landing-stats-inner">
            {copy.stats.map((item, index) => (
              <div
                className="landing-stat"
                key={item.label}
                data-reveal
                style={{ "--reveal-index": index }}
              >
                <strong>{item.value}</strong>
                <span>{item.label}</span>
                <small>{item.detail}</small>
              </div>
            ))}
          </div>
        </section>

        <Suspense
          fallback={
            <div className="landing-analytics-skeleton" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
          }
        >
          <LandingAnalytics copy={copy} rtl={rtl} digits={digits} />
        </Suspense>

        <section className="landing-section" id="features">
          <div className="landing-section-head" data-reveal>
            <span className="landing-eyebrow">{copy.featuresHead.eyebrow}</span>
            <h2>{copy.featuresHead.title}</h2>
            <p>{copy.featuresHead.text}</p>
          </div>
          <div className="landing-features">
            {copy.features.map((feature, index) => (
              <article
                className="landing-feature"
                key={feature.title}
                data-reveal
                style={{ "--reveal-index": index % 3 }}
              >
                <span
                  className={`landing-feature-icon landing-tone-${feature.tone}`}
                >
                  <Icon name={feature.icon} />
                </span>
                <h3>{feature.title}</h3>
                <p>{feature.text}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="landing-section landing-how" id="how">
          <div className="landing-section-head" data-reveal>
            <span className="landing-eyebrow">{copy.stepsHead.eyebrow}</span>
            <h2>{copy.stepsHead.title}</h2>
            <p>{copy.stepsHead.text}</p>
          </div>
          <div className="landing-steps">
            {copy.steps.map((step, index) => (
              <article
                className="landing-step"
                key={step.title}
                data-reveal
                style={{ "--reveal-index": index }}
              >
                <span className="landing-step-num">{digits(index + 1)}</span>
                <span className="landing-step-icon">
                  <Icon name={step.icon} />
                </span>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="landing-section" id="roles">
          <div className="landing-section-head" data-reveal>
            <span className="landing-eyebrow">{copy.rolesHead.eyebrow}</span>
            <h2>{copy.rolesHead.title}</h2>
            <p>{copy.rolesHead.text}</p>
          </div>
          <div className="landing-roles">
            {copy.roles.map((role, index) => (
              <article
                className="landing-role"
                key={role.title}
                data-reveal
                style={{ "--reveal-index": index % 3 }}
              >
                <span className={`landing-role-icon landing-tone-${role.tone}`}>
                  <Icon name={role.icon} />
                </span>
                <h3>{role.title}</h3>
                <p>{role.text}</p>
                <ul>
                  {role.points.map((point) => (
                    <li key={point}>
                      <Icon name="bi-check2" /> {point}
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>

        <section className="landing-section landing-security" id="security">
          <div className="landing-security-inner">
            <div className="landing-section-head align-start" data-reveal>
              <span className="landing-eyebrow">{copy.securityHead.eyebrow}</span>
              <h2>{copy.securityHead.title}</h2>
              <p>{copy.securityHead.text}</p>
            </div>
            <div className="landing-security-grid">
              {copy.security.map((item, index) => (
                <article
                  className="landing-security-item"
                  key={item.title}
                  data-reveal
                  style={{ "--reveal-index": index }}
                >
                  <span className="landing-security-icon">
                    <Icon name={item.icon} />
                  </span>
                  <div>
                    <h3>{item.title}</h3>
                    <p>{item.text}</p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <LandingComparison copy={copy} />

        <LandingTestimonials copy={copy} rtl={rtl} digits={digits} />

        <LandingPricing copy={copy} rtl={rtl} onEnter={onEnter} />

        <LandingNews copy={copy} />

        <section className="landing-section" id="faq">
          <div className="landing-section-head" data-reveal>
            <span className="landing-eyebrow">{copy.faqHead.eyebrow}</span>
            <h2>{copy.faqHead.title}</h2>
            <p>{copy.faqHead.text}</p>
          </div>
          <div className="landing-faq">
            {copy.faqs.map((item, index) => (
              <details
                className="landing-faq-item"
                key={item.q}
                open={index === 0}
                data-reveal
                style={{ "--reveal-index": Math.min(index, 3) }}
              >
                <summary>
                  <span>{item.q}</span>
                  <Icon name="bi-chevron-down" />
                </summary>
                <p>{item.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="landing-section landing-contact" id="contact">
          <div className="landing-section-head" data-reveal>
            <span className="landing-eyebrow">{copy.contactHead.eyebrow}</span>
            <h2>{copy.contactHead.title}</h2>
            <p>{copy.contactHead.text}</p>
          </div>
          <div className="landing-contact-grid" data-reveal>
            <div className="landing-contact-cards">
              <a
                className="landing-contact-card"
                href={`mailto:${siteConfig.contact.email}`}
              >
                <span className="landing-contact-icon landing-tone-blue">
                  <Icon name="bi-envelope" />
                </span>
                <div>
                  <span className="landing-contact-label">
                    {copy.contactEmailLabel}
                  </span>
                  <strong dir="ltr">{siteConfig.contact.email}</strong>
                </div>
              </a>
              <a
                className="landing-contact-card"
                href={`tel:${siteConfig.contact.phone}`}
              >
                <span className="landing-contact-icon landing-tone-green">
                  <Icon name="bi-telephone" />
                </span>
                <div>
                  <span className="landing-contact-label">
                    {copy.contactPhoneLabel}
                  </span>
                  <strong dir="ltr">{siteConfig.contact.phone}</strong>
                </div>
              </a>
              <div className="landing-contact-card">
                <span className="landing-contact-icon landing-tone-orange">
                  <Icon name="bi-geo-alt" />
                </span>
                <div>
                  <span className="landing-contact-label">
                    {copy.contactAddressLabel}
                  </span>
                  <strong>{address}</strong>
                  <a
                    className="landing-contact-maplink"
                    href={mapOpenUrl()}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    {copy.contactMapCta} <Icon name="bi-box-arrow-up-right" />
                  </a>
                </div>
              </div>
              {socialLinks.length > 0 && (
                <div className="landing-contact-card landing-contact-socials-card">
                  <span className="landing-contact-icon landing-tone-violet">
                    <Icon name="bi-share" />
                  </span>
                  <div>
                    <span className="landing-contact-label">
                      {copy.contactSocialLabel}
                    </span>
                    <div className="landing-socials">
                      {socialLinks.map((item) => (
                        <a
                          key={item.key}
                          href={item.href}
                          target="_blank"
                          rel="noreferrer noopener"
                          aria-label={item.label}
                          title={item.label}
                        >
                          <Icon name={item.icon} />
                        </a>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
            <div className="landing-map-card">
              <iframe
                title={address}
                src={mapEmbedUrl()}
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                allowFullScreen
              />
            </div>
          </div>
        </section>

        <section className="landing-cta" data-reveal>
          <div className="landing-cta-inner">
            <div>
              <h2>{copy.ctaTitle}</h2>
              <p>{copy.ctaText}</p>
            </div>
            <button type="button" className="btn btn-primary" onClick={onEnter}>
              {copy.signIn} <Icon name="bi-arrow-left" />
            </button>
          </div>
        </section>
      </main>

      <footer className="landing-footer">
        <div className="landing-footer-inner">
          <div className="landing-footer-brand">
            <span className="brand-mark">
              <Icon name="bi-fingerprint" />
            </span>
            <div>
              <strong>{copy.brand}</strong>
              <small>{copy.footerTagline}</small>
            </div>
          </div>
          <nav className="landing-footer-links" aria-label={copy.footerLinksAria}>
            {copy.nav.map((link) => (
              <button
                key={link.id}
                type="button"
                onClick={() => scrollTo(link.id)}
              >
                {link.label}
              </button>
            ))}
          </nav>
          <div className="landing-footer-meta">
            <a href={`mailto:${siteConfig.contact.email}`}>
              <Icon name="bi-envelope" /> {siteConfig.contact.email}
            </a>
            <a href={`tel:${siteConfig.contact.phone}`} dir="ltr">
              <Icon name="bi-telephone" /> {siteConfig.contact.phone}
            </a>
            <span>{copy.identity}</span>
            {socialLinks.length > 0 && (
              <div className="landing-socials landing-socials-footer">
                {socialLinks.map((item) => (
                  <a
                    key={item.key}
                    href={item.href}
                    target="_blank"
                    rel="noreferrer noopener"
                    aria-label={item.label}
                    title={item.label}
                  >
                    <Icon name={item.icon} />
                  </a>
                ))}
              </div>
            )}
            <div className="landing-build-info">
              <span className="landing-version-badge">
                {copy.versionLabel} {APP_VERSION}
              </span>
              {buildDate && (
                <span className="landing-build-date">
                  {copy.lastUpdated}: {buildDate}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="landing-footer-bottom">
          <span>{copy.copyright}</span>
          <span>{copy.madeFor}</span>
        </div>
      </footer>
    </div>
  );
}
