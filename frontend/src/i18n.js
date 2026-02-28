import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

const STORAGE_KEY = 'omnifm.web.locale';
const DEFAULT_LOCALE = 'de';
const SUPPORTED_LOCALES = ['de', 'en'];

const LOCALE_META = {
  de: {
    label: 'DE',
    switchLabel: 'EN',
    switchTitle: 'Switch to English',
    intl: 'de-DE',
  },
  en: {
    label: 'EN',
    switchLabel: 'DE',
    switchTitle: 'Auf Deutsch umschalten',
    intl: 'en-US',
  },
};

const LOCALE_MESSAGES = {
  de: {
    meta: {
      title: 'OmniFM | 24/7 Radio fuer Discord',
      description: 'OmniFM bringt 24/7 Radio-Streams, Worker-Bots und Premium-Audio auf deinen Discord-Server.',
    },
    navbar: {
      links: [
        { key: 'features', label: 'Features', href: '#features' },
        { key: 'workers', label: 'Workers', href: '#workers' },
        { key: 'bots', label: 'Bots', href: '#bots' },
        { key: 'stations', label: 'Stationen', href: '#stations' },
        { key: 'commands', label: 'Commands', href: '#commands' },
        { key: 'premium', label: 'Premium', href: '#premium' },
      ],
      discord: 'Discord Community',
      language: 'Sprache',
    },
    hero: {
      badge: 'OmniFM Radio Network',
      titleLead: 'Dein Discord',
      titleAccent: 'Radio.',
      titleTail: '24/7 Live.',
      subtitleLead: 'Ein Commander-Bot steuert, Worker-Bots streamen. 120+ Radiosender, Opus-Audio, Auto-Reconnect. Lade den Bot ein und',
      subtitleTail: 'druecken.',
      ctaInvite: 'Bot einladen',
      ctaFlow: 'Wie es funktioniert',
      stats: {
        servers: 'Server',
        stations: 'Stationen',
        bots: 'Bots',
      },
    },
    features: {
      eyebrow: 'So funktioniert es',
      title: 'In 3 Schritten zum Radio',
      steps: [
        {
          step: '01',
          title: 'Bot einladen',
          desc: 'Lade den OmniFM DJ-Bot auf deinen Discord-Server ein. Er steuert das gesamte Setup.',
        },
        {
          step: '02',
          title: 'Station waehlen',
          desc: 'Nutze /play und waehle aus Free-, Pro- oder Ultimate-Stationen. Ein freier Worker uebernimmt den Stream.',
        },
        {
          step: '03',
          title: 'Musik geniessen',
          desc: '24/7 Streaming in deinem Voice-Channel. Fuer mehr parallele Streams kannst du weitere Worker zuschalten.',
        },
      ],
      architecture: {
        commander: 'Commander',
        commanderDesc: 'Nimmt Befehle entgegen',
        workers: 'Worker 1-16',
        workersDesc: 'Streamen die Musik',
        channel: 'Dein Channel',
        channelDesc: '24/7 nonstop Musik',
      },
      gridEyebrow: 'Features',
      gridTitle: 'Gebaut fuer Qualitaet',
      grid: [
        {
          title: '24/7 Streaming',
          desc: 'Nonstop Musik rund um die Uhr. Dein Server schlaeft nie.',
        },
        {
          title: 'Multi-Bot System',
          desc: 'Bis zu 16 Worker-Bots parallel. Jeder Stream bleibt voneinander getrennt.',
        },
        {
          title: 'Slash-Commands',
          desc: 'Kein Prefix noetig. /play, /stats und /event sind sofort einsatzbereit.',
        },
        {
          title: 'HQ Audio',
          desc: 'Opus-Transcoding mit bis zu 320k Bitrate fuer klare, stabile Streams.',
        },
        {
          title: 'Auto-Reconnect',
          desc: 'Faellt eine Verbindung, verbindet sich OmniFM kontrolliert und sauber neu.',
        },
        {
          title: 'Skalierbar',
          desc: 'Weitere Worker und Premium-Tiers lassen sich ohne Architekturbruch ergaenzen.',
        },
      ],
    },
    workers: {
      eyebrow: 'Architektur',
      title: 'Commander / Worker System',
      subtitle: 'Ein Commander-Bot steuert die Befehle, Worker-Bots streamen die Musik. Mehr Worker bedeuten mehr gleichzeitige Streams.',
      tierCards: {
        free: { name: 'Free', maxWorkers: 'Max. Worker-Bots' },
        pro: { name: 'Pro', maxWorkers: 'Max. Worker-Bots' },
        ultimate: { name: 'Ultimate', maxWorkers: 'Max. Worker-Bots' },
      },
      labels: {
        server: 'Server',
        streams: 'Streams',
        workersTotal: 'Worker gesamt',
        workersOnline: 'Worker online',
        activeStreams: 'Aktive Streams',
        commanderServers: 'Commander Server',
      },
      status: {
        online: 'Online',
        offline: 'Offline',
        commander: 'Commander',
        workerPrefix: 'Worker #',
      },
      delegated: 'Delegiert an Worker',
      empty: 'Keine Worker konfiguriert. Lege weitere Worker-Tokens in der .env an (BOT_2_TOKEN, BOT_3_TOKEN, ...).',
      loading: 'Lade Worker-Status...',
    },
    bots: {
      eyebrow: 'Commander Bot',
      title: 'OmniFM einladen',
      subtitleLead: 'Lade den Commander-Bot auf deinen Server ein. Weitere Worker-Bots kannst du per',
      subtitleTail: 'Befehl im Discord hinzufuegen.',
      loading: 'Lade Bot-Infos...',
      empty: 'Noch kein Bot konfiguriert.',
      statsTitle: 'Bot-Statistiken',
      stats: {
        servers: 'Server',
        users: 'Nutzer',
        connections: 'Verbindungen',
        listeners: 'Zuhoerer',
      },
      status: {
        online: 'Online',
        configurable: 'Konfigurierbar',
      },
      actions: {
        invite: 'Einladen',
        copy: 'Link kopieren',
        copied: 'Kopiert',
        required: 'erforderlich',
      },
      workerTiersTitle: 'Worker-Bots pro Tier',
      workerTiers: [
        { tier: 'Free', bots: 'Bot 1-2' },
        { tier: 'Pro', bots: 'Bot 3-8' },
        { tier: 'Ultimate', bots: 'Bot 9-16' },
      ],
      workerHintLead: 'Nutze',
      workerHintTail: 'im Discord, um Worker-Bots einzuladen.',
    },
    stations: {
      eyebrow: 'Live Station Directory',
      title: 'OmniFM Stationen',
      summary: ({ count, free, pro, ultimate }) => `${count} Stationen (${free} Free, ${pro} Pro, ${ultimate} Ultimate). Klicke zum Vorhoeren oder nutze /play im Discord.`,
      nowPlaying: 'Vorschau laeuft',
      searchPlaceholder: 'Station suchen...',
      filters: {
        all: 'Alle',
        free: 'Free',
        pro: 'Pro',
        ultimate: 'Ultimate',
      },
      filterSummary: ({ count, free, pro, ultimate }) => `${count} Stationen (${free} Free, ${pro} Pro, ${ultimate} Ultimate)`,
      loading: 'Lade Stationen...',
      empty: 'Keine Stationen gefunden.',
      loadMore: ({ shown, remaining }) => `Mehr anzeigen (${shown} von ${remaining})`,
      visible: ({ visible, total }) => `${visible} von ${total} Stationen angezeigt`,
      previewVolume: 'Lautstaerke',
      stopPreview: 'Vorschau stoppen',
      tiers: {
        free: 'Free',
        pro: 'Pro',
        ultimate: 'Ultimate',
      },
    },
    commands: {
      eyebrow: 'Slash Commands',
      title: 'Alle Befehle nach Tier',
      subtitle: 'Jedes Tier schaltet weitere Commands frei. Free-Commands sind immer verfuegbar.',
      countLabel: ({ count }) => `${count} Commands`,
      loading: 'Lade Commands...',
      empty: 'Keine Commands verfuegbar.',
      descriptionMap: {
        help: 'Zeigt alle Befehle und kurze Erklaerungen.',
        play: 'Startet einen Radio-Stream in deinem Voice-Channel.',
        pause: 'Pausiert die aktuelle Wiedergabe.',
        resume: 'Setzt die aktuelle Wiedergabe fort.',
        stop: 'Stoppt die Wiedergabe und verlaesst den Channel.',
        stations: 'Zeigt alle fuer deinen Plan verfuegbaren Stationen.',
        list: 'Listet Stationen paginiert auf.',
        setvolume: 'Setzt die Lautstaerke des Streams.',
        status: 'Zeigt Bot-Status und Uptime an.',
        health: 'Zeigt Stream-Health und Reconnect-Informationen.',
        diag: 'Zeigt Audio-, FFmpeg- und Stream-Diagnosen.',
        premium: 'Zeigt den Premium-Status deines Servers.',
        language: 'Verwaltet die Sprache fuer diesen Server.',
        license: 'Aktiviert oder zeigt Lizenzdaten an.',
        invite: 'Zeigt Invite-Links fuer verfuegbare Worker-Bots.',
        workers: 'Zeigt das Commander-/Worker-Setup.',
        now: 'Zeigt den aktuell erkannten Titel.',
        stats: 'Zeigt Hoer- und Nutzungsstatistiken fuer diesen Server.',
        history: 'Zeigt die zuletzt erkannten Songs.',
        event: 'Verwaltet geplante Auto-Start-Events.',
        perm: 'Verwaltet rollenbasierte Command-Berechtigungen.',
        addstation: 'Fuegt eine eigene Station hinzu.',
        removestation: 'Entfernt eine eigene Station.',
        mystations: 'Zeigt deine eigenen Stationen.',
      },
    },
    premium: {
      eyebrow: 'Premium',
      title: 'Upgrade dein Setup',
      subtitle: 'Mehr Worker, mehr Stationen, besserer Sound. Waehle den Plan, der zu deinem Server passt.',
      pricingFallback: 'Pricing-API nicht erreichbar, Fallback-Daten aktiv.',
      planPopular: 'Beliebt',
      perMonth: '/Monat',
      buy: ({ name }) => `${name} kaufen`,
      trialCta: ({ months }) => `${months} Monat${months === 1 ? '' : 'e'} kostenlos testen`,
      trialActivated: 'Pro-Testmonat aktiviert.',
      emailLabel: 'E-Mail Adresse',
      emailHint: 'Dein Lizenz-Key und die Rechnung werden an diese Adresse gesendet.',
      emailPlaceholder: 'deine@email.de',
      couponLabel: 'Rabattcode (optional)',
      couponPlaceholder: 'z.B. PRO10',
      referralLabel: 'Referral-Code (optional)',
      referralPlaceholder: 'z.B. CREATOR10',
      referralHint: 'Referral-Links koennen den Code automatisch vorbelegen.',
      seatsLabel: 'Anzahl Server',
      seatsSuffix: 'Server',
      seatsMonthly: ({ amount }) => `${amount}/Monat`,
      seatsHint: 'Lizenziere mehrere Server mit einem Abo. Hoehere Bundles senken den Preis pro Server.',
      durationLabel: 'Laufzeit waehlen',
      durationMonth: 'Monat',
      durationMonths: 'Monate',
      durationBonus: '+2 gratis',
      bestValue: 'Best',
      summary: ({ durationLabel, seatsLabel }) => `${durationLabel}${seatsLabel ? ` · ${seatsLabel}` : ''}`,
      licenseHintLead: 'Nach dem Kauf erhaeltst du deinen',
      licenseHintKey: 'Lizenz-Key',
      licenseHintMiddle: 'per E-Mail. Nutze',
      licenseHintCommand: '/license activate',
      licenseHintTail: 'im Discord, um deinen Server zu verknuepfen.',
      checkoutRedirect: 'Weiterleitung...',
      payButton: ({ amount }) => `${amount} bezahlen`,
      cancel: 'Abbrechen',
      checkoutTitle: ({ name }) => `OmniFM ${name}`,
      invalidEmail: 'Bitte eine gueltige E-Mail-Adresse eingeben.',
      checkoutFailed: 'Checkout fehlgeschlagen. Bitte spaeter erneut versuchen.',
      checkoutUrlMissing: 'Keine Checkout-URL erhalten.',
      trialFailed: 'Testmonat konnte nicht aktiviert werden. Bitte spaeter erneut versuchen.',
      trialWorking: 'Testmonat wird aktiviert...',
      trialActivatedDefault: 'Pro-Testmonat aktiviert.',
      statusTitle: 'Premium-Status pruefen',
      serverIdPlaceholder: 'Discord Server ID',
      serverIdInvalid: 'Server-ID muss 17-22 Ziffern haben.',
      checkLoading: 'Pruefe...',
      checkButton: 'Pruefen',
      checkFailed: 'Premium-Status konnte nicht geladen werden.',
      statusResult: ({ tier, bitrate, days, expires }) => `Tier: ${tier} | Bitrate: ${bitrate} | Resttage: ${days} | Ablauf: ${expires}`,
      priceFrom: 'ab',
      freePrice: '0 EUR',
      monthLabel: ({ count }) => count === 1 ? '1 Monat' : `${count} Monate`,
      seatsLabelInline: ({ count }) => count === 1 ? '1 Server' : `${count} Server`,
      fallbackFeatures: {
        free: ['Bis zu 2 Bots', '20 Free Stationen', 'Standard Audio (64k)', 'Standard Reconnect'],
        pro: ['Bis zu 8 Bots', '120 Stationen (Free + Pro)', 'HQ Audio (128k Opus)', 'Priority Reconnect', 'Rollenbasierte Berechtigungen', 'Event-Scheduler'],
        ultimate: ['Bis zu 16 Bots', 'Alle Stationen + Custom URLs', 'Ultra HQ Audio (320k)', 'Instant Reconnect', 'Rollenbasierte Berechtigungen'],
      },
    },
    footer: {
      stats: {
        servers: 'Server',
        users: 'Nutzer',
        connections: 'Verbindungen',
        listeners: 'Zuhoerer',
        bots: 'Bots',
        stations: 'Stationen',
      },
      builtWith: 'Gebaut mit',
      forDiscord: 'fuer Discord',
      discord: 'Discord Community',
    },
  },
  en: {
    meta: {
      title: 'OmniFM | 24/7 Radio for Discord',
      description: 'OmniFM brings 24/7 radio streams, worker bots, and premium audio to your Discord server.',
    },
    navbar: {
      links: [
        { key: 'features', label: 'Features', href: '#features' },
        { key: 'workers', label: 'Workers', href: '#workers' },
        { key: 'bots', label: 'Bots', href: '#bots' },
        { key: 'stations', label: 'Stations', href: '#stations' },
        { key: 'commands', label: 'Commands', href: '#commands' },
        { key: 'premium', label: 'Premium', href: '#premium' },
      ],
      discord: 'Discord Community',
      language: 'Language',
    },
    hero: {
      badge: 'OmniFM Radio Network',
      titleLead: 'Your Discord',
      titleAccent: 'Radio.',
      titleTail: '24/7 Live.',
      subtitleLead: 'One commander bot coordinates everything while worker bots carry the streams. 120+ stations, Opus audio, auto-reconnect. Invite the bot and press',
      subtitleTail: '.',
      ctaInvite: 'Invite bot',
      ctaFlow: 'How it works',
      stats: {
        servers: 'Servers',
        stations: 'Stations',
        bots: 'Bots',
      },
    },
    features: {
      eyebrow: 'How it works',
      title: 'Radio in 3 steps',
      steps: [
        {
          step: '01',
          title: 'Invite the bot',
          desc: 'Invite the OmniFM DJ bot to your Discord server. It coordinates the full setup.',
        },
        {
          step: '02',
          title: 'Pick a station',
          desc: 'Use /play and choose from free, pro, or ultimate stations. A free worker takes over the stream.',
        },
        {
          step: '03',
          title: 'Enjoy the music',
          desc: 'Keep a voice channel running 24/7. Add more workers whenever you need more parallel streams.',
        },
      ],
      architecture: {
        commander: 'Commander',
        commanderDesc: 'Receives commands',
        workers: 'Workers 1-16',
        workersDesc: 'Stream the audio',
        channel: 'Your channel',
        channelDesc: '24/7 nonstop radio',
      },
      gridEyebrow: 'Features',
      gridTitle: 'Built for quality',
      grid: [
        {
          title: '24/7 streaming',
          desc: 'Nonstop music around the clock so your server never falls silent.',
        },
        {
          title: 'Multi-bot system',
          desc: 'Up to 16 workers in parallel with isolated streams and clean handoff.',
        },
        {
          title: 'Slash commands',
          desc: 'No prefix required. /play, /stats, and /event are ready immediately.',
        },
        {
          title: 'HQ audio',
          desc: 'Opus transcoding up to 320k bitrate for stable, clear playback.',
        },
        {
          title: 'Auto-reconnect',
          desc: 'If a connection drops, OmniFM reconnects in a controlled way.',
        },
        {
          title: 'Scalable',
          desc: 'Add more workers and higher tiers without changing the underlying setup.',
        },
      ],
    },
    workers: {
      eyebrow: 'Architecture',
      title: 'Commander / Worker System',
      subtitle: 'One commander bot handles commands while worker bots deliver the streams. More workers mean more simultaneous channels.',
      tierCards: {
        free: { name: 'Free', maxWorkers: 'Max worker bots' },
        pro: { name: 'Pro', maxWorkers: 'Max worker bots' },
        ultimate: { name: 'Ultimate', maxWorkers: 'Max worker bots' },
      },
      labels: {
        server: 'Servers',
        streams: 'Streams',
        workersTotal: 'Workers total',
        workersOnline: 'Workers online',
        activeStreams: 'Active streams',
        commanderServers: 'Commander servers',
      },
      status: {
        online: 'Online',
        offline: 'Offline',
        commander: 'Commander',
        workerPrefix: 'Worker #',
      },
      delegated: 'Delegated to workers',
      empty: 'No workers configured yet. Add more worker tokens in your .env file (BOT_2_TOKEN, BOT_3_TOKEN, ...).',
      loading: 'Loading worker status...',
    },
    bots: {
      eyebrow: 'Commander Bot',
      title: 'Invite OmniFM',
      subtitleLead: 'Invite the commander bot to your server. You can add extra worker bots with the',
      subtitleTail: 'command in Discord.',
      loading: 'Loading bot details...',
      empty: 'No bot configured yet.',
      statsTitle: 'Bot stats',
      stats: {
        servers: 'Servers',
        users: 'Users',
        connections: 'Connections',
        listeners: 'Listeners',
      },
      status: {
        online: 'Online',
        configurable: 'Configurable',
      },
      actions: {
        invite: 'Invite',
        copy: 'Copy link',
        copied: 'Copied',
        required: 'required',
      },
      workerTiersTitle: 'Worker bots by tier',
      workerTiers: [
        { tier: 'Free', bots: 'Bot 1-2' },
        { tier: 'Pro', bots: 'Bot 3-8' },
        { tier: 'Ultimate', bots: 'Bot 9-16' },
      ],
      workerHintLead: 'Use',
      workerHintTail: 'in Discord to invite worker bots.',
    },
    stations: {
      eyebrow: 'Live Station Directory',
      title: 'OmniFM Stations',
      summary: ({ count, free, pro, ultimate }) => `${count} stations (${free} free, ${pro} pro, ${ultimate} ultimate). Click to preview or use /play in Discord.`,
      nowPlaying: 'Preview is playing',
      searchPlaceholder: 'Search stations...',
      filters: {
        all: 'All',
        free: 'Free',
        pro: 'Pro',
        ultimate: 'Ultimate',
      },
      filterSummary: ({ count, free, pro, ultimate }) => `${count} stations (${free} free, ${pro} pro, ${ultimate} ultimate)`,
      loading: 'Loading stations...',
      empty: 'No stations found.',
      loadMore: ({ shown, remaining }) => `Show more (${shown} of ${remaining})`,
      visible: ({ visible, total }) => `Showing ${visible} of ${total} stations`,
      previewVolume: 'Volume',
      stopPreview: 'Stop preview',
      tiers: {
        free: 'Free',
        pro: 'Pro',
        ultimate: 'Ultimate',
      },
    },
    commands: {
      eyebrow: 'Slash Commands',
      title: 'Commands by tier',
      subtitle: 'Each tier unlocks more commands. Free commands are always available.',
      countLabel: ({ count }) => `${count} commands`,
      loading: 'Loading commands...',
      empty: 'No commands available.',
      descriptionMap: {
        help: 'Shows all commands and short explanations.',
        play: 'Starts a radio stream in your current voice channel.',
        pause: 'Pauses the current playback.',
        resume: 'Resumes the current playback.',
        stop: 'Stops playback and leaves the channel.',
        stations: 'Shows the stations available for your plan.',
        list: 'Lists stations with pagination.',
        setvolume: 'Sets the stream volume.',
        status: 'Shows bot status and uptime.',
        health: 'Shows stream health and reconnect details.',
        diag: 'Shows audio, FFmpeg, and stream diagnostics.',
        premium: 'Shows your server premium status.',
        language: 'Manages the language for this server.',
        license: 'Activates or shows license details.',
        invite: 'Shows invite links for available worker bots.',
        workers: 'Shows the commander/worker setup.',
        now: 'Shows the currently detected track.',
        stats: 'Shows listening and usage stats for this server.',
        history: 'Shows the most recently detected songs.',
        event: 'Manages scheduled auto-start events.',
        perm: 'Manages role-based command permissions.',
        addstation: 'Adds a custom radio station.',
        removestation: 'Removes a custom radio station.',
        mystations: 'Lists your custom stations.',
      },
    },
    premium: {
      eyebrow: 'Premium',
      title: 'Upgrade your setup',
      subtitle: 'More workers, more stations, better audio. Pick the plan that fits your server.',
      pricingFallback: 'Pricing API unreachable, fallback pricing is active.',
      planPopular: 'Popular',
      perMonth: '/month',
      buy: ({ name }) => `Buy ${name}`,
      trialCta: ({ months }) => `Try ${months} month${months === 1 ? '' : 's'} for free`,
      trialActivated: 'Pro trial activated.',
      emailLabel: 'Email address',
      emailHint: 'Your license key and invoice will be sent to this address.',
      emailPlaceholder: 'you@example.com',
      couponLabel: 'Discount code (optional)',
      couponPlaceholder: 'e.g. PRO10',
      referralLabel: 'Referral code (optional)',
      referralPlaceholder: 'e.g. CREATOR10',
      referralHint: 'Referral links can prefill this code automatically.',
      seatsLabel: 'Number of servers',
      seatsSuffix: 'servers',
      seatsMonthly: ({ amount }) => `${amount} / month`,
      seatsHint: 'License multiple servers with one subscription. Larger bundles reduce the cost per server.',
      durationLabel: 'Choose duration',
      durationMonth: 'month',
      durationMonths: 'months',
      durationBonus: '+2 free',
      bestValue: 'Best',
      summary: ({ durationLabel, seatsLabel }) => `${durationLabel}${seatsLabel ? ` · ${seatsLabel}` : ''}`,
      licenseHintLead: 'After purchase you will receive your',
      licenseHintKey: 'license key',
      licenseHintMiddle: 'by email. Use',
      licenseHintCommand: '/license activate',
      licenseHintTail: 'inside Discord to link your server.',
      checkoutRedirect: 'Redirecting...',
      payButton: ({ amount }) => `Pay ${amount}`,
      cancel: 'Cancel',
      checkoutTitle: ({ name }) => `OmniFM ${name}`,
      invalidEmail: 'Please enter a valid email address.',
      checkoutFailed: 'Checkout failed. Please try again later.',
      checkoutUrlMissing: 'No checkout URL was returned.',
      trialFailed: 'The trial could not be activated. Please try again later.',
      trialWorking: 'Activating trial...',
      trialActivatedDefault: 'Pro trial activated.',
      statusTitle: 'Check premium status',
      serverIdPlaceholder: 'Discord server ID',
      serverIdInvalid: 'Server ID must contain 17-22 digits.',
      checkLoading: 'Checking...',
      checkButton: 'Check',
      checkFailed: 'Premium status could not be loaded.',
      statusResult: ({ tier, bitrate, days, expires }) => `Tier: ${tier} | Bitrate: ${bitrate} | Days left: ${days} | Expires: ${expires}`,
      priceFrom: 'from',
      freePrice: '0 EUR',
      monthLabel: ({ count }) => count === 1 ? '1 month' : `${count} months`,
      seatsLabelInline: ({ count }) => count === 1 ? '1 server' : `${count} servers`,
      fallbackFeatures: {
        free: ['Up to 2 bots', '20 free stations', 'Standard audio (64k)', 'Standard reconnect'],
        pro: ['Up to 8 bots', '120 stations (free + pro)', 'HQ audio (128k Opus)', 'Priority reconnect', 'Role-based permissions', 'Event scheduler'],
        ultimate: ['Up to 16 bots', 'All stations + custom URLs', 'Ultra HQ audio (320k)', 'Instant reconnect', 'Role-based permissions'],
      },
    },
    footer: {
      stats: {
        servers: 'Servers',
        users: 'Users',
        connections: 'Connections',
        listeners: 'Listeners',
        bots: 'Bots',
        stations: 'Stations',
      },
      builtWith: 'Built with',
      forDiscord: 'for Discord',
      discord: 'Discord Community',
    },
  },
};

const I18nContext = createContext(null);

function normalizeLocale(rawLocale) {
  const value = String(rawLocale || '').trim().toLowerCase();
  if (!value) return DEFAULT_LOCALE;
  if (value.startsWith('de')) return 'de';
  if (value.startsWith('en')) return 'en';
  return SUPPORTED_LOCALES.includes(value) ? value : DEFAULT_LOCALE;
}

function readStoredLocale() {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return '';
  }
}

function writeStoredLocale(locale) {
  try {
    window.localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // ignore storage failures
  }
}

function readQueryLocale() {
  try {
    const url = new URL(window.location.href);
    return url.searchParams.get('lang') || '';
  } catch {
    return '';
  }
}

function resolveInitialLocale() {
  if (typeof window === 'undefined') return DEFAULT_LOCALE;
  const queryValue = readQueryLocale();
  const queryLocale = normalizeLocale(queryValue);
  if (queryValue) {
    writeStoredLocale(queryLocale);
    return queryLocale;
  }

  const storedValue = readStoredLocale();
  const storedLocale = normalizeLocale(storedValue);
  if (storedValue) return storedLocale;

  const htmlValue = document?.documentElement?.lang || '';
  if (htmlValue) return normalizeLocale(htmlValue);

  return normalizeLocale(window.navigator?.language || DEFAULT_LOCALE);
}

function updateMetaTag(name, content) {
  if (typeof document === 'undefined') return;
  const selector = `meta[name="${name}"]`;
  let tag = document.head.querySelector(selector);
  if (!tag) {
    tag = document.createElement('meta');
    tag.setAttribute('name', name);
    document.head.appendChild(tag);
  }
  tag.setAttribute('content', content);
}

export function I18nProvider({ children }) {
  const [locale, setLocaleState] = useState(resolveInitialLocale);
  const copy = LOCALE_MESSAGES[locale] || LOCALE_MESSAGES[DEFAULT_LOCALE];
  const intlLocale = LOCALE_META[locale]?.intl || LOCALE_META[DEFAULT_LOCALE].intl;

  const setLocale = useCallback((nextLocale) => {
    const normalized = normalizeLocale(nextLocale);
    writeStoredLocale(normalized);
    setLocaleState(normalized);
  }, []);

  const toggleLocale = useCallback(() => {
    setLocale(locale === 'de' ? 'en' : 'de');
  }, [locale, setLocale]);

  const formatNumber = useCallback((value) => {
    const amount = Number(value) || 0;
    return new Intl.NumberFormat(intlLocale).format(amount);
  }, [intlLocale]);

  const formatDecimal = useCallback((value, minimumFractionDigits = 2, maximumFractionDigits = 2) => {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return '-';
    return new Intl.NumberFormat(intlLocale, {
      minimumFractionDigits,
      maximumFractionDigits,
    }).format(amount);
  }, [intlLocale]);

  const formatDate = useCallback((value, options) => {
    if (!value) return '-';
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return new Intl.DateTimeFormat(intlLocale, options).format(date);
  }, [intlLocale]);

  const translateCommandDescription = useCallback((commandName, fallbackText) => {
    const normalizedName = String(commandName || '').replace(/^\//, '').trim().toLowerCase();
    return copy?.commands?.descriptionMap?.[normalizedName] || fallbackText;
  }, [copy]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.lang = locale;
    document.title = copy.meta.title;
    updateMetaTag('description', copy.meta.description);
  }, [copy.meta.description, copy.meta.title, locale]);

  const contextValue = useMemo(() => ({
    locale,
    localeMeta: LOCALE_META[locale] || LOCALE_META[DEFAULT_LOCALE],
    copy,
    setLocale,
    toggleLocale,
    formatNumber,
    formatDecimal,
    formatDate,
    translateCommandDescription,
  }), [
    copy,
    formatDate,
    formatDecimal,
    formatNumber,
    locale,
    setLocale,
    toggleLocale,
    translateCommandDescription,
  ]);

  return (
    <I18nContext.Provider value={contextValue}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  const value = useContext(I18nContext);
  if (!value) {
    throw new Error('useI18n must be used inside I18nProvider');
  }
  return value;
}
