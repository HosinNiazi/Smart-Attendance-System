import { useEffect, useRef } from "react";

function prefersReducedMotion() {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function hasFinePointer() {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

/**
 * نوار پیشرفت اسکرول صفحه.
 * مقدار با transform: scaleX() اعمال می‌شود تا در هر فریم Layout/Reflow رخ ندهد.
 * خروجی: ref عنصر داخلی نوار.
 */
export function useScrollProgress() {
  const barRef = useRef(null);

  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return undefined;

    let frame = 0;

    const paint = () => {
      frame = 0;
      const el = barRef.current;
      if (!el) return;
      const doc = document.documentElement;
      const max = doc.scrollHeight - window.innerHeight;
      const ratio =
        max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
      el.style.transform = `scaleX(${ratio})`;
    };

    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(paint);
    };

    paint();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });

    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  return barRef;
}

/**
 * نمایش تدریجی بخش‌ها هنگام ورود به دید.
 * روی همه‌ی عناصر دارای [data-reveal] داخل root کار می‌کند.
 * اگر IntersectionObserver نبود یا کاربر کاهش حرکت خواسته باشد، همه فوراً نمایش داده می‌شوند.
 */
export function useRevealOnScroll(rootRef) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;

    const targets = Array.from(root.querySelectorAll("[data-reveal]"));
    if (!targets.length) return undefined;

    const revealAll = () => {
      targets.forEach((el) => el.classList.add("is-revealed"));
    };

    if (prefersReducedMotion() || typeof IntersectionObserver === "undefined") {
      revealAll();
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-revealed");
          observer.unobserve(entry.target);
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" },
    );

    targets.forEach((el) => observer.observe(el));

    // اطمینان: اگر عنصری به هر دلیل در دید نبود (مثلاً صفحه کوتاه)، نامرئی نماند.
    const safety = window.setTimeout(() => {
      targets.forEach((el) => {
        const rect = el.getBoundingClientRect();
        if (rect.top < window.innerHeight * 1.2 && rect.bottom > 0) {
          el.classList.add("is-revealed");
        }
      });
    }, 1200);

    return () => {
      observer.disconnect();
      window.clearTimeout(safety);
    };
  }, [rootRef]);
}

/**
 * نور دنبال‌کننده‌ی نشانگر موس روی کارت‌های امکانات.
 * فقط روی دستگاه‌های دارای موس دقیق و وقتی کاربر حرکت را محدود نکرده باشد فعال می‌شود.
 * متغیرهای --mx/--my روی کارت ست می‌شوند و CSS از آن‌ها برای radial-gradient استفاده می‌کند.
 */
export function useSpotlight(rootRef) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    if (prefersReducedMotion() || !hasFinePointer()) return undefined;

    let frame = 0;
    let active = null;

    const apply = () => {
      frame = 0;
      if (!active) return;
      const { card, x, y } = active;
      const rect = card.getBoundingClientRect();
      card.style.setProperty("--mx", `${x - rect.left}px`);
      card.style.setProperty("--my", `${y - rect.top}px`);
    };

    const onPointerMove = (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const card = target.closest(".landing-feature");
      if (!card || !root.contains(card)) return;
      active = { card, x: event.clientX, y: event.clientY };
      if (!frame) frame = window.requestAnimationFrame(apply);
    };

    const onPointerLeave = (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const card = target.closest(".landing-feature");
      if (!card) return;
      card.style.removeProperty("--mx");
      card.style.removeProperty("--my");
    };

    root.addEventListener("pointermove", onPointerMove, { passive: true });
    root.addEventListener("pointerleave", onPointerLeave, { passive: true });

    return () => {
      root.removeEventListener("pointermove", onPointerMove);
      root.removeEventListener("pointerleave", onPointerLeave);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [rootRef]);
}
