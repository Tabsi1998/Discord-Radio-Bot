import React, { useState, useEffect, useCallback } from 'react';
import { Crown, Clock, Users, ExternalLink, AlertTriangle, RefreshCw } from 'lucide-react';

const TIER_COLORS = { free: '#71717A', pro: '#10B981', ultimate: '#8B5CF6' };
const TIER_LABELS = { free: 'Free', pro: 'Pro', ultimate: 'Ultimate' };

function formatDate(isoStr) {
  if (!isoStr) return '-';
  try {
    const d = new Date(isoStr);
    return d.toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch { return '-'; }
}

export default function DashboardSubscription({ apiRequest, selectedGuildId, t }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!selectedGuildId) return;
    setLoading(true);
    setError('');
    try {
      const result = await apiRequest(`/api/dashboard/license?serverId=${encodeURIComponent(selectedGuildId)}`);
      setData(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [selectedGuildId, apiRequest]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div style={{ color: '#52525B', textAlign: 'center', padding: 40 }}>{t('Lade...', 'Loading...')}</div>;

  const tier = data?.tier || 'free';
  const tierColor = TIER_COLORS[tier] || '#71717A';
  const lic = data?.license;
  const isExpired = lic?.expired;
  const isExpiringSoon = !isExpired && lic?.remainingDays != null && lic.remainingDays <= 7;

  return (
    <section data-testid="dashboard-subscription-panel" style={{ display: 'grid', gap: 14 }}>
      {error && <div style={{ border: '1px solid rgba(252,165,165,0.25)', background: 'rgba(127,29,29,0.12)', padding: '10px 12px', color: '#FCA5A5', fontSize: 13 }}>{error}</div>}

      {/* Plan Overview */}
      <div data-testid="subscription-plan-card" style={{
        background: '#0A0A0A', border: `1px solid ${tierColor}33`, padding: 24,
        display: 'grid', gap: 20,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Crown size={24} color={tierColor} />
            <div>
              <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: 28, fontWeight: 700, color: tierColor }}>
                {TIER_LABELS[tier] || 'Free'}
              </div>
              <div style={{ color: '#52525B', fontSize: 12 }}>{t('Aktueller Plan', 'Current plan')}</div>
            </div>
          </div>
          <button data-testid="subscription-refresh-btn" onClick={load} style={{
            border: '1px solid #1A1A2E', background: 'transparent', color: '#71717A', height: 34, padding: '0 10px',
            display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12,
          }}>
            <RefreshCw size={13} /> {t('Aktualisieren', 'Refresh')}
          </button>
        </div>

        {tier === 'free' && (
          <div data-testid="subscription-free-info" style={{
            border: '1px solid #1A1A2E', background: '#050505', padding: 16, display: 'grid', gap: 8,
          }}>
            <p style={{ color: '#71717A', fontSize: 13, lineHeight: 1.6 }}>
              {t(
                'Du nutzt aktuell den Free-Plan. Upgrade auf Pro oder Ultimate fuer erweiterte Features wie das Dashboard, mehr Bots und bessere Audioqualitaet.',
                'You are currently on the Free plan. Upgrade to Pro or Ultimate for advanced features like the dashboard, more bots and better audio quality.'
              )}
            </p>
            <a href="/?page=home#premium" data-testid="subscription-upgrade-link" style={{
              display: 'inline-flex', alignItems: 'center', gap: 8, marginTop: 4,
              border: '1px solid #8B5CF6', background: 'rgba(139,92,246,0.12)', color: '#fff',
              padding: '10px 16px', textDecoration: 'none', fontWeight: 600, fontSize: 14, width: 'fit-content',
            }}>
              <Crown size={15} /> {t('Jetzt upgraden', 'Upgrade now')}
            </a>
          </div>
        )}

        {tier !== 'free' && lic && (
          <div data-testid="subscription-details" style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10,
          }}>
            {/* Expiry */}
            <div style={{ border: '1px solid #1A1A2E', background: '#050505', padding: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <Clock size={14} color="#71717A" />
                <span style={{ fontSize: 11, color: '#71717A', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{t('Ablaufdatum', 'Expires')}</span>
              </div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 16, fontWeight: 600, color: isExpired ? '#EF4444' : isExpiringSoon ? '#F59E0B' : '#fff' }}>
                {formatDate(lic.expiresAt)}
              </div>
              {lic.remainingDays != null && !isExpired && (
                <div style={{ fontSize: 12, color: isExpiringSoon ? '#F59E0B' : '#52525B', marginTop: 4 }}>
                  {lic.remainingDays} {t('Tage verbleibend', 'days remaining')}
                </div>
              )}
              {isExpired && (
                <div style={{ fontSize: 12, color: '#EF4444', marginTop: 4 }}>{t('Abgelaufen', 'Expired')}</div>
              )}
            </div>

            {/* Seats */}
            <div style={{ border: '1px solid #1A1A2E', background: '#050505', padding: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <Users size={14} color="#71717A" />
                <span style={{ fontSize: 11, color: '#71717A', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{t('Server-Slots', 'Server slots')}</span>
              </div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 16, fontWeight: 600 }}>
                {lic.seatsUsed || 0} / {lic.seats || 1}
              </div>
              <div style={{ fontSize: 12, color: '#52525B', marginTop: 4 }}>
                {t('belegt', 'used')}
              </div>
            </div>

            {/* E-Mail */}
            {lic.emailMasked && (
              <div style={{ border: '1px solid #1A1A2E', background: '#050505', padding: 14 }}>
                <div style={{ fontSize: 11, color: '#71717A', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>{t('Lizenz-E-Mail', 'License email')}</div>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 14, color: '#A1A1AA' }}>
                  {lic.emailMasked}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Warning for expired */}
        {isExpired && tier !== 'free' && (
          <div data-testid="subscription-expired-warning" style={{
            border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(127,29,29,0.12)', padding: '14px 16px',
            display: 'flex', alignItems: 'center', gap: 12,
          }}>
            <AlertTriangle size={18} color="#EF4444" />
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#FCA5A5' }}>{t('Lizenz abgelaufen', 'License expired')}</div>
              <div style={{ fontSize: 12, color: '#71717A', marginTop: 2 }}>
                {t(
                  'Deine Lizenz ist abgelaufen. Verlaengere sie, um weiterhin alle Features nutzen zu koennen.',
                  'Your license has expired. Renew it to continue using all features.'
                )}
              </div>
            </div>
          </div>
        )}

        {/* Expiring soon warning */}
        {isExpiringSoon && !isExpired && (
          <div data-testid="subscription-expiring-warning" style={{
            border: '1px solid rgba(245,158,11,0.3)', background: 'rgba(120,53,15,0.12)', padding: '14px 16px',
            display: 'flex', alignItems: 'center', gap: 12,
          }}>
            <AlertTriangle size={18} color="#F59E0B" />
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#FDE68A' }}>{t('Laeuft bald ab', 'Expiring soon')}</div>
              <div style={{ fontSize: 12, color: '#71717A', marginTop: 2 }}>
                {t(
                  `Deine Lizenz laeuft in ${lic.remainingDays} Tagen ab. Verlaengere rechtzeitig!`,
                  `Your license expires in ${lic.remainingDays} days. Renew in time!`
                )}
              </div>
            </div>
          </div>
        )}

        {/* Action buttons */}
        {tier !== 'free' && (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <a href="/?page=home#premium" data-testid="subscription-extend-link" style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              border: `1px solid ${tierColor}`, background: `${tierColor}1A`, color: '#fff',
              padding: '10px 16px', textDecoration: 'none', fontWeight: 600, fontSize: 14,
            }}>
              <ExternalLink size={15} /> {isExpired ? t('Jetzt verlaengern', 'Renew now') : t('Abo verlaengern', 'Extend subscription')}
            </a>
            {tier === 'pro' && (
              <a href="/?page=home#premium" data-testid="subscription-upgrade-ultimate-link" style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                border: '1px solid #8B5CF6', background: 'rgba(139,92,246,0.12)', color: '#fff',
                padding: '10px 16px', textDecoration: 'none', fontWeight: 600, fontSize: 14,
              }}>
                <Crown size={15} /> {t('Zu Ultimate upgraden', 'Upgrade to Ultimate')}
              </a>
            )}
          </div>
        )}
      </div>

      {/* Tier Features */}
      <div data-testid="subscription-features-card" style={{ background: '#0A0A0A', border: '1px solid #1A1A2E', padding: 16 }}>
        <h4 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 18, marginBottom: 14, color: '#D4D4D8' }}>
          {t('Plan-Features', 'Plan features')}
        </h4>
        <div style={{ display: 'grid', gap: 8 }}>
          {tier === 'free' && <>
            <FeatureRow label="64k Bitrate" included t={t} />
            <FeatureRow label={t('Bis zu 2 Bots', 'Up to 2 bots')} included t={t} />
            <FeatureRow label={t('20 Free Stationen', '20 free stations')} included t={t} />
            <FeatureRow label={t('Auto-Reconnect (5s)', 'Auto-reconnect (5s)')} included t={t} />
            <FeatureRow label={t('Dashboard', 'Dashboard')} included={false} t={t} />
            <FeatureRow label={t('Custom Stations', 'Custom stations')} included={false} t={t} />
          </>}
          {tier === 'pro' && <>
            <FeatureRow label="128k Bitrate (HQ Opus)" included t={t} />
            <FeatureRow label={t('Bis zu 8 Bots', 'Up to 8 bots')} included t={t} />
            <FeatureRow label={t('120 Stationen (Free + Pro)', '120 stations (free + pro)')} included t={t} />
            <FeatureRow label={t('Priority Reconnect (1,5s)', 'Priority reconnect (1.5s)')} included t={t} />
            <FeatureRow label={t('Dashboard + Events', 'Dashboard + events')} included t={t} />
            <FeatureRow label={t('Custom Station URLs', 'Custom station URLs')} included={false} t={t} />
          </>}
          {tier === 'ultimate' && <>
            <FeatureRow label="320k Bitrate (Ultra HQ)" included t={t} />
            <FeatureRow label={t('Bis zu 16 Bots', 'Up to 16 bots')} included t={t} />
            <FeatureRow label={t('Alle Stationen + Custom URLs', 'All stations + custom URLs')} included t={t} />
            <FeatureRow label={t('Instant Reconnect (0,4s)', 'Instant reconnect (0.4s)')} included t={t} />
            <FeatureRow label={t('Dashboard + Events + Analytics', 'Dashboard + events + analytics')} included t={t} />
            <FeatureRow label={t('Fallback-Station', 'Fallback station')} included t={t} />
          </>}
        </div>
      </div>
    </section>
  );
}

function FeatureRow({ label, included }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0' }}>
      {included ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2"><polyline points="20 6 9 17 4 12" /></svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3F3F46" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
      )}
      <span style={{ fontSize: 13, color: included ? '#D4D4D8' : '#52525B' }}>{label}</span>
    </div>
  );
}
