// The brand kit (P20) turned into design tokens for company websites, stores
// and the customer portal: CSS variables read by src/app/s/[slug]/site.css.

export type FontPair = "modern" | "classic" | "friendly" | "technical";
export type CornerStyle = "square" | "rounded" | "pill";
export type ThemeMode = "light" | "dark" | "system";
export type MotionLevel = "off" | "subtle" | "rich";
export type Template = "classic" | "bold";

export interface SiteBranding {
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  fontPair: FontPair;
  themeMode: ThemeMode;
  motionLevel: MotionLevel;
  cornerStyle: CornerStyle;
  logoUrl: string | null;
}

const SANS = "var(--font-geist-sans), system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const FONTS: Record<FontPair, { heading: string; body: string }> = {
  modern: { heading: SANS, body: SANS },
  classic: { heading: "Georgia, 'Times New Roman', 'Noto Serif', serif", body: SANS },
  friendly: { heading: "'Trebuchet MS', 'Segoe UI', 'Nunito', system-ui, sans-serif", body: "'Segoe UI', 'Trebuchet MS', system-ui, sans-serif" },
  technical: { heading: "var(--font-geist-mono), ui-monospace, 'SFMono-Regular', monospace", body: SANS },
};
const RADII: Record<CornerStyle, { radius: string; button: string }> = {
  square: { radius: "0px", button: "0px" },
  rounded: { radius: "0.75rem", button: "0.6rem" },
  pill: { radius: "1.5rem", button: "999px" },
};

const HEX = /^#[0-9a-f]{6}$/i;

function channel(hex: string, i: number): number {
  const v = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of a #rrggbb colour. */
export function luminance(hex: string): number {
  if (!HEX.test(hex)) return 0;
  return 0.2126 * channel(hex, 0) + 0.7152 * channel(hex, 1) + 0.0722 * channel(hex, 2);
}

/** WCAG contrast ratio between two colours. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** White or near-black text, whichever reads better on the colour. */
export function readableOn(hex: string): "#ffffff" | "#111827" {
  return contrast(hex, "#ffffff") >= contrast(hex, "#111827") ? "#ffffff" : "#111827";
}

function safeColour(value: string, fallback: string): string {
  return HEX.test(value) ? value.toLowerCase() : fallback;
}

/** CSS variables for a site root element. */
export function siteStyle(b: SiteBranding): Record<string, string> {
  const brand = safeColour(b.primaryColor, "#0b6e4f");
  const brand2 = safeColour(b.secondaryColor, "#c98f00");
  const accent = safeColour(b.accentColor, "#b42318");
  const fonts = FONTS[b.fontPair] ?? FONTS.modern;
  const radii = RADII[b.cornerStyle] ?? RADII.rounded;
  return {
    "--brand": brand,
    "--brand-2": brand2,
    "--brand-accent": accent,
    "--on-brand": readableOn(brand),
    "--on-brand-2": readableOn(brand2),
    "--on-accent": readableOn(accent),
    "--radius": radii.radius,
    "--radius-button": radii.button,
    "--font-heading": fonts.heading,
    "--font-body": fonts.body,
  };
}

/** Public address of an uploaded file (served by src/app/api/files). */
export function assetUrl(key: string | null | undefined): string | null {
  if (!key || !/^[0-9a-f-]{36}\/[a-z0-9/._-]+$/i.test(key) || key.includes("..")) return null;
  return `/api/files/${key}`;
}

export const SOCIAL_NETWORKS = [
  { key: "facebook", label: "Facebook", host: /(^|\.)facebook\.com$|(^|\.)fb\.com$/ },
  { key: "instagram", label: "Instagram", host: /(^|\.)instagram\.com$/ },
  { key: "tiktok", label: "TikTok", host: /(^|\.)tiktok\.com$/ },
  { key: "x", label: "X (Twitter)", host: /(^|\.)x\.com$|(^|\.)twitter\.com$/ },
  { key: "linkedin", label: "LinkedIn", host: /(^|\.)linkedin\.com$/ },
  { key: "youtube", label: "YouTube", host: /(^|\.)youtube\.com$|(^|\.)youtu\.be$/ },
] as const;

/** Keeps only https links to the matching social network. */
export function cleanSocialLinks(input: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const n of SOCIAL_NETWORKS) {
    const raw = typeof input[n.key] === "string" ? (input[n.key] as string).trim() : "";
    if (!raw) continue;
    try {
      const url = new URL(/^https?:\/\//i.test(raw) ? raw.replace(/^http:/i, "https:") : `https://${raw}`);
      if (n.host.test(url.hostname.toLowerCase()) && raw.length <= 300) out[n.key] = url.toString();
    } catch {
      // not a web address: ignored
    }
  }
  return out;
}

/** Digits for a wa.me link: Zimbabwean numbers get the 263 country code. */
export function whatsAppLink(number: string | null | undefined): string | null {
  const digits = (number ?? "").replace(/\D/g, "").replace(/^00/, "");
  if (digits.length < 9) return null;
  const full = digits.startsWith("0") ? `263${digits.slice(1)}` : digits.length === 9 ? `263${digits}` : digits;
  return `https://wa.me/${full}`;
}
