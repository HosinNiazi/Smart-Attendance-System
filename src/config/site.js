/**
 * اطلاعات تماس و شبکه‌های اجتماعی سایت.
 * برای فعال‌شدن هر شبکه، فقط آدرس کامل آن را در مقدار مربوطه بگذارید.
 * هر مقداری که خالی بماند، در رابط کاربری نمایش داده نمی‌شود.
 */
export const siteConfig = {
  social: {
    github: "https://github.com/HosinNiazi",
    linkedin: "",
    instagram: "",
    telegram: "",
  },
  location: {
    // عبارت جستجوی نقشه؛ برای دقت بیشتر می‌توانید آدرس کامل را جایگزین کنید.
    query: "دانشکده شهید شمسی‌پور تهران",
    addressFa: "دانشکده شهید شمسی‌پور، تهران",
    addressEn: "Shahid Shamsipour Faculty, Tehran, Iran",
  },
  contact: {
    email: "mohammad.hosien.n1386@gmail.com",
    phone: "09336988719",
  },
};

export const socialMeta = [
  { key: "github", icon: "bi-github", label: "GitHub" },
  { key: "linkedin", icon: "bi-linkedin", label: "LinkedIn" },
  { key: "instagram", icon: "bi-instagram", label: "Instagram" },
  { key: "telegram", icon: "bi-telegram", label: "Telegram" },
];

export function mapEmbedUrl(query = siteConfig.location.query) {
  return `https://www.google.com/maps?q=${encodeURIComponent(query)}&output=embed`;
}

export function mapOpenUrl(query = siteConfig.location.query) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    query,
  )}`;
}
