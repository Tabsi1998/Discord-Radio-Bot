import React, { useState, useEffect } from 'react';
import { Radio, Menu, X } from 'lucide-react';

const navLinks = [
  { label: 'Bots', href: '#bots' },
  { label: 'Features', href: '#features' },
  { label: 'Stations', href: '#stations' },
  { label: 'Commands', href: '#commands' },
  { label: 'Premium', href: '#premium' },
];

function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <nav
      data-testid="navbar"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 50,
        padding: '0 24px',
        height: 64,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: scrolled ? 'rgba(5, 5, 5, 0.85)' : 'transparent',
        backdropFilter: scrolled ? 'blur(20px)' : 'none',
        WebkitBackdropFilter: scrolled ? 'blur(20px)' : 'none',
        borderBottom: scrolled ? '1px solid rgba(255,255,255,0.06)' : '1px solid transparent',
        transition: 'background 0.3s, border-color 0.3s, backdrop-filter 0.3s',
      }}
    >
      <a
        href="#top"
        data-testid="nav-logo"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          textDecoration: 'none',
          color: '#fff',
        }}
      >
        <Radio size={22} color="#00F0FF" />
        <span
          style={{
            fontFamily: "'Orbitron', sans-serif",
            fontWeight: 700,
            fontSize: 16,
            letterSpacing: '0.05em',
          }}
        >
          RADIO<span style={{ color: '#00F0FF' }}>BOT</span>
        </span>
      </a>

      {/* Desktop Links */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 32,
        }}
        className="nav-desktop"
      >
        {navLinks.map((l) => (
          <a
            key={l.href}
            href={l.href}
            data-testid={`nav-link-${l.label.toLowerCase()}`}
            style={{
              color: '#A1A1AA',
              textDecoration: 'none',
              fontSize: 14,
              fontWeight: 500,
              letterSpacing: '0.02em',
              transition: 'color 0.2s',
            }}
            onMouseEnter={(e) => (e.target.style.color = '#fff')}
            onMouseLeave={(e) => (e.target.style.color = '#A1A1AA')}
          >
            {l.label}
          </a>
        ))}
      </div>

      {/* Mobile toggle */}
      <button
        data-testid="nav-mobile-toggle"
        onClick={() => setOpen(!open)}
        style={{
          display: 'none',
          background: 'none',
          border: 'none',
          color: '#fff',
          cursor: 'pointer',
          padding: 4,
        }}
        className="nav-mobile-btn"
      >
        {open ? <X size={24} /> : <Menu size={24} />}
      </button>

      {/* Mobile menu */}
      {open && (
        <div
          data-testid="nav-mobile-menu"
          style={{
            position: 'fixed',
            top: 64,
            left: 0,
            right: 0,
            background: 'rgba(5, 5, 5, 0.95)',
            backdropFilter: 'blur(20px)',
            borderBottom: '1px solid rgba(255,255,255,0.08)',
            padding: '16px 24px',
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}
        >
          {navLinks.map((l) => (
            <a
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              style={{
                color: '#A1A1AA',
                textDecoration: 'none',
                fontSize: 16,
                fontWeight: 500,
              }}
            >
              {l.label}
            </a>
          ))}
        </div>
      )}

      <style>{`
        @media (max-width: 768px) {
          .nav-desktop { display: none !important; }
          .nav-mobile-btn { display: block !important; }
        }
      `}</style>
    </nav>
  );
}

export default Navbar;
