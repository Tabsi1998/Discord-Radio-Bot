import React, { useState, useEffect, useCallback, useRef } from 'react';
import Hero from './components/Hero';
import BotDirectory from './components/BotDirectory';
import WorkerDashboard from './components/WorkerDashboard';
import Features from './components/Features';
import StationBrowser from './components/StationBrowser';
import Commands from './components/Commands';
import Premium from './components/Premium';
import StatsFooter from './components/StatsFooter';
import Navbar from './components/Navbar';

const API_BASE = (process.env.REACT_APP_BACKEND_URL || '').replace(/\/+$/, '');

function buildApiUrl(path) {
  return `${API_BASE}${path}`;
}

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

function App() {
  const [bots, setBots] = useState([]);
  const [stations, setStations] = useState([]);
  const [stats, setStats] = useState({});
  const [commands, setCommands] = useState([]);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);
  const inFlightRef = useRef(false);

  const fetchData = useCallback(async (signal) => {
    const endpoints = [
      '/api/bots',
      '/api/stations',
      '/api/stats',
      '/api/commands',
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
      setCommands(results[3].value?.commands || []);
      anyUpdate = true;
    } else if (results[3].reason?.name !== 'AbortError') {
      console.error('Commands API error:', results[3].reason);
    }

    if (!anyUpdate) {
      console.error('API error: all endpoint requests failed.');
    }

    if (mountedRef.current) {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
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

  return (
    <div data-testid="app-root" style={{ position: 'relative', minHeight: '100vh' }}>
      <div className="noise-overlay" />
      <Navbar />
      <Hero stats={stats} />
      <BotDirectory bots={bots} loading={loading} />
      <WorkerDashboard />
      <Features />
      <StationBrowser stations={stations} loading={loading} />
      <Commands commands={commands} loading={loading} />
      <Premium />
      <StatsFooter stats={stats} />
    </div>
  );
}

export default App;
