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

function renderBots(bots) {
  const grid = document.getElementById("botGrid");
  const tpl = document.getElementById("botCardTemplate");
  grid.innerHTML = "";

  if (!Array.isArray(bots) || bots.length === 0) {
    grid.innerHTML = "<p>Keine Bot-Konfiguration gefunden.</p>";
    return;
  }

  for (const bot of bots) {
    const node = tpl.content.firstElementChild.cloneNode(true);
    node.querySelector(".bot-name").textContent = bot.name || "Bot";
    node.querySelector(".bot-id").textContent = `Client ID: ${bot.clientId || "-"}`;
    node.querySelector(".ready").textContent = bot.ready ? "online" : "offline";
    node.querySelector(".guilds").textContent = String(bot.guilds ?? 0);
    node.querySelector(".uptime").textContent = formatUptime(bot.uptimeSec);
    node.querySelector(".user").textContent = bot.userTag || "-";

    const invite = node.querySelector(".invite-btn");
    invite.href = bot.inviteUrl;

    const copy = node.querySelector(".copy-btn");
    copy.addEventListener("click", async () => {
      const ok = await copyToClipboard(bot.inviteUrl);
      copy.textContent = ok ? "Kopiert" : "Copy fehlgeschlagen";
      setTimeout(() => {
        copy.textContent = "Link kopieren";
      }, 1300);
    });

    grid.appendChild(node);
  }
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
    for (const station of stations.slice(0, 12)) {
      lines.push(`- ${station.name} (${station.key})`);
    }
    if (stations.length > 12) {
      lines.push(`... und ${stations.length - 12} weitere`);
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
    renderBots(botsRes.bots || []);
    renderStations(stationsRes);
    renderHealth(healthRes);
  } catch {
    renderHealth({ ok: false });
  }
}

refresh();
setInterval(refresh, 10_000);
