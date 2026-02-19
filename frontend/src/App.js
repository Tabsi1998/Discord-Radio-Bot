import React, { useState, useEffect, useCallback } from 'react';
import Hero from './components/Hero';
import BotDirectory from './components/BotDirectory';
import Features from './components/Features';
import StationBrowser from './components/StationBrowser';
import Commands from './components/Commands';
import StatsFooter from './components/StatsFooter';
import Navbar from './components/Navbar';

const API = process.env.REACT_APP_BACKEND_URL;

function App() {
  const [bots, setBots] = useState([]);
  const [stations, setStations] = useState([]);
  const [stats, setStats] = useState({});
  const [commands, setCommands] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const [botsRes, stationsRes, statsRes, cmdsRes] = await Promise.all([
        fetch(`${API}/api/bots`).then(r => r.json()),
        fetch(`${API}/api/stations`).then(r => r.json()),
        fetch(`${API}/api/stats`).then(r => r.json()),
        fetch(`${API}/api/commands`).then(r => r.json()),
      ]);
      setBots(botsRes.bots || []);
      setStations(stationsRes.stations || []);
      setStats(statsRes);
      setCommands(cmdsRes.commands || []);
    } catch (err) {
      console.error('API error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return (
    <div data-testid="app-root" style={{ position: 'relative', minHeight: '100vh' }}>
      <div className="noise-overlay" />
      <Navbar />
      <Hero stats={stats} />
      <BotDirectory bots={bots} loading={loading} />
      <Features />
      <StationBrowser stations={stations} loading={loading} />
      <Commands commands={commands} />
      <StatsFooter stats={stats} />
    </div>
  );
}

export default App;
