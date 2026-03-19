// ============================================================
// Debt Optimization System — Formatting Utilities
// ============================================================

/**
 * Format a number as Indian Rupees.
 * e.g. 1500000 → ₹15,00,000
 */
export function formatINR(amount, decimals = 0) {
  if (amount === null || amount === undefined || isNaN(amount)) return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(amount);
}

/**
 * Format a number with Indian grouping (no currency symbol).
 * e.g. 1500000 → 15,00,000
 */
export function formatNumber(n, decimals = 0) {
  if (n === null || n === undefined || isNaN(n)) return "—";
  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n);
}

/**
 * Format ISO date string as DD MMM YYYY.
 * e.g. "2024-01-15" → "15 Jan 2024"
 */
export function formatDate(isoDate) {
  if (!isoDate) return "—";
  const d = new Date(isoDate);
  if (isNaN(d)) return "—";
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/**
 * Return relative label like "in 3 days", "today", "overdue 2 days".
 */
export function formatRelativeDate(isoDate) {
  if (!isoDate) return "—";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(isoDate);
  d.setHours(0, 0, 0, 0);
  const diffDays = Math.round((d - today) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  if (diffDays > 1 && diffDays <= 7) return `In ${diffDays} days`;
  if (diffDays > 7 && diffDays <= 30) return `In ${Math.floor(diffDays / 7)} week${Math.floor(diffDays / 7) > 1 ? "s" : ""}`;
  if (diffDays < 0) return `Overdue by ${Math.abs(diffDays)} day${Math.abs(diffDays) > 1 ? "s" : ""}`;
  return formatDate(isoDate);
}

/**
 * Format tenure as human-readable string.
 * e.g. 48 → "4 years", 30 → "2 years 6 months"
 */
export function formatTenure(months) {
  if (!months) return "—";
  const y = Math.floor(months / 12);
  const m = months % 12;
  if (y === 0) return `${m} month${m > 1 ? "s" : ""}`;
  if (m === 0) return `${y} year${y > 1 ? "s" : ""}`;
  return `${y} yr ${m} mo`;
}

/**
 * Format a percentage value.
 * e.g. 10.5 → "10.5%"
 */
export function formatPct(n, decimals = 1) {
  if (n === null || n === undefined || isNaN(n)) return "—";
  return `${Number(n).toFixed(decimals)}%`;
}

/**
 * Compact INR for dashboard cards (e.g. 1500000 → ₹15L, 10000000 → ₹1Cr).
 */
export function formatINRCompact(amount) {
  if (!amount && amount !== 0) return "—";
  const abs = Math.abs(amount);
  const sign = amount < 0 ? "-" : "";
  if (abs >= 1e7) return `${sign}₹${(abs / 1e7).toFixed(2)}Cr`;
  if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(2)}L`;
  if (abs >= 1e3) return `${sign}₹${(abs / 1e3).toFixed(1)}K`;
  return `${sign}₹${Math.round(abs)}`;
}