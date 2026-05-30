import { logger } from '../utils/logger.js';

export const botConfig = {
  // =========================
  // BOT PRÄSENZ (was Nutzer unter dem Botnamen sehen)
  // =========================
  // `status` Optionen:
  // - "online"    = grüner Punkt
  // - "idle"      = gelber Mond
  // - "dnd"       = roter Nicht-stören Status
  // - "invisible" = erscheint offline
  presence: {
    // Aktueller Online Status auf Discord
    status: "online",

    // Aktivitätszeilen unter dem Botnamen
    // `type` Nummernzuordnung von Discord:
    // 0 = Spielt
    // 1 = Streamt
    // 2 = Hört zu
    // 3 = Schaut zu
    // 4 = Benutzerdefiniert
    // 5 = Tritt an
    activities: [
      {
        // Text den Nutzer sehen
        name: "Made by Speedy",
        // Aktivitätstyp Nummer
        type: 0,
      },
    ],
  },

  // =========================
  // BEFEHLSVERHALTEN
  // =========================
  commands: {
    // Bot Besitzer User IDs
    owners: process.env.OWNER_IDS?.split(",") || [],

    // Standard Cooldown zwischen Befehlen
    defaultCooldown: 3,

    // Falls true werden alte Befehle gelöscht
    deleteCommands: false,

    // Optionale Test Server ID
    testGuildId: process.env.TEST_GUILD_ID,
  },

  // =========================
  // BEWERBUNGSSYSTEM
  // =========================
  applications: {
    // Standardfragen
    defaultQuestions: [
      { question: "Wie heißt du?", required: true },
      { question: "Wie alt bist du?", required: true },
      { question: "Warum möchtest du dich bewerben?", required: true },
    ],

    // Farben nach Status
    statusColors: {
      pending: "#FFA500",
      approved: "#00FF00",
      denied: "#FF0000",
    },

    // Wartezeit bis zur nächsten Bewerbung
    applicationCooldown: 24,

    // Abgelehnte Bewerbungen löschen nach
    deleteDeniedAfter: 7,

    // Angenommene Bewerbungen löschen nach
    deleteApprovedAfter: 30,

    // Rollen die Bewerbungen verwalten dürfen
    managerRoles: [],
  },

  // =========================
  // EMBED FARBEN & BRANDING
  // =========================
  // EINZIGE QUELLE DER WAHRHEIT für Farben
  embeds: {
    colors: {
      primary: "#336699",
      secondary: "#2F3136",

      success: "#57F287",
      error: "#ED4245",
      warning: "#FEE75C",
      info: "#3498DB",

      light: "#FFFFFF",
      dark: "#202225",
      gray: "#99AAB5",

      blurple: "#5865F2",
      green: "#57F287",
      yellow: "#FEE75C",
      fuchsia: "#EB459E",
      red: "#ED4245",
      black: "#000000",

      giveaway: {
        active: "#57F287",
        ended: "#ED4245",
      },

      ticket: {
        open: "#57F287",
        claimed: "#FAA61A",
        closed: "#ED4245",
        pending: "#99AAB5",
      },

      economy: "#F1C40F",
      birthday: "#E91E63",
      moderation: "#9B59B6",

      priority: {
        none: "#95A5A6",
        low: "#3498db",
        medium: "#2ecc71",
        high: "#f1c40f",
        urgent: "#e74c3c",
      },
    },

    footer: {
      // Standard Footer Text
      text: "Fasarn Bot",
      icon: null,
    },

    // Standard Thumbnail
    thumbnail: null,

    author: {
      // Optionaler Standard Autor
      name: null,
      icon: null,
      url: null,
    },
  },

  // =========================
  // WIRTSCHAFTS EINSTELLUNGEN
  // =========================
  economy: {
    currency: {
      name: "coins",
      namePlural: "coins",
      symbol: "$",
    },

    startingBalance: 0,
    baseBankCapacity: 100000,

    // Tägliche Belohnung
    dailyAmount: 100,

    // Arbeitsbefehl Auszahlung
    workMin: 10,
    workMax: 100,

    // Bettelbefehl Auszahlung
    begMin: 5,
    begMax: 50,

    // Erfolgswahrscheinlichkeit beim Ausrauben
    robSuccessRate: 0.4,

    // Gefängniszeit nach Fehlversuch
    robFailJailTime: 3600000,
  },

  shop: {},

  // =========================
  // TICKET SYSTEM
  // =========================
  tickets: {
    // Kategorie für neue Tickets
    defaultCategory: null,

    // Support Rollen
    supportRoles: [],

    priorities: {
      none: {
        emoji: "⚪",
        color: "#95A5A6",
        label: "Keine",
      },
      low: {
        emoji: "🟢",
        color: "#2ECC71",
        label: "Niedrig",
      },
      medium: {
        emoji: "🟡",
        color: "#F1C40F",
        label: "Mittel",
      },
      high: {
        emoji: "🔴",
        color: "#E74C3C",
        label: "Hoch",
      },
      urgent: {
        emoji: "🚨",
        color: "#E91E63",
        label: "Dringend",
      },
    },

    defaultPriority: "none",
    archiveCategory: null,
    logChannel: null,
  },

  // =========================
  // GIVEAWAYS
  // =========================
  giveaways: {
    defaultDuration: 86400000,

    minimumWinners: 1,
    maximumWinners: 10,

    minimumDuration: 300000,
    maximumDuration: 2592000000,

    allowedRoles: [],
    bypassRoles: [],
  },

  // =========================
  // GEBURTSTAGE
  // =========================
  birthday: {
    defaultRole: null,
    announcementChannel: null,

    // Zeitzone
    timezone: "UTC",
  },

  // =========================
  // VERIFIZIERUNG
  // =========================
  verification: {
    defaultMessage: "Verifiziere dich mit dem Button unten!",
    defaultButtonText: "Verifiziere mich!",

    autoVerify: {
      // Automatische Verifizierungsregeln
      defaultCriteria: "none",

      defaultAccountAgeDays: 7,

      serverSizeThreshold: 1000,

      minAccountAge: 1,
      maxAccountAge: 365,

      sendDMNotification: true,

      criteria: {
        account_age:
          "Account muss älter als die angegebenen Tage sein",
        server_size:
          "Alle Nutzer wenn der Server weniger als 1000 Mitglieder hat",
        none:
          "Alle Nutzer sofort",
      }
    },

    verificationCooldown: 5000,
    maxVerificationAttempts: 3,
    attemptWindow: 60000,

    maxCooldownEntries: 10000,
    maxAttemptEntries: 10000,

    cooldownCleanupInterval: 300000,

    maxAuditMetadataBytes: 4096,
    maxInMemoryAuditEntries: 1000,

    logAllVerifications: true,
    keepAuditTrail: true,
  },

  // =========================
  // WILLKOMMEN / VERABSCHIEDUNG
  // =========================
  welcome: {
    defaultWelcomeMessage:
      "Willkommen {user} auf dem **Fasarn Community Server**! Wir haben nun {memberCount} Mitglieder!",

    defaultGoodbyeMessage:
      "{user} hat den Server verlassen. Wir haben jetzt {memberCount} Mitglieder.",

    defaultWelcomeChannel: null,
    defaultGoodbyeChannel: null,
  },

  // =========================
  // COUNTER KANÄLE
  // =========================
  counters: {
    defaults: {
      name: "{name} Zähler",
      description: "Server {name} Zähler",
      type: "voice",
      channelName: "{name}-{count}",
    },

    permissions: {
      deny: ["VIEW_CHANNEL"],
      allow: ["VIEW_CHANNEL", "CONNECT", "SPEAK"],
    },

    messages: {
      created: "✅ Counter erstellt: **{name}**",
      deleted: "🗑️ Counter gelöscht: **{name}**",
      updated: "🔄 Counter aktualisiert: **{name}**",
    },

    types: {
      members: {
        name: "👥 Mitglieder",
        description: "Mitglieder auf dem Server",
        getCount: (guild) => guild.memberCount.toString(),
      },

      bots: {
        name: "🤖 Bots",
        description: "Bots auf dem Server",
        getCount: (guild) =>
          guild.members.cache.filter((m) => m.user.bot).size.toString(),
      },

      members_only: {
        name: "👤 Menschen",
        description: "Alle Menschen auf dem Server",
        getCount: (guild) =>
          guild.members.cache.filter((m) => !m.user.bot).size.toString(),
      },
    },
  },

  // =========================
  // GENERISCHE BOT NACHRICHTEN
  // =========================
  messages: {
    noPermission:
      "Du hast keine Berechtigung diesen Befehl zu verwenden.",

    cooldownActive:
      "Bitte warte {time}, bevor du diesen Befehl erneut benutzt.",

    errorOccurred:
      "Beim Ausführen dieses Befehls ist ein Fehler aufgetreten.",

    missingPermissions:
      "Mir fehlen die erforderlichen Berechtigungen um diese Aktion auszuführen.",

    commandDisabled:
      "Dieser Befehl wurde deaktiviert.",

    maintenanceMode:
      "Der Bot befindet sich momentan im Wartungsmodus.",
  },

  // =========================
  // FEATURE TOGGLES
  // =========================
  features: {
    economy: true,
    leveling: true,
    moderation: true,
    logging: true,
    welcome: true,

    tickets: true,
    giveaways: true,
    birthday: true,
    counter: true,

    verification: true,
    reactionRoles: true,
    joinToCreate: true,

    voice: true,
    search: true,
    tools: true,
    utility: true,
    community: true,
    fun: true,
  },
};

export function validateConfig(config) {
  const errors = [];

  if (process.env.NODE_ENV !== 'production') {
    logger.debug('Prüfung der Umgebungsvariablen:');
    logger.debug('DISCORD_TOKEN vorhanden:', !!process.env.DISCORD_TOKEN);
    logger.debug('TOKEN vorhanden:', !!process.env.TOKEN);
    logger.debug('CLIENT_ID vorhanden:', !!process.env.CLIENT_ID);
    logger.debug('GUILD_ID vorhanden:', !!process.env.GUILD_ID);
    logger.debug('POSTGRES_HOST vorhanden:', !!process.env.POSTGRES_HOST);
    logger.debug('NODE_ENV:', process.env.NODE_ENV);
  }

  if (!process.env.DISCORD_TOKEN && !process.env.TOKEN) {
    errors.push(
      "Bot Token erforderlich (DISCORD_TOKEN oder TOKEN Umgebungsvariable)"
    );
  }

  if (!process.env.CLIENT_ID) {
    errors.push(
      "Client ID erforderlich (CLIENT_ID Umgebungsvariable)"
    );
  }

  if (process.env.NODE_ENV === 'production') {
    if (!process.env.POSTGRES_HOST) {
      errors.push(
        "PostgreSQL Host wird in Production benötigt"
      );
    }

    if (!process.env.POSTGRES_USER) {
      errors.push(
        "PostgreSQL Benutzer wird in Production benötigt"
      );
    }

    if (!process.env.POSTGRES_PASSWORD) {
      errors.push(
        "PostgreSQL Passwort wird in Production benötigt"
      );
    }
  }

  return errors;
}

const configErrors = validateConfig(botConfig);

if (configErrors.length > 0) {
  logger.error(
    "Bot Konfigurationsfehler:",
    configErrors.join("\n")
  );

  if (process.env.NODE_ENV === "production") {
    process.exit(1);
  }
}

export const BotConfig = botConfig;

export function getColor(path, fallback = "#99AAB5") {

  if (typeof path === "number") return path;

  if (typeof path === "string" && path.startsWith("#")) {
    return parseInt(path.replace("#", ""), 16);
  }

  const result = path
    .split(".")
    .reduce(
      (obj, key) => (obj && obj[key] !== undefined ? obj[key] : fallback),
      botConfig.embeds.colors,
    );

  if (typeof result === "string" && result.startsWith("#")) {
    return parseInt(result.replace("#", ""), 16);
  }

  return result;
}

export function getRandomColor() {
  const colors = Object.values(botConfig.embeds.colors).flatMap(
    (color) =>
      typeof color === "string"
        ? color
        : Object.values(color),
  );

  return colors[
    Math.floor(Math.random() * colors.length)
  ];
}

export default botConfig;
