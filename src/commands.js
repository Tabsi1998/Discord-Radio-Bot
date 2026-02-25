import { ChannelType, SlashCommandBuilder } from "discord.js";
import { getPermissionCommandChoices } from "./config/command-permissions.js";

export function buildCommandBuilders() {
  const permissionChoices = getPermissionCommandChoices();
  return [
    new SlashCommandBuilder().setName("help").setDescription("Zeigt alle Befehle und kurze Erklaerungen"),
    new SlashCommandBuilder()
      .setName("play")
      .setDescription("Starte einen Radio-Stream in deinem Voice-Channel")
      .addStringOption((o) => o.setName("station").setDescription("Stationsname oder ID").setRequired(false).setAutocomplete(true))
      .addChannelOption((o) =>
        o.setName("voice")
          .setDescription("Voice- oder Stage-Channel (optional)")
          .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice)
          .setRequired(false)
      )
      .addStringOption((o) => o.setName("channel").setDescription("Voice/Stage per Name oder ID (Legacy)").setRequired(false).setAutocomplete(true)),
    new SlashCommandBuilder().setName("pause").setDescription("Wiedergabe pausieren"),
    new SlashCommandBuilder().setName("resume").setDescription("Wiedergabe fortsetzen"),
    new SlashCommandBuilder().setName("stop").setDescription("Stoppen und Channel verlassen"),
    new SlashCommandBuilder().setName("stations").setDescription("Verfuegbare Stationen fuer deinen Plan anzeigen"),
    new SlashCommandBuilder().setName("now").setDescription("Zeigt was gerade laeuft"),
    new SlashCommandBuilder()
      .setName("history")
      .setDescription("Zeigt die zuletzt erkannten Songs")
      .addIntegerOption((o) => o.setName("limit").setDescription("Anzahl Eintraege (1-20)").setRequired(false)),
    new SlashCommandBuilder()
      .setName("setvolume")
      .setDescription("Lautstaerke setzen (0-100)")
      .addIntegerOption((o) => o.setName("value").setDescription("0 bis 100").setRequired(true)),
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
      .setDescription("Sprache fuer diesen Server verwalten")
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
      .setDescription("[Ultimate] Eigene Station-URL hinzufuegen")
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
      .setDescription("[Pro] Event-Scheduler fuer automatische Starts")
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
                { name: "Taeglich", value: "daily" },
                { name: "Woechentlich (gleicher Wochentag)", value: "weekly" },
                { name: "Monatlich: 1. Wochentag", value: "monthly_first_weekday" },
                { name: "Monatlich: 2. Wochentag", value: "monthly_second_weekday" },
                { name: "Monatlich: 3. Wochentag", value: "monthly_third_weekday" },
                { name: "Monatlich: 4. Wochentag", value: "monthly_fourth_weekday" },
                { name: "Monatlich: letzter Wochentag", value: "monthly_last_weekday" }
              )
          )
          .addChannelOption((o) =>
            o.setName("text")
              .setDescription("Optionaler Text-Channel fuer Ankuendigung")
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
        sub.setName("activate").setDescription("Lizenz-Key fuer diesen Server aktivieren")
          .addStringOption((o) => o.setName("key").setDescription("Dein Lizenz-Key (z.B. OMNI-XXXX-XXXX-XXXX)").setRequired(true))
      )
      .addSubcommand((sub) =>
        sub.setName("info").setDescription("Lizenz-Info fuer diesen Server anzeigen")
      )
      .addSubcommand((sub) =>
        sub.setName("remove").setDescription("Diesen Server von der Lizenz entfernen")
      ),
    // Command permissions (Pro+)
    new SlashCommandBuilder()
      .setName("perm")
      .setDescription("[Pro] Rollenrechte fuer Commands verwalten")
      .addSubcommand((sub) =>
        sub.setName("allow")
          .setDescription("Erlaubt eine Rolle fuer einen Command")
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
          .setDescription("Sperrt eine Rolle fuer einen Command")
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
          .setDescription("Entfernt eine Rollenregel fuer einen Command")
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
          .setDescription("Setzt Regeln zurueck (ein Command oder alle)")
          .addStringOption((o) =>
            o.setName("command")
              .setDescription("Optional: nur diesen Command zuruecksetzen")
              .setRequired(false)
              .addChoices(...permissionChoices)
          )
      ),
  ];
}

export function buildCommandsJson() {
  return buildCommandBuilders().map((cmd) => cmd.toJSON());
}
