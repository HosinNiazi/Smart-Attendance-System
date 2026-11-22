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

    // محتوای lazy (مثل داشبورد تحلیلی) بعد از اولین رسم اضافه می‌شود؛
    // بنابراین عناصر جدید دارای data-reveal هم باید مشاهده شوند.
    const mutations = new MutationObserver((records) => {
      records.forEach((record) => {
        record.addedNodes.forEach((node) => {
          if (!(node instanceof Element)) return;
          if (node.matches("[data-reveal]")) observer.observe(node);
          node
            .querySelectorAll("[data-reveal]")
            .forEach((el) => observer.observe(el));
        });
      });
    });
    mutations.observe(root, { childList: true, subtree: true });

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
      mutations.disconnect();
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

/**
 * ???? ??????? ??????? ?? ???? ?????? ??????.
 * ??? ??? ???????? ??????? ? ?????? ? ??? ?????????? ????? ??? ????.
 */
export function useTiltCards(rootRef) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    if (prefersReducedMotion() || !hasFinePointer()) return undefined;

    const SELECTOR = ".landing-feature, .landing-role";
    const clamp = (value) => Math.max(-1, Math.min(1, value));
    let frame = 0;
    let pending = null;

    const apply = () => {
      frame = 0;
      if (!pending) return;
      const { card, x, y } = pending;
      const rect = card.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const dx = clamp(((x - rect.left) / rect.width - 0.5) * 2);
      const dy = clamp(((y - rect.top) / rect.height - 0.5) * 2);
      card.style.setProperty("--tilt-y", `${(dx * 6).toFixed(2)}deg`);
      card.style.setProperty("--tilt-x", `${(-dy * 6).toFixed(2)}deg`);
    };

    const onMove = (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const card = target.closest(SELECTOR);
      if (!card || !root.contains(card)) return;
      pending = { card, x: event.clientX, y: event.clientY };
      if (!frame) frame = window.requestAnimationFrame(apply);
    };

    const onOut = (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const card = target.closest(SELECTOR);
      if (!card) return;
      const next = event.relatedTarget;
      if (next instanceof Node && card.contains(next)) return;
      card.style.removeProperty("--tilt-x");
      card.style.removeProperty("--tilt-y");
    };

    root.addEventListener("pointermove", onMove, { passive: true });
    root.addEventListener("pointerout", onOut, { passive: true });

    return () => {
      root.removeEventListener("pointermove", onMove);
      root.removeEventListener("pointerout", onOut);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [rootRef]);
}

/**
 * ?????? ??? ????????????? ?????? ???? ?? ???????.
 * ?????? ???? ?????? ????? ??????? ?? ??????????? ? ??? ??? ???.
 */
export function useCursorRing(rootRef, ringRef) {
  useEffect(() => {
    const root = rootRef.current;
    const ring = ringRef.current;
    if (!root || !ring) return undefined;
    if (prefersReducedMotion() || !hasFinePointer()) return undefined;

    const INTERACTIVE =
      "a, button, summary, input, select, textarea, [role='button']";

    let frame = 0;
    let hovering = false;
    let visible = false;
    const target = { x: 0, y: 0 };
    const current = { x: 0, y: 0 };

    const tick = () => {
      current.x += (target.x - current.x) * 0.22;
      current.y += (target.y - current.y) * 0.22;
      ring.style.transform = `translate3d(${current.x.toFixed(2)}px, ${current.y.toFixed(2)}px, 0)`;
      const remaining =
        Math.abs(target.x - current.x) + Math.abs(target.y - current.y);
      frame = remaining > 0.4 ? window.requestAnimationFrame(tick) : 0;
    };

    const onMove = (event) => {
      target.x = event.clientX;
      target.y = event.clientY;
      if (!visible) {
        visible = true;
        current.x = target.x;
        current.y = target.y;
        ring.classList.add("is-visible");
      }
      const element =
        event.target instanceof Element
          ? event.target.closest(INTERACTIVE)
          : null;
      const nextHovering = Boolean(element && root.contains(element));
      if (nextHovering !== hovering) {
        hovering = nextHovering;
        ring.classList.toggle("is-hover", hovering);
      }
      if (!frame) frame = window.requestAnimationFrame(tick);
    };

    const onLeave = () => {
      visible = false;
      hovering = false;
      ring.classList.remove("is-visible", "is-hover");
    };

    root.addEventListener("pointermove", onMove, { passive: true });
    root.addEventListener("pointerleave", onLeave);

    return () => {
      root.removeEventListener("pointermove", onMove);
      root.removeEventListener("pointerleave", onLeave);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [rootRef, ringRef]);
}

/**
 * ??? ???? (ripple) ??? ??????? ? ???????? ??????.
 */
export function useRipple(rootRef) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    if (prefersReducedMotion()) return undefined;

    const SELECTOR = "button, .btn, .landing-socials a";

    const onPointerDown = (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const element = target.closest(SELECTOR);
      if (!element || !root.contains(element)) return;
      if (element.disabled || element.dataset.ripple === "off") return;

      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const size = Math.max(rect.width, rect.height) * 1.1;
      const ripple = document.createElement("span");
      ripple.className = "landing-ripple";
      ripple.style.width = `${size}px`;
      ripple.style.height = `${size}px`;
      ripple.style.left = `${event.clientX - rect.left - size / 2}px`;
      ripple.style.top = `${event.clientY - rect.top - size / 2}px`;
      element.appendChild(ripple);

      const clean = () => ripple.remove();
      ripple.addEventListener("animationend", clean, { once: true });
      window.setTimeout(clean, 800);
    };

    root.addEventListener("pointerdown", onPointerDown, { passive: true });
    return () => root.removeEventListener("pointerdown", onPointerDown);
  }, [rootRef]);
}
