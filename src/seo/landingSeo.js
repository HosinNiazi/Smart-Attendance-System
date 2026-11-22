/**
 * متادیتای SEO مخصوص لندینگ برای هر زبان.
 * با تغییر زبان اعمال می‌شود و هنگام خروج از لندینگ مقادیر قبلی برمی‌گردند.
 */
const META_FIELDS = [
  ["name", "description"],
  ["name", "keywords"],
  ["property", "og:title"],
  ["property", "og:description"],
  ["property", "og:locale"],
  ["property", "og:url"],
  ["property", "og:image"],
  ["property", "og:image:alt"],
  ["name", "twitter:title"],
  ["name", "twitter:description"],
  ["name", "twitter:image"],
];

function findMeta(attr, key) {
  return document.head.querySelector(`meta[${attr}="${key}"]`);
}

export function applyLandingSeo(lang, copy) {
  if (typeof document === "undefined") return () => {};

  const root = document.documentElement;
  const origin = window.location.origin;
  const canonicalUrl = `${origin}${window.location.pathname}`;
  const seo = copy.seo || {};
  const values = {
    description: seo.description || "",
    keywords: seo.keywords || "",
    "og:title": seo.title || document.title,
    "og:description": seo.description || "",
    "og:locale": lang === "fa" ? "fa_IR" : "en_US",
    "og:url": canonicalUrl,
    "og:image": `${origin}/icons/icon-512.png`,
    "og:image:alt": copy.brand,
    "twitter:title": seo.title || document.title,
    "twitter:description": seo.description || "",
    "twitter:image": `${origin}/icons/icon-512.png`,
  };

  const previousLang = root.lang;
  const previousDir = root.dir;
  const previousTitle = document.title;
  const created = [];
  const touched = [];

  root.lang = lang === "fa" ? "fa" : "en";
  root.dir = lang === "fa" ? "rtl" : "ltr";
  if (seo.title) document.title = seo.title;

  for (const [attr, key] of META_FIELDS) {
    let element = findMeta(attr, key);
    if (!element) {
      element = document.createElement("meta");
      element.setAttribute(attr, key);
      document.head.appendChild(element);
      created.push(element);
      touched.push({ element, previous: null });
      continue;
    }
    touched.push({ element, previous: element.getAttribute("content") });
    element.setAttribute("content", values[key] || "");
  }

  let canonical = document.head.querySelector('link[rel="canonical"]');
  const createdCanonical = !canonical;
  const previousCanonical = canonical ? canonical.getAttribute("href") : null;
  if (!canonical) {
    canonical = document.createElement("link");
    canonical.setAttribute("rel", "canonical");
    document.head.appendChild(canonical);
    created.push(canonical);
  }
  canonical.setAttribute("href", canonicalUrl);

  return () => {
    document.title = previousTitle;
    root.lang = previousLang;
    root.dir = previousDir;

    for (const { element, previous } of touched) {
      if (previous === null) {
        element.remove();
      } else {
        element.setAttribute("content", previous);
      }
    }

    if (createdCanonical) {
      canonical.remove();
    } else if (previousCanonical !== null) {
      canonical.setAttribute("href", previousCanonical);
    }

    for (const element of created) {
      if (element.isConnected) element.remove();
    }
  };
}
