import { ChannelType, SlashCommandBuilder } from "discord.js";
import { getPermissionCommandChoices } from "./config/command-permissions.js";

export function buildCommandBuilders() {
  const permissionChoices = getPermissionCommandChoices();
  return [
    new SlashCommandBuilder().setName("help").setDescription("Zeigt alle Befehle und kurze Erklärungen"),
    new SlashCommandBuilder()
      .setName("play")
      .setDescription("Startet einen Radio-Stream in deinem Voice-Channel")
      .addStringOption((o) => o.setName("station").setDescription("Stationsname oder ID").setRequired(false).setAutocomplete(true))
      .addChannelOption((o) =>
        o.setName("voice")
          .setDescription("Voice- oder Stage-Channel (optional)")
          .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice)
          .setRequired(false)
      )
      .addIntegerOption((o) => o.setName("bot").setDescription("Worker-Bot Nummer (z.B. 1-16, optional)").setRequired(false)),
    new SlashCommandBuilder().setName("pause").setDescription("Wiedergabe pausieren")
      .addIntegerOption((o) => o.setName("bot").setDescription("Worker-Bot Nummer (optional)").setRequired(false)),
    new SlashCommandBuilder().setName("resume").setDescription("Wiedergabe fortsetzen")
      .addIntegerOption((o) => o.setName("bot").setDescription("Worker-Bot Nummer (optional)").setRequired(false)),
    new SlashCommandBuilder().setName("stop").setDescription("Stoppen und Channel verlassen")
      .addIntegerOption((o) => o.setName("bot").setDescription("Worker-Bot Nummer (optional)").setRequired(false))
      .addBooleanOption((o) => o.setName("all").setDescription("Alle Worker stoppen (optional)").setRequired(false)),
    new SlashCommandBuilder().setName("stations").setDescription("Verfügbare Stationen für deinen Plan anzeigen"),
    new SlashCommandBuilder().setName("now").setDescription("Zeigt, was gerade läuft"),
    new SlashCommandBuilder()
      .setName("history")
      .setDescription("Zeigt die zuletzt erkannten Songs")
      .addIntegerOption((o) => o.setName("limit").setDescription("Anzahl Einträge (1-20)").setRequired(false)),
    new SlashCommandBuilder()
      .setName("setvolume")
      .setDescription("Lautstärke setzen (0-100)")
      .addIntegerOption((o) => o.setName("value").setDescription("0 bis 100").setRequired(true))
      .addIntegerOption((o) => o.setName("bot").setDescription("Worker-Bot Nummer (optional)").setRequired(false)),
    new SlashCommandBuilder().setName("status").setDescription("Bot-Status und Uptime anzeigen"),
    new SlashCommandBuilder()
      .setName("list")
      .setDescription("Stationen auflisten (paginiert)")
      .addIntegerOption((o) => o.setName("page").setDescription("Seitennummer").setRequired(false)),
    new SlashCommandBuilder().setName("health").setDescription("Stream-Health und Reconnect-Info anzeigen"),
    new SlashCommandBuilder().setName("diag").setDescription("Diagnose: Audio/ffmpeg Profil und Stream-Details anzeigen"),
    new SlashCommandBuilder().setName("premium").setDescription("OmniFM Premium-Status deines Servers anzeigen"),
    new SlashCommandBuilder()
      .setName("language")
      .setDescription("Sprache für diesen Server verwalten")
      .addSubcommand((sub) =>
        sub.setName("show")
          .setDescription("Aktive Sprache anzeigen")
      )
      .addSubcommand((sub) =>
        sub.setName("set")
          .setDescription("Sprache fest einstellen")
          .addStringOption((o) =>
            o.setName("value")
              .setDescription("Sprache")
              .setRequired(true)
              .addChoices(
                { name: "Deutsch", value: "de" },
                { name: "English", value: "en" }
              )
          )
      )
      .addSubcommand((sub) =>
        sub.setName("reset")
          .setDescription("Automatische Sprachwahl (Server-Sprache)")
      ),
    // Custom Stations (Ultimate)
    new SlashCommandBuilder()
      .setName("addstation")
      .setDescription("[Ultimate] Eigene Station-URL hinzufügen")
      .addStringOption((o) => o.setName("key").setDescription("Kurzer Key (z.B. mystation)").setRequired(true))
      .addStringOption((o) => o.setName("name").setDescription("Anzeigename").setRequired(true))
      .addStringOption((o) => o.setName("url").setDescription("Stream-URL (http/https)").setRequired(true)),
    new SlashCommandBuilder()
      .setName("removestation")
      .setDescription("[Ultimate] Eigene Station entfernen")
      .addStringOption((o) => o.setName("key").setDescription("Station-Key").setRequired(true).setAutocomplete(true)),
    new SlashCommandBuilder().setName("mystations").setDescription("[Ultimate] Deine eigenen Stationen anzeigen"),
    // Scheduled events (Pro+)
    new SlashCommandBuilder()
      .setName("event")
      .setDescription("[Pro] Event-Scheduler für automatische Starts")
      .addSubcommand((sub) =>
        sub.setName("create")
          .setDescription("Neues Event planen (Voice-Start zu Zeitpunkt X)")
          .addStringOption((o) =>
            o.setName("name")
              .setDescription("Eventname (z.B. Morning Show)")
              .setRequired(true)
          )
          .addStringOption((o) =>
            o.setName("station")
              .setDescription("Stations-Key")
              .setRequired(true)
              .setAutocomplete(true)
          )
          .addChannelOption((o) =>
            o.setName("voice")
              .setDescription("Voice- oder Stage-Channel")
              .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice)
              .setRequired(true)
          )
          .addStringOption((o) =>
            o.setName("start")
              .setDescription("Startzeit: YYYY-MM-DD HH:MM (z.B. 2026-03-01 20:30)")
              .setRequired(true)
          )
          .addStringOption((o) =>
            o.setName("timezone")
              .setDescription("Zeitzone (z.B. Europe/Berlin, CET, MEZ)")
              .setRequired(false)
              .setAutocomplete(true)
          )
          .addStringOption((o) =>
            o.setName("repeat")
              .setDescription("Wiederholung")
              .setRequired(false)
              .addChoices(
                { name: "Einmalig", value: "none" },
                { name: "Täglich", value: "daily" },
                { name: "Wöchentlich (gleicher Wochentag)", value: "weekly" },
                { name: "Monatlich: 1. Wochentag", value: "monthly_first_weekday" },
                { name: "Monatlich: 2. Wochentag", value: "monthly_second_weekday" },
                { name: "Monatlich: 3. Wochentag", value: "monthly_third_weekday" },
                { name: "Monatlich: 4. Wochentag", value: "monthly_fourth_weekday" },
                { name: "Monatlich: letzter Wochentag", value: "monthly_last_weekday" }
              )
          )
          .addChannelOption((o) =>
            o.setName("text")
              .setDescription("Optionaler Text-Channel für Ankündigung")
              .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
              .setRequired(false)
          )
          .addBooleanOption((o) =>
            o.setName("serverevent")
              .setDescription("Optional: Discord-Server-Event automatisch anlegen")
              .setRequired(false)
          )
          .addStringOption((o) =>
            o.setName("stagetopic")
              .setDescription("Optionales Stage-Thema ({event},{station},{time})")
              .setRequired(false)
          )
          .addStringOption((o) =>
            o.setName("message")
              .setDescription("Optionale Nachricht ({event},{station},{voice},{time})")
              .setRequired(false)
          )
      )
      .addSubcommand((sub) =>
        sub.setName("list")
          .setDescription("Geplante Events anzeigen")
      )
      .addSubcommand((sub) =>
        sub.setName("delete")
          .setDescription("Event entfernen")
          .addStringOption((o) =>
            o.setName("id")
              .setDescription("Event-ID")
              .setRequired(true)
              .setAutocomplete(true)
          )
      ),
    // License Management
    new SlashCommandBuilder()
      .setName("license")
      .setDescription("Lizenz verwalten - aktivieren, info, entfernen")
      .addSubcommand((sub) =>
        sub.setName("activate").setDescription("Lizenz-Key für diesen Server aktivieren")
          .addStringOption((o) => o.setName("key").setDescription("Dein Lizenz-Key (z.B. OMNI-XXXX-XXXX-XXXX)").setRequired(true))
      )
      .addSubcommand((sub) =>
        sub.setName("info").setDescription("Lizenz-Info für diesen Server anzeigen")
      )
      .addSubcommand((sub) =>
        sub.setName("remove").setDescription("Diesen Server von der Lizenz entfernen")
      ),
    // Command permissions (Pro+)
    new SlashCommandBuilder()
      .setName("perm")
      .setDescription("[Pro] Rollenrechte für Commands verwalten")
      .addSubcommand((sub) =>
        sub.setName("allow")
          .setDescription("Erlaubt eine Rolle für einen Command")
          .addStringOption((o) =>
            o.setName("command")
              .setDescription("Command ohne /")
              .setRequired(true)
              .addChoices(...permissionChoices)
          )
          .addRoleOption((o) =>
            o.setName("role")
              .setDescription("Rolle, die den Command nutzen darf")
              .setRequired(true)
          )
      )
      .addSubcommand((sub) =>
        sub.setName("deny")
          .setDescription("Sperrt eine Rolle für einen Command")
          .addStringOption((o) =>
            o.setName("command")
              .setDescription("Command ohne /")
              .setRequired(true)
              .addChoices(...permissionChoices)
          )
          .addRoleOption((o) =>
            o.setName("role")
              .setDescription("Rolle, die gesperrt werden soll")
              .setRequired(true)
          )
      )
      .addSubcommand((sub) =>
        sub.setName("remove")
          .setDescription("Entfernt eine Rollenregel für einen Command")
          .addStringOption((o) =>
            o.setName("command")
              .setDescription("Command ohne /")
              .setRequired(true)
              .addChoices(...permissionChoices)
          )
          .addRoleOption((o) =>
            o.setName("role")
              .setDescription("Rolle, deren Regel entfernt werden soll")
              .setRequired(true)
          )
      )
      .addSubcommand((sub) =>
        sub.setName("list")
          .setDescription("Zeigt die aktuellen Command-Rollenregeln")
          .addStringOption((o) =>
            o.setName("command")
              .setDescription("Optional: nur einen Command anzeigen")
              .setRequired(false)
              .addChoices(...permissionChoices)
          )
      )
      .addSubcommand((sub) =>
        sub.setName("reset")
          .setDescription("Setzt Regeln zurück (ein Command oder alle)")
          .addStringOption((o) =>
            o.setName("command")
              .setDescription("Optional: nur diesen Command zurücksetzen")
              .setRequired(false)
              .addChoices(...permissionChoices)
          )
      ),
    new SlashCommandBuilder()
      .setName("invite")
      .setDescription("Lade einen Worker-Bot auf deinen Server ein")
      .addIntegerOption((o) =>
        o.setName("worker")
          .setDescription("Worker-Bot Nummer (1-16)")
          .setRequired(false)
      ),
    new SlashCommandBuilder()
      .setName("workers")
      .setDescription("Zeigt den Status aller Worker-Bots auf diesem Server"),
  ];
}

export function buildCommandsJson() {
  return buildCommandBuilders().map((cmd) => cmd.toJSON());
}
