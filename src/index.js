import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { Client, GatewayIntentBits } from "discord.js";
import {
  AudioPlayerStatus,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  demuxProbe,
  entersState,
  joinVoiceChannel
} from "@discordjs/voice";
import dotenv from "dotenv";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const stationsPath = path.resolve(__dirname, "..", "stations.json");
const stations = JSON.parse(fs.readFileSync(stationsPath, "utf8"));

const { DISCORD_TOKEN } = process.env;
if (!DISCORD_TOKEN) {
  console.error("Fehlende ENV Variable: DISCORD_TOKEN");
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates]
});

const guildState = new Map();

function getState(guildId) {
  if (!guildState.has(guildId)) {
    const player = createAudioPlayer();
    guildState.set(guildId, {
      player,
      connection: null,
      currentStationKey: null
    });
  }
  return guildState.get(guildId);
}

function resolveStation(key) {
  if (!key) return stations.stations[stations.defaultStationKey] ? stations.defaultStationKey : Object.keys(stations.stations)[0];
  return stations.stations[key] ? key : null;
}

async function createResource(url) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) {
    throw new Error(`Stream konnte nicht geladen werden: ${res.status}`);
  }
  const stream = Readable.fromWeb(res.body);
  const probe = await demuxProbe(stream);
  return createAudioResource(probe.stream, { inputType: probe.type, inlineVolume: true });
}

async function connectToVoice(interaction) {
  const member = interaction.member;
  const channel = member?.voice?.channel;
  if (!channel) {
    await interaction.reply({ content: "Du musst in einem Voice-Channel sein.", ephemeral: true });
    return null;
  }

  const state = getState(interaction.guildId);

  if (state.connection) {
    return state.connection;
  }

  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: channel.guild.id,
    adapterCreator: channel.guild.voiceAdapterCreator
  });

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
  } catch {
    connection.destroy();
    await interaction.reply({ content: "Konnte dem Voice-Channel nicht beitreten.", ephemeral: true });
    return null;
  }

  connection.subscribe(state.player);
  state.connection = connection;

  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5_000)
      ]);
    } catch {
      connection.destroy();
      state.connection = null;
    }
  });

  return connection;
}

client.once("ready", () => {
  console.log(`Eingeloggt als ${client.user.tag}`);
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const state = getState(interaction.guildId);

  if (interaction.commandName === "stations") {
    const list = Object.entries(stations.stations)
      .map(([key, value]) => `• ${value.name} (key: ${key})`)
      .join("\n");
    await interaction.reply({ content: list || "Keine Stationen konfiguriert.", ephemeral: true });
    return;
  }

  if (interaction.commandName === "now") {
    if (!state.currentStationKey) {
      await interaction.reply({ content: "Gerade läuft nichts.", ephemeral: true });
      return;
    }
    const current = stations.stations[state.currentStationKey];
    await interaction.reply({ content: `Aktuell: ${current.name}`, ephemeral: false });
    return;
  }

  if (interaction.commandName === "pause") {
    state.player.pause(true);
    await interaction.reply({ content: "Pausiert.", ephemeral: false });
    return;
  }

  if (interaction.commandName === "resume") {
    state.player.unpause();
    await interaction.reply({ content: "Weiter geht's.", ephemeral: false });
    return;
  }

  if (interaction.commandName === "stop") {
    state.player.stop();
    if (state.connection) {
      state.connection.destroy();
      state.connection = null;
    }
    state.currentStationKey = null;
    await interaction.reply({ content: "Gestoppt und Channel verlassen.", ephemeral: false });
    return;
  }

  if (interaction.commandName === "play") {
    const key = resolveStation(interaction.options.getString("station"));
    if (!key) {
      await interaction.reply({ content: "Unbekannte Station.", ephemeral: true });
      return;
    }

    const station = stations.stations[key];
    const connection = await connectToVoice(interaction);
    if (!connection) return;

    await interaction.deferReply();

    try {
      const resource = await createResource(station.url);
      state.player.play(resource);
      state.currentStationKey = key;
      state.player.once(AudioPlayerStatus.Idle, () => {
        // no-op: keep state
      });
      await interaction.editReply(`Starte: ${station.name}`);
    } catch (err) {
      await interaction.editReply(`Fehler beim Starten: ${err.message}`);
    }
  }
});

client.login(DISCORD_TOKEN);
