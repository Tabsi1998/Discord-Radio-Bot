const formatter = new Intl.NumberFormat("de-DE");

const toneClasses = [
  "tone-1",
  "tone-2",
  "tone-3",
  "tone-4",
  "tone-5",
  "tone-6",
  "tone-7",
  "tone-8",
  "tone-9",
  "tone-10",
  "tone-11",
  "tone-12"
];

function formatInt(value) {
  const num = Number(value) || 0;
  return formatter.format(num);
}

function formatUptime(seconds) {
  const sec = Math.max(0, Number(seconds) || 0);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function renderSummary(totals) {
  document.getElementById("sumServers").textContent = formatInt(totals?.servers);
  document.getElementById("sumUsers").textContent = formatInt(totals?.users);
  document.getElementById("sumConnections").textContent = formatInt(totals?.connections);
  document.getElementById("sumListeners").textContent = formatInt(totals?.listeners);
}

function renderBots(bots) {
  const grid = document.getElementById("botGrid");
  const tpl = document.getElementById("botCardTemplate");
  grid.innerHTML = "";

  if (!Array.isArray(bots) || bots.length === 0) {
    grid.innerHTML = "<p>Keine Bot-Konfiguration gefunden.</p>";
    return;
  }

  bots.forEach((bot, index) => {
    const node = tpl.content.firstElementChild.cloneNode(true);
    const tone = toneClasses[index % toneClasses.length];
    node.classList.add(tone);

    const icon = node.querySelector(".bot-icon");
    icon.textContent = (bot.name || "B").slice(0, 1).toUpperCase();

    node.querySelector(".bot-name").textContent = bot.name || "Bot";
    node.querySelector(".servers").textContent = formatInt(bot.servers);
    node.querySelector(".users").textContent = formatInt(bot.users);
    node.querySelector(".connections").textContent = formatInt(bot.connections);
    node.querySelector(".listeners").textContent = formatInt(bot.listeners);
    node.querySelector(".user").textContent = bot.userTag || "-";
    node.querySelector(".uptime").textContent = formatUptime(bot.uptimeSec);

    const invite = node.querySelector(".invite-btn");
    invite.href = bot.inviteUrl;

    const copy = node.querySelector(".copy-btn");
    copy.addEventListener("click", async () => {
      const ok = await copyToClipboard(bot.inviteUrl);
      copy.textContent = ok ? "COPIED" : "ERROR";
      setTimeout(() => {
        copy.textContent = "COPY";
      }, 1200);
    });

    grid.appendChild(node);
  });
}

function renderStations(payload) {
  const box = document.getElementById("stationsBox");
  const lines = [];
  lines.push(`Default: ${payload.defaultStationKey || "-"}`);
  lines.push(`Quality: ${payload.qualityPreset || "custom"}`);
  lines.push(`Anzahl: ${payload.total || 0}`);
  lines.push("");

  const stations = Array.isArray(payload.stations) ? payload.stations : [];
  if (stations.length === 0) {
    lines.push("Keine Stationen konfiguriert. Nutze: bash ./stations.sh wizard");
  } else {
    for (const station of stations.slice(0, 16)) {
      lines.push(`- ${station.name} (${station.key})`);
    }
    if (stations.length > 16) {
      lines.push(`... und ${stations.length - 16} weitere`);
    }
  }

  box.textContent = lines.join("\n");
}

function renderHealth(health) {
  const dot = document.querySelector(".dot");
  const text = document.getElementById("healthText");
  const ok = Boolean(health?.ok);

  dot.classList.remove("ok", "err");
  dot.classList.add(ok ? "ok" : "err");
  text.textContent = ok
    ? `Backend online | Bots bereit: ${health.readyBots}/${health.bots} | Uptime: ${formatUptime(health.uptimeSec)}`
    : "Backend nicht erreichbar";
}

async function fetchJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`${url} -> ${res.status}`);
  }
  return res.json();
}

async function refresh() {
  try {
    const [botsRes, stationsRes, healthRes] = await Promise.all([
      fetchJson("/api/bots"),
      fetchJson("/api/stations"),
      fetchJson("/api/health")
    ]);

    renderSummary(botsRes.totals || {});
    renderBots(botsRes.bots || []);
    renderStations(stationsRes);
    renderHealth(healthRes);
  } catch {
    renderHealth({ ok: false });
  }
}

refresh();
setInterval(refresh, 10_000);
