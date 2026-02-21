// ============================================================
// OmniFM - Pricing Calculator
// ============================================================

import { PLANS, BRAND } from "../config/plans.js";

const YEARLY_MONTHS_CHARGED = 10; // 12 months, pay for 10

// Exact pricing table (in EUR)
const PRICING = {
  pro: {
    monthly: { 1: 2.99, 2: 5.49, 3: 7.49, 5: 11.49 },
  },
  ultimate: {
    monthly: { 1: 4.99, 2: 7.99, 3: 10.99, 5: 16.99 },
  },
};

// Valid seat counts
export const SEAT_OPTIONS = [1, 2, 3, 5];

function yearlyFromMonthly(monthlyPrice) {
  const raw = monthlyPrice * YEARLY_MONTHS_CHARGED;
  // Round to .99 ending
  return Math.floor(raw) + 0.99;
}

export function getAvailableProducts() {
  const products = [];

  for (const planId of ["pro", "ultimate"]) {
    const plan = PLANS[planId];
    const priceTable = PRICING[planId];

    for (const seats of SEAT_OPTIONS) {
      const monthly = priceTable.monthly[seats];
      if (!monthly) continue;

      const yearly = yearlyFromMonthly(monthly);
      const yearlySavings = (monthly * 12) - yearly;
      const monthlyEquiv = yearly / 12;

      products.push({
        plan: planId,
        planName: plan.name,
        seats,
        monthly: {
          price: monthly,
          priceFormatted: formatPriceEUR(monthly),
          period: "monthly",
          perServer: formatPriceEUR(monthly / seats),
        },
        yearly: {
          price: yearly,
          priceFormatted: formatPriceEUR(yearly),
          period: "yearly",
          perMonth: formatPriceEUR(monthlyEquiv),
          perServer: formatPriceEUR(yearly / 12 / seats),
          savings: formatPriceEUR(yearlySavings),
          savingsText: `Save ${formatPriceEUR(yearlySavings)}/year (2 months free)`,
        },
      });
    }
  }

  return products;
}

export function calculatePrice(plan, seats, period) {
  if (!PRICING[plan]) return null;
  const monthly = PRICING[plan].monthly[seats];
  if (!monthly) return null;

  if (period === "yearly") {
    const yearly = yearlyFromMonthly(monthly);
    const regularYearly = monthly * 12;
    return {
      price: yearly,
      currency: "EUR",
      period: "yearly",
      seats,
      plan,
      priceFormatted: formatPriceEUR(yearly),
      perMonth: formatPriceEUR(yearly / 12),
      savings: formatPriceEUR(regularYearly - yearly),
      savingsText: "2 months free",
    };
  }

  return {
    price: monthly,
    currency: "EUR",
    period: "monthly",
    seats,
    plan,
    priceFormatted: formatPriceEUR(monthly),
    perMonth: formatPriceEUR(monthly),
    savings: null,
    savingsText: null,
  };
}

export function formatPriceEUR(value) {
  return `\u20ac${value.toFixed(2)}`;
}

export function getPricingOverview() {
  return {
    brand: BRAND.name,
    yearlyDiscount: "2 months free (pay for 10)",
    plans: {
      free: {
        name: "Free",
        price: formatPriceEUR(0),
        tagline: "Perfect for testing and small servers.",
        highlights: [
          "20 Free stations",
          "Standard Audio (64k)",
          "Standard reconnect",
          "Up to 2 bots",
        ],
      },
      pro: {
        name: "Pro",
        recommended: true,
        startingAt: formatPriceEUR(2.99) + "/mo",
        tagline: "For active communities.",
        highlights: [
          "20 Free + 100 Pro stations",
          "HQ Audio (128k Opus)",
          "Priority auto-reconnect",
          "Up to 8 bots",
          "Server-based licensing (1/2/3/5 servers)",
        ],
        pricing: PRICING.pro,
      },
      ultimate: {
        name: "Ultimate",
        startingAt: formatPriceEUR(4.99) + "/mo",
        tagline: "For large servers and full control.",
        highlights: [
          "Everything in Pro",
          "Ultra HQ Audio (320k)",
          "Instant reconnect",
          "Custom Station URLs",
          "Up to 16 bots",
          "Server-based licensing bundles",
        ],
        pricing: PRICING.ultimate,
      },
    },
  };
}
