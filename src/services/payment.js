// ============================================================
// OmniFM: Payment / Stripe / Trial Functions
// ============================================================
import { log } from "../lib/logging.js";
import {
  TIERS,
  PRO_TRIAL_MONTHS,
  PRO_TRIAL_SEATS,
  normalizeSeats,
  isValidEmailAddress,
  isProTrialEnabled,
  sanitizeOfferCode,
  translateOfferReason,
  formatEuroCentsDe,
  clipText,
  waitMs,
} from "../lib/helpers.js";
import { normalizeLanguage, getDefaultLanguage } from "../i18n.js";
import {
  isConfigured as isEmailConfigured,
  sendMail,
  buildPurchaseEmail,
  buildInvoiceEmail,
  buildAdminNotification,
} from "../email.js";
import {
  isSessionProcessed,
  markSessionProcessed,
  isEventProcessed,
  markEventProcessed,
  reserveTrialClaim,
  finalizeTrialClaim,
  releaseTrialClaim,
  createOrExtendLicenseForEmail,
  listLicensesByContactEmail,
  patchLicenseById,
  createLicense,
} from "../premium-store.js";
import {
  markOfferRedemption,
  previewCheckoutOffer,
} from "../coupon-store.js";
import {
  buildInviteOverviewForTier,
  resolvePublicWebsiteUrl,
} from "../lib/api-helpers.js";

async function sendMailWithRetry({ to, subject, html, label, maxAttempts = 2 }) {
  let lastError = "";
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = await sendMail(to, subject, html);
    if (result?.success) {
      log("INFO", `[Email] ${label} sent to ${to} (attempt ${attempt}/${maxAttempts})`);
      return { success: true, attempts: attempt };
    }

    lastError = String(result?.error || "unknown email error");
    log("ERROR", `[Email] ${label} failed for ${to} (attempt ${attempt}/${maxAttempts}): ${lastError}`);
    if (attempt < maxAttempts) {
      await waitMs(1000 * attempt);
    }
  }

  return { success: false, error: lastError, attempts: maxAttempts };
}

function resolveCheckoutOfferForRequest({
  tier,
  seats,
  months,
  email,
  couponCode,
  referralCode,
  baseAmountCents,
  language,
}) {
  const checkoutLanguage = normalizeLanguage(language, getDefaultLanguage());
  const normalizedCouponCode = sanitizeOfferCode(couponCode);
  const normalizedReferralCode = sanitizeOfferCode(referralCode);

  const preview = previewCheckoutOffer({
    tier,
    seats,
    months,
    email,
    baseAmountCents,
    couponCode: normalizedCouponCode,
    referralCode: normalizedReferralCode,
  });

  const couponProvided = Boolean(normalizedCouponCode);
  const referralProvided = Boolean(normalizedReferralCode);

  if (couponProvided && (!preview.coupon?.ok || preview.applied?.kind !== "coupon")) {
    return {
      ok: false,
      status: 400,
      error: translateOfferReason(preview.coupon?.reason, checkoutLanguage),
      preview,
    };
  }

  if (!couponProvided && referralProvided && (!preview.referral?.ok || preview.applied?.kind !== "referral")) {
    return {
      ok: false,
      status: 400,
      error: translateOfferReason(preview.referral?.reason, checkoutLanguage),
      preview,
    };
  }

  return {
    ok: true,
    preview,
    couponCode: normalizedCouponCode || null,
    referralCode: normalizedReferralCode || null,
  };
}

async function activatePaidStripeSession(session, runtimes, source = "verify") {
  const fallbackLanguage = normalizeLanguage(session?.metadata?.language, getDefaultLanguage());
  const t = (de, en) => (fallbackLanguage === "de" ? de : en);
  if (!session || session.payment_status !== "paid" || !session.metadata) {
    return { success: false, status: 400, message: t("Zahlung nicht abgeschlossen oder ungueltig.", "Payment not completed or invalid.") };
  }

  const sessionId = String(session.id || "").trim();
  if (!sessionId) {
    return { success: false, status: 400, message: t("session.id fehlt.", "session.id is missing.") };
  }

  const {
    email: metaEmail,
    tier,
    months,
    seats,
    language,
    appliedOfferCode: metaAppliedOfferCode,
    appliedOfferKind: metaAppliedOfferKind,
    couponCode: metaCouponCode,
    referralCode: metaReferralCode,
    discountCents: metaDiscountCents,
    baseAmountCents: metaBaseAmountCents,
    finalAmountCents: metaFinalAmountCents,
    offerOwnerLabel: metaOfferOwnerLabel,
  } = session.metadata;
  const customerEmail = String(metaEmail || session.customer_details?.email || "").trim().toLowerCase();
  const cleanTier = String(tier || "").trim().toLowerCase();
  const cleanSeats = [1, 2, 3, 5].includes(Number(seats)) ? Number(seats) : 1;
  const durationMonths = Math.max(1, parseInt(months, 10) || 1);
  const customerLanguage = normalizeLanguage(language, fallbackLanguage);
  const amountPaid = Math.max(0, Number.parseInt(String(session.amount_total || 0), 10) || 0);
  const baseAmountCentsMeta = Math.max(0, Number.parseInt(String(metaBaseAmountCents || 0), 10) || 0);
  const discountCentsMeta = Math.max(0, Number.parseInt(String(metaDiscountCents || 0), 10) || 0);
  const finalAmountCentsMeta = Math.max(0, Number.parseInt(String(metaFinalAmountCents || 0), 10) || 0);
  const appliedOfferCode = sanitizeOfferCode(metaAppliedOfferCode || metaCouponCode);
  const referralCode = sanitizeOfferCode(metaReferralCode);
  const appliedOfferKind = ["coupon", "referral"].includes(String(metaAppliedOfferKind || "").toLowerCase())
    ? String(metaAppliedOfferKind).toLowerCase()
    : (appliedOfferCode ? "coupon" : null);
  const offerOwnerLabel = clipText(metaOfferOwnerLabel || "", 160) || null;

  const baseAmountCents = baseAmountCentsMeta > 0
    ? baseAmountCentsMeta
    : Math.max(0, amountPaid + discountCentsMeta);
  const discountCents = Math.max(
    0,
    discountCentsMeta > 0
      ? discountCentsMeta
      : Math.max(0, baseAmountCents - Math.max(amountPaid, finalAmountCentsMeta))
  );
  const finalAmountCents = Math.max(
    0,
    amountPaid > 0
      ? amountPaid
      : (finalAmountCentsMeta > 0 ? finalAmountCentsMeta : Math.max(0, baseAmountCents - discountCents))
  );

  if (!customerEmail || !["pro", "ultimate"].includes(cleanTier)) {
    return {
      success: false,
      status: 400,
      message: customerLanguage === "de"
        ? "Session-Metadaten sind ungueltig (email oder tier fehlt)."
        : "Session metadata is invalid (email or tier missing).",
    };
  }

  if (isSessionProcessed(sessionId)) {
    return {
      success: true,
      replay: true,
      email: customerEmail,
      tier: cleanTier,
      message: customerLanguage === "de"
        ? `Session ${sessionId} wurde bereits verarbeitet.`
        : `Session ${sessionId} has already been processed.`,
    };
  }

  let license;
  let licenseChange;
  try {
    licenseChange = createOrExtendLicenseForEmail({
      plan: cleanTier,
      seats: cleanSeats,
      billingPeriod: durationMonths >= 12 ? "yearly" : "monthly",
      months: durationMonths,
      activatedBy: "stripe",
      note: `Session: ${sessionId}`,
      contactEmail: customerEmail,
      preferredLanguage: customerLanguage,
    });
    license = licenseChange.license;
  } catch (err) {
    return { success: false, status: 400, message: err.message || String(err) };
  }

  const effectiveTier = String(license?.plan || cleanTier);
  const effectiveSeats = normalizeSeats(license?.seats || cleanSeats);
  const isUpgrade = Boolean(licenseChange?.upgraded);
  const isRenewal = Boolean(licenseChange?.extended && !licenseChange?.upgraded);

  if (appliedOfferCode || referralCode) {
    markOfferRedemption(sessionId, {
      source,
      email: customerEmail,
      code: appliedOfferCode || null,
      kind: appliedOfferKind || null,
      referralCode: referralCode || null,
      tier: effectiveTier,
      seats: effectiveSeats,
      months: durationMonths,
      baseAmountCents,
      discountCents,
      finalAmountCents,
    });
  }

  markSessionProcessed(sessionId, {
    email: customerEmail,
    tier: effectiveTier,
    licenseId: license.id,
    source,
    expiresAt: license.expiresAt,
    language: customerLanguage,
    appliedOfferCode: appliedOfferCode || null,
    appliedOfferKind: appliedOfferKind || null,
    referralCode: referralCode || null,
    baseAmountCents,
    discountCents,
    finalAmountCents,
  });

  const emailDelivery = {
    smtpConfigured: isEmailConfigured(),
    purchaseSent: false,
    invoiceSent: false,
    adminSent: false,
    errors: [],
  };

  if (emailDelivery.smtpConfigured && customerEmail) {
    const tierConfig = TIERS[effectiveTier] || TIERS[cleanTier];
    const inviteOverview = buildInviteOverviewForTier(runtimes, effectiveTier);

    const purchaseHtml = buildPurchaseEmail({
      tier: effectiveTier,
      tierName: tierConfig.name,
      months: durationMonths,
      licenseKey: license.id,
      seats: effectiveSeats,
      email: customerEmail,
      expiresAt: license.expiresAt,
      inviteOverview,
      dashboardUrl: resolvePublicWebsiteUrl(),
      isUpgrade,
      isRenewal,
      pricePaid: amountPaid,
      baseAmountCents,
      discountCents,
      appliedOfferCode,
      appliedOfferKind,
      referralCode,
      offerOwnerLabel,
      currency: session.currency || "eur",
      language: customerLanguage,
    });
    let purchaseSubject;
    if (isUpgrade) {
      purchaseSubject = customerLanguage === "de"
        ? `OmniFM ${tierConfig.name} - Upgrade bestaetigt`
        : `OmniFM ${tierConfig.name} - Upgrade confirmed`;
    } else if (isRenewal) {
      purchaseSubject = customerLanguage === "de"
        ? `OmniFM ${tierConfig.name} - Verlaengerung bestaetigt`
        : `OmniFM ${tierConfig.name} - Renewal confirmed`;
    } else {
      purchaseSubject = customerLanguage === "de"
        ? `OmniFM ${tierConfig.name} - Dein Lizenz-Key`
        : `OmniFM ${tierConfig.name} - Your license key`;
    }

    const invoiceId = `OFM-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${sessionId.slice(-8).toUpperCase()}`;
    const invoiceHtml = buildInvoiceEmail({
      invoiceId,
      sessionId,
      customerEmail,
      tier: effectiveTier,
      tierName: tierConfig.name,
      months: durationMonths,
      seats: effectiveSeats,
      isUpgrade,
      isRenewal,
      amountPaid,
      currency: session.currency || "eur",
      licenseKey: license.id,
      expiresAt: license.expiresAt,
      baseAmountCents,
      discountCents,
      appliedOfferCode,
      appliedOfferKind,
      referralCode,
      offerOwnerLabel,
      language: customerLanguage,
    });
    const invoiceSubject = customerLanguage === "de"
      ? `OmniFM Rechnung ${invoiceId}`
      : `OmniFM Invoice ${invoiceId}`;

    const [purchaseResult, invoiceResult] = await Promise.all([
      sendMailWithRetry({
        to: customerEmail,
        subject: purchaseSubject,
        html: purchaseHtml,
        label: "purchase-mail",
        maxAttempts: 2,
      }),
      sendMailWithRetry({
        to: customerEmail,
        subject: invoiceSubject,
        html: invoiceHtml,
        label: "invoice-mail",
        maxAttempts: 2,
      }),
    ]);

    emailDelivery.purchaseSent = Boolean(purchaseResult?.success);
    emailDelivery.invoiceSent = Boolean(invoiceResult?.success);
    if (!emailDelivery.purchaseSent) emailDelivery.errors.push(`purchase:${purchaseResult?.error || "unknown"}`);
    if (!emailDelivery.invoiceSent) emailDelivery.errors.push(`invoice:${invoiceResult?.error || "unknown"}`);

    const adminEmail = String(process.env.ADMIN_EMAIL || "").trim().toLowerCase();
    if (adminEmail) {
      const adminHtml = buildAdminNotification({
        tier: effectiveTier,
        tierName: tierConfig.name,
        months: durationMonths,
        serverId: "-",
        expiresAt: license.expiresAt,
        pricePaid: amountPaid,
        language: customerLanguage,
      });
      const adminSubject = customerLanguage === "de"
        ? `OmniFM Kauf eingegangen (${tierConfig.name})`
        : `OmniFM purchase received (${tierConfig.name})`;
      const adminResult = await sendMailWithRetry({
        to: adminEmail,
        subject: adminSubject,
        html: adminHtml,
        label: "admin-notification",
        maxAttempts: 1,
      });
      emailDelivery.adminSent = Boolean(adminResult?.success);
      if (!emailDelivery.adminSent) emailDelivery.errors.push(`admin:${adminResult?.error || "unknown"}`);
    }
  } else if (!emailDelivery.smtpConfigured) {
    emailDelivery.errors.push("smtp_not_configured");
    log("ERROR", `[Email] SMTP nicht konfiguriert - keine Kauf-E-Mail fuer ${customerEmail} moeglich.`);
  } else {
    emailDelivery.errors.push("customer_email_missing");
    log("ERROR", "[Email] Kunden-E-Mail fehlt - keine Kauf-E-Mail moeglich.");
  }

  log(
    "INFO",
    `[License] ${licenseChange?.created ? "Erstellt" : isUpgrade ? "Upgrade+Verlaengerung" : "Verlaengert"}: ${license.id} fuer ${customerEmail} (${effectiveTier}, ${effectiveSeats} Seats, +${durationMonths}mo, paid=${amountPaid}, discount=${discountCents}, code=${appliedOfferCode || "-"}, ref=${referralCode || "-"}) via ${source} | email purchase=${emailDelivery.purchaseSent} invoice=${emailDelivery.invoiceSent} admin=${emailDelivery.adminSent}`
  );

  const tierNameForMessage = TIERS[effectiveTier]?.name || TIERS[cleanTier]?.name || "Premium";
  let message;
  if (isUpgrade) {
    message = customerLanguage === "de"
      ? `Upgrade auf ${tierNameForMessage} abgeschlossen! Dein Lizenz-Key bleibt: ${license.id} - Pruefe deine E-Mail (${customerEmail}).`
      : `Upgrade to ${tierNameForMessage} completed! Your license key remains: ${license.id} - Check your email (${customerEmail}).`;
  } else if (isRenewal) {
    message = customerLanguage === "de"
      ? `${tierNameForMessage} verlaengert! Dein bestehender Lizenz-Key bleibt: ${license.id} - Pruefe deine E-Mail (${customerEmail}).`
      : `${tierNameForMessage} renewed! Your existing license key remains: ${license.id} - Check your email (${customerEmail}).`;
  } else {
    message = customerLanguage === "de"
      ? `${tierNameForMessage} aktiviert! Lizenz-Key: ${license.id} - Pruefe deine E-Mail (${customerEmail}).`
      : `${tierNameForMessage} activated! License key: ${license.id} - Check your email (${customerEmail}).`;
  }

  if (discountCents > 0 && appliedOfferCode) {
    const discountLabel = customerLanguage === "de"
      ? ` Rabatt angewendet: ${formatEuroCentsDe(discountCents)} EUR (${appliedOfferCode}).`
      : ` Discount applied: EUR ${(discountCents / 100).toFixed(2)} (${appliedOfferCode}).`;
    message += discountLabel;
  }

  if (!emailDelivery.smtpConfigured) {
    message += customerLanguage === "de"
      ? " Hinweis: SMTP ist aktuell nicht konfiguriert, daher wurde keine E-Mail versendet."
      : " Note: SMTP is not configured, so no email could be sent.";
  } else if (!emailDelivery.purchaseSent || !emailDelivery.invoiceSent) {
    const missingPartsDe = [
      !emailDelivery.purchaseSent ? "Lizenz-Mail" : "",
      !emailDelivery.invoiceSent ? "Rechnung" : "",
    ].filter(Boolean).join(" + ");
    const missingPartsEn = [
      !emailDelivery.purchaseSent ? "license email" : "",
      !emailDelivery.invoiceSent ? "invoice" : "",
    ].filter(Boolean).join(" + ");
    message += customerLanguage === "de"
      ? ` Achtung: ${missingPartsDe} konnte nicht zugestellt werden. Bitte Support kontaktieren.`
      : ` Warning: ${missingPartsEn} could not be delivered. Please contact support.`;
  }

  return {
    success: true,
    email: customerEmail,
    tier: effectiveTier,
    licenseKey: license.id,
    expiresAt: license.expiresAt,
    seats: effectiveSeats,
    language: customerLanguage,
    amountPaid,
    discountCents,
    baseAmountCents,
    finalAmountCents,
    appliedOfferCode: appliedOfferCode || null,
    appliedOfferKind: appliedOfferKind || null,
    referralCode: referralCode || null,
    emailStatus: emailDelivery,
    message,
    created: Boolean(licenseChange?.created),
    renewed: isRenewal,
    upgraded: isUpgrade,
  };
}

async function activateProTrial({ email, language, runtimes, source = "trial" }) {
  const customerLanguage = normalizeLanguage(language, getDefaultLanguage());
  const t = (de, en) => (customerLanguage === "de" ? de : en);
  const customerEmail = String(email || "").trim().toLowerCase();

  if (!isProTrialEnabled()) {
    return {
      success: false,
      status: 403,
      message: t(
        "Der Pro-Testmonat ist aktuell deaktiviert.",
        "The Pro trial month is currently disabled."
      ),
    };
  }

  if (!isValidEmailAddress(customerEmail)) {
    return {
      success: false,
      status: 400,
      message: t(
        "Bitte eine gueltige E-Mail-Adresse eingeben.",
        "Please enter a valid email address."
      ),
    };
  }

  const existingForEmail = listLicensesByContactEmail(customerEmail);
  if (existingForEmail.length > 0) {
    return {
      success: false,
      status: 409,
      message: t(
        "Für diese E-Mail existiert bereits eine Lizenz. Der Testmonat ist nur einmalig für Neukunden verfügbar.",
        "A license already exists for this email. The trial month is only available once for new customers."
      ),
    };
  }

  const reserved = reserveTrialClaim(customerEmail, {
    source,
    preferredLanguage: customerLanguage,
    requestedAt: new Date().toISOString(),
  });

  if (!reserved.ok) {
    return {
      success: false,
      status: 409,
      message: t(
        "Der Pro-Testmonat wurde fuer diese E-Mail bereits genutzt.",
        "The Pro trial month has already been used for this email."
      ),
    };
  }

  let license;
  try {
    license = createLicense({
      plan: "pro",
      seats: PRO_TRIAL_SEATS,
      billingPeriod: "monthly",
      months: PRO_TRIAL_MONTHS,
      activatedBy: "trial",
      note: `Trial via ${source}`,
      contactEmail: customerEmail,
      preferredLanguage: customerLanguage,
    });
  } catch (err) {
    releaseTrialClaim(customerEmail);
    return {
      success: false,
      status: 500,
      message: t(
        "Der Pro-Testmonat konnte nicht erstellt werden. Bitte spaeter erneut versuchen.",
        "Could not create the Pro trial month. Please try again later."
      ),
      detail: err?.message || String(err),
    };
  }

  finalizeTrialClaim(customerEmail, {
    source,
    licenseId: license.id,
    tier: "pro",
    seats: PRO_TRIAL_SEATS,
    months: PRO_TRIAL_MONTHS,
    expiresAt: license.expiresAt,
    activatedBy: "trial",
  });

  const emailDelivery = {
    smtpConfigured: isEmailConfigured(),
    purchaseSent: false,
    invoiceSent: false,
    adminSent: false,
    errors: [],
  };

  if (emailDelivery.smtpConfigured) {
    const tierConfig = TIERS.pro;
    const isDe = customerLanguage === "de";
    const inviteOverview = buildInviteOverviewForTier(runtimes, "pro");
    const purchaseHtml = buildPurchaseEmail({
      tier: "pro",
      tierName: isDe ? `${tierConfig.name} Testmonat` : `${tierConfig.name} Trial Month`,
      months: PRO_TRIAL_MONTHS,
      licenseKey: license.id,
      seats: PRO_TRIAL_SEATS,
      email: customerEmail,
      expiresAt: license.expiresAt,
      inviteOverview,
      dashboardUrl: resolvePublicWebsiteUrl(),
      isUpgrade: false,
      pricePaid: 0,
      currency: "eur",
      language: customerLanguage,
    });
    const purchaseSubject = isDe
      ? "OmniFM Pro Testmonat - Dein Lizenz-Key"
      : "OmniFM Pro Trial Month - Your license key";

    const purchaseResult = await sendMailWithRetry({
      to: customerEmail,
      subject: purchaseSubject,
      html: purchaseHtml,
      label: "trial-license-mail",
      maxAttempts: 2,
    });
    emailDelivery.purchaseSent = Boolean(purchaseResult?.success);
    if (!emailDelivery.purchaseSent) {
      emailDelivery.errors.push(`purchase:${purchaseResult?.error || "unknown"}`);
    }

    const adminEmail = String(process.env.ADMIN_EMAIL || "").trim().toLowerCase();
    if (adminEmail) {
      const adminHtml = buildAdminNotification({
        tier: "pro",
        tierName: isDe ? "Pro Testmonat" : "Pro Trial Month",
        months: PRO_TRIAL_MONTHS,
        serverId: "-",
        expiresAt: license.expiresAt,
        pricePaid: 0,
        language: customerLanguage,
      });
      const adminSubject = isDe
        ? "OmniFM Pro-Testmonat aktiviert"
        : "OmniFM Pro trial activated";
      const adminResult = await sendMailWithRetry({
        to: adminEmail,
        subject: adminSubject,
        html: adminHtml,
        label: "trial-admin-notification",
        maxAttempts: 1,
      });
      emailDelivery.adminSent = Boolean(adminResult?.success);
      if (!emailDelivery.adminSent) {
        emailDelivery.errors.push(`admin:${adminResult?.error || "unknown"}`);
      }
    }
  } else {
    emailDelivery.errors.push("smtp_not_configured");
    log("ERROR", `[Email] SMTP nicht konfiguriert - keine Trial-E-Mail fuer ${customerEmail} moeglich.`);
  }

  log(
    "INFO",
    `[Trial] Pro-Test aktiviert: ${license.id} fuer ${customerEmail} | email purchase=${emailDelivery.purchaseSent} admin=${emailDelivery.adminSent}`
  );

  let message = customerLanguage === "de"
    ? `Pro-Testmonat aktiviert! Lizenz-Key: ${license.id} - Pruefe deine E-Mail (${customerEmail}).`
    : `Pro trial month activated! License key: ${license.id} - Check your email (${customerEmail}).`;

  if (!emailDelivery.smtpConfigured) {
    message = customerLanguage === "de"
      ? `Pro-Testmonat aktiviert! Lizenz-Key: ${license.id}. Hinweis: SMTP ist nicht konfiguriert, daher wurde keine E-Mail versendet.`
      : `Pro trial month activated! License key: ${license.id}. Note: SMTP is not configured, so no email was sent.`;
  } else if (!emailDelivery.purchaseSent) {
    message = customerLanguage === "de"
      ? `Pro-Testmonat aktiviert! Lizenz-Key: ${license.id}. Achtung: Die Lizenz-Mail konnte nicht zugestellt werden. Bitte Support kontaktieren.`
      : `Pro trial month activated! License key: ${license.id}. Warning: The license email could not be delivered. Please contact support.`;
  }

  return {
    success: true,
    email: customerEmail,
    tier: "pro",
    licenseKey: license.id,
    expiresAt: license.expiresAt,
    seats: PRO_TRIAL_SEATS,
    months: PRO_TRIAL_MONTHS,
    language: customerLanguage,
    emailStatus: emailDelivery,
    message,
  };
}

export {
  sendMailWithRetry,
  resolveCheckoutOfferForRequest,
  activatePaidStripeSession,
  activateProTrial,
};
