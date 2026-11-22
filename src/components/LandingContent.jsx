import { useState } from "react";
import { Icon } from "./shared.jsx";

function scrollTo(id) {
  if (typeof document === "undefined") return;
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
}

/* مقایسهٔ روش سنتی و سامانهٔ هوشمند */
export function LandingComparison({ copy }) {
  return (
    <section className="landing-section landing-compare" id="compare">
      <div className="landing-section-head" data-reveal>
        <span className="landing-eyebrow">{copy.comparisonHead.eyebrow}</span>
        <h2>{copy.comparisonHead.title}</h2>
        <p>{copy.comparisonHead.text}</p>
      </div>

      <div className="landing-compare-board" data-reveal>
        <div className="landing-compare-row landing-compare-head" aria-hidden="true">
          <span />
          <span className="landing-compare-traditional">
            <Icon name="bi-journal-text" /> {copy.comparisonTraditional}
          </span>
          <span className="landing-compare-smart">
            <Icon name="bi-fingerprint" /> {copy.comparisonSmart}
          </span>
        </div>
        {copy.comparisonRows.map((row) => (
          <div className="landing-compare-row" key={row.label}>
            <span className="landing-compare-label">{row.label}</span>
            <span className="landing-compare-traditional">
              <Icon name="bi-x-circle" /> {row.traditional}
            </span>
            <span className="landing-compare-smart">
              <Icon name="bi-check2-circle" /> {row.smart}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

/* اسلایدر بازخوردها با کنترل دستی */
export function LandingTestimonials({ copy, rtl = true, digits }) {
  const total = copy.testimonials.length;
  const [index, setIndex] = useState(0);

  if (!total) return null;

  const go = (delta) => setIndex((current) => (current + delta + total) % total);

  return (
    <section className="landing-section landing-testimonials" id="testimonials">
      <div className="landing-section-head" data-reveal>
        <span className="landing-eyebrow">{copy.testimonialsHead.eyebrow}</span>
        <h2>{copy.testimonialsHead.title}</h2>
        <p>{copy.testimonialsHead.text}</p>
        <span className="landing-sample-badge">
          <i className="live-dot" /> {copy.testimonialsSample}
        </span>
      </div>

      <div className="landing-testimonial-shell" data-reveal>
        <div
          className="landing-testimonial-viewport"
          aria-roledescription="carousel"
          aria-live="polite"
        >
          <div
            className="landing-testimonial-track"
            style={{
              transform: `translateX(${(rtl ? 1 : -1) * index * 100}%)`,
            }}
          >
            {copy.testimonials.map((item, i) => (
              <figure
                className="landing-testimonial"
                key={item.role}
                aria-hidden={i !== index}
              >
                <span className="landing-testimonial-quote" aria-hidden="true">
                  <Icon name="bi-quote" />
                </span>
                <blockquote>{item.quote}</blockquote>
                <figcaption>
                  <span className="landing-testimonial-avatar">
                    <Icon name="bi-person" />
                  </span>
                  <span>{item.role}</span>
                </figcaption>
              </figure>
            ))}
          </div>
        </div>

        <div className="landing-testimonial-controls">
          <button
            type="button"
            className="landing-testimonial-arrow"
            onClick={() => go(index - 1)}
            aria-label={copy.testimonialsPrev}
            title={copy.testimonialsPrev}
          >
            <Icon name={rtl ? "bi-chevron-right" : "bi-chevron-left"} />
          </button>

          <div className="landing-testimonial-dots">
            {copy.testimonials.map((item, i) => (
              <button
                key={item.role}
                type="button"
                className={`landing-testimonial-dot${i === index ? " is-active" : ""}`}
                onClick={() => setIndex(i)}
                aria-label={`${copy.testimonialsGoto} ${digits(i + 1)}`}
                aria-current={i === index ? "true" : undefined}
                title={`${copy.testimonialsGoto} ${digits(i + 1)}`}
              />
            ))}
          </div>

          <button
            type="button"
            className="landing-testimonial-arrow"
            onClick={() => go(index + 1)}
            aria-label={copy.testimonialsNext}
            title={copy.testimonialsNext}
          >
            <Icon name={rtl ? "bi-chevron-left" : "bi-chevron-right"} />
          </button>
        </div>
      </div>
    </section>
  );
}

/* طرح‌های آیندهٔ سامانه؛ قیمت‌گذاری هنوز نهایی نیست */
export function LandingPricing({ copy, rtl = true, onEnter }) {
  const handleCta = (cta) => {
    if (cta === "start") {
      onEnter?.();
      return;
    }
    scrollTo("contact");
  };

  return (
    <section className="landing-section landing-pricing" id="pricing">
      <div className="landing-section-head" data-reveal>
        <span className="landing-eyebrow">{copy.pricingHead.eyebrow}</span>
        <h2>{copy.pricingHead.title}</h2>
        <p>{copy.pricingHead.text}</p>
      </div>

      <div className="landing-pricing-grid">
        {copy.pricingPlans.map((plan, index) => (
          <article
            className={`landing-price-card${plan.featured ? " is-featured" : ""}`}
            key={plan.key}
            data-reveal
            style={{ "--reveal-index": index }}
          >
            {plan.featured && (
              <span className="landing-price-badge">
                <i className="bi bi-stars" aria-hidden="true" /> {copy.pricingBadge}
              </span>
            )}
            <h3>{plan.name}</h3>
            <p className="landing-price-hint">{plan.hint}</p>
            <strong className="landing-price-value">{plan.price}</strong>
            <ul className="landing-price-features">
              {plan.features.map((feature) => (
                <li key={feature}>
                  <Icon name="bi-check2" /> {feature}
                </li>
              ))}
            </ul>
            <button
              type="button"
              className={`btn ${plan.featured ? "btn-primary" : "btn-light-outline"} landing-price-cta`}
              onClick={() => handleCta(plan.cta)}
            >
              {plan.cta === "start" ? copy.pricingCtaStart : copy.pricingCtaInfo}
              <Icon name={rtl ? "bi-arrow-left" : "bi-arrow-right"} />
            </button>
          </article>
        ))}
      </div>

      <p className="landing-pricing-note" data-reveal>
        <Icon name="bi-info-circle" /> {copy.pricingNote}
      </p>
    </section>
  );
}

/* اخبار و به‌روزرسانی‌های سامانه (محتوای ثابت، بدون پیوند مرده) */
export function LandingNews({ copy }) {
  return (
    <section className="landing-section landing-news" id="news">
      <div className="landing-section-head" data-reveal>
        <span className="landing-eyebrow">{copy.newsHead.eyebrow}</span>
        <h2>{copy.newsHead.title}</h2>
        <p>{copy.newsHead.text}</p>
      </div>

      <div className="landing-news-grid">
        {copy.news.map((item, index) => (
          <article
            className="landing-news-card"
            key={item.title}
            data-reveal
            style={{ "--reveal-index": index }}
          >
            <div className="landing-news-meta">
              <span className="landing-news-tag">{item.tag}</span>
              <time>{item.date}</time>
            </div>
            <h3>{item.title}</h3>
            <p>{item.text}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
