import React, { useState, useEffect, useCallback, useRef } from 'react';
import Hero from './components/Hero';
import Features from './components/Features';
import TrustBar from './components/TrustBar';
import WhyOmniFM from './components/WhyOmniFM';
import DashboardShowcase from './components/DashboardShowcase';
import StationBrowser from './components/StationBrowser';
import Premium from './components/Premium';
import ImpressumSection from './components/ImpressumSection';
import PrivacySection from './components/PrivacySection';
import StatsFooter from './components/StatsFooter';
import Navbar from './components/Navbar';
import DashboardPortal from './components/DashboardPortal';
import FaqSection from './components/FaqSection';
import { I18nProvider } from './i18n';
import { buildApiUrl } from './lib/api';

async function fetchJson(path, signal) {
  const res = await fetch(buildApiUrl(path), {
    cache: 'no-store',
    signal,
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
    // keep null fallback when response is not JSON
  }

  if (!res.ok) {
    const errorText = data && typeof data.error === 'string'
      ? data.error
      : `HTTP ${res.status}`;
    throw new Error(`${path}: ${errorText}`);
  }

  return data || {};
}

function resolvePageFromLocation() {
  if (typeof window === 'undefined') return 'home';

  try {
    const url = new URL(window.location.href);
    const rawPage = String(url.searchParams.get('page') || '').trim().toLowerCase();
    if (rawPage === 'imprint' || rawPage === 'impressum') return 'imprint';
    if (rawPage === 'privacy' || rawPage === 'datenschutz' || rawPage === 'privacy-policy') return 'privacy';
    if (rawPage === 'dashboard') return 'dashboard';
    if (rawPage === 'home') return 'home';
  } catch {
    return 'home';
  }

  return 'home';
}

function AppContent() {
  const [bots, setBots] = useState([]);
  const [stations, setStations] = useState([]);
  const [stats, setStats] = useState({});
  const [legal, setLegal] = useState(null);
  const [privacy, setPrivacy] = useState(null);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);
  const inFlightRef = useRef(false);
  const currentPage = resolvePageFromLocation();

  const fetchData = useCallback(async (signal) => {
    const endpoints = [
      '/api/bots',
      '/api/stations',
      '/api/stats',
      '/api/legal',
      '/api/privacy',
    ];

    const results = await Promise.allSettled(endpoints.map((path) => fetchJson(path, signal)));
    if (!mountedRef.current) return;

    let anyUpdate = false;

    if (results[0].status === 'fulfilled') {
      setBots(results[0].value?.bots || []);
      anyUpdate = true;
    } else if (results[0].reason?.name !== 'AbortError') {
      console.error('Bots API error:', results[0].reason);
    }

    if (results[1].status === 'fulfilled') {
      setStations(results[1].value?.stations || []);
      anyUpdate = true;
    } else if (results[1].reason?.name !== 'AbortError') {
      console.error('Stations API error:', results[1].reason);
    }

    if (results[2].status === 'fulfilled') {
      setStats(results[2].value || {});
      anyUpdate = true;
    } else if (results[2].reason?.name !== 'AbortError') {
      console.error('Stats API error:', results[2].reason);
    }

    if (results[3].status === 'fulfilled') {
      setLegal(results[3].value || null);
      anyUpdate = true;
    } else if (results[3].reason?.name !== 'AbortError') {
      console.error('Legal API error:', results[3].reason);
    }

    if (results[4].status === 'fulfilled') {
      setPrivacy(results[4].value || null);
      anyUpdate = true;
    } else if (results[4].reason?.name !== 'AbortError') {
      console.error('Privacy API error:', results[4].reason);
    }

    const nonAbortFailures = results.filter(
      (result) => result.status === 'rejected' && result.reason?.name !== 'AbortError',
    ).length;

    if (!anyUpdate && nonAbortFailures > 0) {
      console.error('API error: all endpoint requests failed.');
    }

    if (mountedRef.current) {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (currentPage === 'dashboard') {
      setLoading(false);
      return () => {};
    }

    mountedRef.current = true;
    let activeController = null;

    const runFetch = async () => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;

      const controller = new AbortController();
      activeController = controller;
      try {
        await fetchData(controller.signal);
      } catch (err) {
        if (err?.name !== 'AbortError') {
          console.error('Unhandled fetch loop error:', err);
        }
      } finally {
        inFlightRef.current = false;
        if (activeController === controller) {
          activeController = null;
        }
      }
    };

    runFetch();
    const interval = setInterval(runFetch, 15000);

    return () => {
      mountedRef.current = false;
      inFlightRef.current = false;
      clearInterval(interval);
      if (activeController) {
        activeController.abort();
      }
    };
  }, [fetchData]);

  if (currentPage === 'imprint') {
    return (
      <div data-testid="app-root" style={{ position: 'relative', minHeight: '100vh' }}>
        <div className="noise-overlay" />
        <Navbar page={currentPage} />
        <ImpressumSection legal={legal} standalone />
        <StatsFooter stats={stats} bots={bots} />
      </div>
    );
  }

  if (currentPage === 'privacy') {
    return (
      <div data-testid="app-root" style={{ position: 'relative', minHeight: '100vh' }}>
        <div className="noise-overlay" />
        <Navbar page={currentPage} />
        <PrivacySection legal={legal} privacy={privacy} standalone />
        <StatsFooter stats={stats} bots={bots} />
      </div>
    );
  }

  if (currentPage === 'dashboard') {
    return (
      <div data-testid="app-dashboard-root" style={{ position: 'relative', minHeight: '100vh' }}>
        <DashboardPortal />
      </div>
    );
  }

  return (
    <div data-testid="app-root" style={{ position: 'relative', minHeight: '100vh' }}>
      <div className="noise-overlay" />
      <Navbar page={currentPage} />
      <Hero stats={stats} bots={bots} />
      <TrustBar stats={stats} />
      <Features />
      <WhyOmniFM />
      <DashboardShowcase />
      <StationBrowser stations={stations} loading={loading} />
      <Premium bots={bots} />
      <FaqSection />
      <StatsFooter stats={stats} bots={bots} />
    </div>
  );
}

function App() {
  return (
    <I18nProvider>
      <AppContent />
    </I18nProvider>
  );
}

export default App;
