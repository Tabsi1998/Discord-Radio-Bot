// ============================================================
// OmniFM - Pricing Calculator (Laufzeit-basiert)
// ============================================================

import { PLANS, BRAND } from "../config/plans.js";

// Laufzeiten in Monaten
export const DURATION_OPTIONS = [1, 2, 3, 6, 12];

// Preise pro Monat nach Laufzeit (in EUR)
const PRICING = {
  pro: {
    1:  2.99,
    2:  2.79,
    3:  2.49,
    6:  2.29,
    12: 1.99,
  },
  ultimate: {
    1:  4.99,
    2:  4.49,
    3:  3.99,
    6:  3.49,
    12: 2.99,
  },
};

export function calculatePrice(plan, months) {
  if (!PRICING[plan]) return null;
  const perMonth = PRICING[plan][months];
  if (!perMonth) return null;

  const total = perMonth * months;
  const regularTotal = PRICING[plan][1] * months;
  const savings = regularTotal - total;

  return {
    plan,
    months,
    perMonth,
    total,
    currency: "EUR",
    perMonthFormatted: formatPriceEUR(perMonth),
    totalFormatted: formatPriceEUR(total),
    savings: savings > 0 ? savings : 0,
    savingsFormatted: savings > 0 ? formatPriceEUR(savings) : null,
    savingsPercent: savings > 0 ? Math.round((savings / regularTotal) * 100) : 0,
  };
}

export function getAvailableProducts() {
  const products = [];
  for (const planId of ["pro", "ultimate"]) {
    const plan = PLANS[planId];
    for (const months of DURATION_OPTIONS) {
      const price = calculatePrice(planId, months);
      if (price) {
        products.push({
          plan: planId,
          planName: plan.name,
          ...price,
        });
      }
    }
  }
  return products;
}

export function formatPriceEUR(value) {
  return `\u20ac${value.toFixed(2)}`;
}

export function getPricingOverview() {
  return {
    brand: BRAND.name,
    durations: DURATION_OPTIONS,
    plans: {
      free: {
        name: "Free",
        price: formatPriceEUR(0),
        tagline: "Zum Testen und fuer kleine Server.",
        highlights: [
          "20 Free-Stationen",
          "Standard Audio (64k)",
          "Standard Reconnect",
          "Bis zu 2 Bots",
        ],
      },
      pro: {
        name: "Pro",
        recommended: true,
        startingAt: formatPriceEUR(PRICING.pro[1]) + "/Monat",
        tagline: "Fuer aktive Communities.",
        highlights: [
          "20 Free + 100 Pro-Stationen",
          "HQ Audio (128k Opus)",
          "Priority Auto-Reconnect",
          "Bis zu 8 Bots",
          "Rollenbasierte Berechtigungen",
          "Event-Scheduler",
        ],
        pricing: PRICING.pro,
      },
      ultimate: {
        name: "Ultimate",
        startingAt: formatPriceEUR(PRICING.ultimate[1]) + "/Monat",
        tagline: "Fuer grosse Server und volle Kontrolle.",
        highlights: [
          "Alles aus Pro",
          "Ultra HQ Audio (320k)",
          "Instant Reconnect",
          "Custom Station URLs",
          "Bis zu 16 Bots",
        ],
        pricing: PRICING.ultimate,
      },
    },
  };
}
