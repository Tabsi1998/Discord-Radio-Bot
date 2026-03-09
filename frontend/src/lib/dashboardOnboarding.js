export function resolveDashboardInviteUrls(inviteLinks) {
  const inviteBots = Array.isArray(inviteLinks?.bots) ? inviteLinks.bots : [];
  return {
    commanderInviteUrl: inviteBots.find((bot) => String(bot?.role || '').trim().toLowerCase() === 'commander' && bot?.inviteUrl)?.inviteUrl || '',
    workerInviteUrl: inviteBots.find((bot) => String(bot?.role || '').trim().toLowerCase() !== 'commander' && bot?.inviteUrl)?.inviteUrl || '',
  };
}

export function buildDashboardNextSetupAction({ setupStatus, inviteLinks, t }) {
  if (!setupStatus) return null;
  const { commanderInviteUrl, workerInviteUrl } = resolveDashboardInviteUrls(inviteLinks);

  if (!setupStatus.commanderReady) {
    return {
      eyebrow: t('Naechste Aktion', 'Next action'),
      title: t('Commander zuerst verbinden', 'Connect the commander first'),
      body: t(
        'Ohne den Hauptbot kann OmniFM diesen Server noch nicht sauber steuern.',
        'Without the main bot, OmniFM cannot manage this server cleanly yet.'
      ),
      inviteLabel: t('Commander einladen', 'Invite commander'),
      inviteUrl: commanderInviteUrl,
      command: '/setup',
    };
  }

  if (!setupStatus.workerInvited) {
    return {
      eyebrow: t('Naechste Aktion', 'Next action'),
      title: t('Naechster Schritt: ersten Worker einladen', 'Next step: invite the first worker'),
      body: t(
        'Sobald mindestens ein Worker auf dem Server ist, kann /play den eigentlichen Stream starten.',
        'As soon as at least one worker is on the server, /play can start the actual stream.'
      ),
      inviteLabel: t('Worker einladen', 'Invite worker'),
      inviteUrl: workerInviteUrl,
      command: '/workers',
    };
  }

  if (!setupStatus.firstStreamLive) {
    return {
      eyebrow: t('Naechste Aktion', 'Next action'),
      title: t('Naechster Schritt: ersten Stream starten', 'Next step: start the first stream'),
      body: t(
        'Die Bot-Architektur ist bereit. Starte jetzt in Discord den ersten Sender mit /play.',
        'The bot setup is ready. Start the first station in Discord with /play now.'
      ),
      command: '/play',
    };
  }

  return {
    eyebrow: t('Naechste Aktion', 'Next action'),
    title: t('Setup abgeschlossen', 'Setup completed'),
    body: t(
      'Dieser Server ist startklar. Danach lohnen sich je nach Bedarf Events, Rechte und weitere Worker.',
      'This server is ready. From here, events, permissions, and more workers are the next useful upgrades.'
    ),
    command: '/setup',
  };
}

export function buildDashboardEventsHint({ setupStatus, inviteLinks, hasEvents, voiceChannelCount, t }) {
  if (hasEvents) return null;
  const { workerInviteUrl } = resolveDashboardInviteUrls(inviteLinks);

  if (!setupStatus?.workerInvited) {
    return {
      eyebrow: t('Events vorbereiten', 'Prepare events'),
      title: t('Vor dem ersten Event zuerst einen Worker einladen', 'Invite a worker before the first event'),
      body: t(
        'Geplante Events starten spaeter automatisch Radio. Dafuer muss mindestens ein Worker bereits auf diesem Server verfuegbar sein.',
        'Scheduled events start radio automatically later on. For that, at least one worker already needs to be available on this server.'
      ),
      inviteLabel: t('Worker einladen', 'Invite worker'),
      inviteUrl: workerInviteUrl,
      command: '/workers',
    };
  }

  if (Number(voiceChannelCount || 0) <= 0) {
    return {
      eyebrow: t('Events vorbereiten', 'Prepare events'),
      title: t('Es fehlt noch ein Ziel-Channel fuer Events', 'A target channel for events is still missing'),
      body: t(
        'Lege in Discord zuerst einen Voice- oder Stage-Channel an. Danach kann OmniFM das Event direkt dort starten.',
        'Create a voice or stage channel in Discord first. After that, OmniFM can start the event directly there.'
      ),
      command: '/setup',
      note: t(
        'Sobald der Channel sichtbar ist, kannst du darunter direkt dein erstes Event anlegen.',
        'As soon as the channel is visible, you can create your first event right below.'
      ),
    };
  }

  return {
    eyebrow: t('Events vorbereiten', 'Prepare events'),
    title: t('Lege dein erstes automatisches Radio-Event an', 'Create your first automated radio event'),
    body: t(
      'Waehle einen Sender, eine Startzeit und den Ziel-Channel. Die Presets unten helfen fuer schnelle Weekly- oder One-Time-Shows.',
      'Choose a station, a start time, and the target channel. The presets below help with quick weekly or one-time shows.'
    ),
    note: t(
      'Typischer Start: erst ein einmaliges Test-Event, danach ein Weekly-Preset.',
      'Typical start: first a one-time test event, then a weekly preset.'
    ),
  };
}

export function buildDashboardCustomStationsHint({ setupStatus, inviteLinks, hasStations, t }) {
  if (hasStations) return null;
  const { workerInviteUrl } = resolveDashboardInviteUrls(inviteLinks);

  if (!setupStatus?.workerInvited) {
    return {
      eyebrow: t('Custom-Streams vorbereiten', 'Prepare custom streams'),
      title: t('Schliesse zuerst das Grundsetup ab', 'Finish the core setup first'),
      body: t(
        'Custom-Stationen lohnen sich am meisten, wenn der normale OmniFM-Flow bereits mit einem Worker laeuft.',
        'Custom stations are most useful once the normal OmniFM flow already runs with a worker.'
      ),
      inviteLabel: t('Worker einladen', 'Invite worker'),
      inviteUrl: workerInviteUrl,
      command: '/workers',
    };
  }

  if (!setupStatus?.firstStreamLive) {
    return {
      eyebrow: t('Custom-Streams vorbereiten', 'Prepare custom streams'),
      title: t('Teste zuerst einen normalen Live-Stream', 'Test a normal live stream first'),
      body: t(
        'Wenn /play bereits sauber funktioniert, lassen sich eigene Stream-URLs spaeter leichter pruefen und einordnen.',
        'Once /play works cleanly, your own stream URLs become much easier to verify and organize.'
      ),
      command: '/play',
      note: t(
        'Danach kannst du hier eigene URLs mit Ordnern und Tags strukturieren.',
        'After that, you can organize your own URLs here with folders and tags.'
      ),
    };
  }

  return {
    eyebrow: t('Custom-Streams vorbereiten', 'Prepare custom streams'),
    title: t('Fuege deine erste eigene Stream-URL hinzu', 'Add your first own stream URL'),
    body: t(
      'Lege einen stabilen Namen, eine HTTPS-URL und bei Bedarf Ordner oder Tags fest. So wird aus Ultimate ein echter Operator-Workspace.',
      'Add a stable name, an HTTPS URL, and optional folders or tags. That turns Ultimate into a real operator workspace.'
    ),
    note: t(
      'Nutze Ordner fuer Quellen oder Formate und Tags fuer Themen wie news, club oder chill.',
      'Use folders for sources or formats and tags for topics like news, club, or chill.'
    ),
  };
}

export function buildDashboardPermissionsHint({ setupStatus, availableRoleCount, hasRestrictedCommands, t }) {
  if (Number(availableRoleCount || 0) <= 0) {
    if (!setupStatus?.commanderReady) {
      return {
        eyebrow: t('Berechtigungen vorbereiten', 'Prepare permissions'),
        title: t('Verbinde zuerst den Commander mit diesem Server', 'Connect the commander to this server first'),
        body: t(
          'Ohne den Hauptbot koennen Discord-Rollen hier noch nicht sauber geladen und zugeordnet werden.',
          'Without the main bot, Discord roles cannot be loaded and assigned cleanly here yet.'
        ),
        command: '/setup',
      };
    }

    return {
      eyebrow: t('Berechtigungen vorbereiten', 'Prepare permissions'),
      title: t('Discord-Rollen sind gerade noch nicht verfuegbar', 'Discord roles are not available yet'),
      body: t(
        'OmniFM konnte fuer diesen Server noch keine Rollen laden. Pruefe kurz, ob der Bot verbunden ist und Discord die Rollenliste liefert.',
        'OmniFM could not load roles for this server yet. Check whether the bot is connected and Discord returns the role list.'
      ),
      command: '/setup',
      note: t(
        'Sobald Rollen geladen sind, kannst du unten /play, /stop oder /event gezielt absichern.',
        'As soon as roles are loaded, you can protect /play, /stop, or /event below.'
      ),
    };
  }

  if (!hasRestrictedCommands) {
    return {
      eyebrow: t('Berechtigungen vorbereiten', 'Prepare permissions'),
      title: t('Commands sind aktuell noch fuer alle offen', 'Commands are currently open to everyone'),
      body: t(
        'Ein sauberer Start ist meist: /play, /stop und /event nur fuer DJ- oder Admin-Rollen freigeben.',
        'A clean starting point is usually to allow /play, /stop, and /event only for DJ or admin roles.'
      ),
      note: t(
        'OmniFM blockiert hier nichts automatisch. Du entscheidest pro Command, welche Rollen wirklich duerfen.',
        'OmniFM does not block anything automatically here. You decide per command which roles are actually allowed.'
      ),
    };
  }

  return null;
}
