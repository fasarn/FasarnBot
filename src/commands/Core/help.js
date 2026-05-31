import {
    SlashCommandBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
} from "discord.js";
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { createEmbed } from "../../utils/embeds.js";
import {
    createSelectMenu,
} from "../../utils/components.js";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CATEGORY_SELECT_ID = "help-category-select";
const ALL_COMMANDS_ID = "help-all-commands";
const BUG_REPORT_BUTTON_ID = "help-bug-report";
const HELP_MENU_TIMEOUT_MS = 5 * 60 * 1000;

const CATEGORY_ICONS = {
    Core: "ℹ️",
    Moderation: "🛡️",
    Economy: "💰",
    Fun: "🎮",
    Leveling: "📊",
    Utility: "🔧",
    Ticket: "🎫",
    Welcome: "👋",
    Giveaway: "🎉",
    Counter: "🔢",
    Tools: "🛠️",
    Search: "🔍",
    Reaction_Roles: "🎭",
    Community: "👥",
    Birthday: "🎂",
    Config: "⚙️",
};

export async function createInitialHelpMenu(client) {
    const commandsPath = path.join(__dirname, "../../commands");
    const categoryDirs = (
        await fs.readdir(commandsPath, { withFileTypes: true })
    )
        .filter((dirent) => dirent.isDirectory())
        .map((dirent) => dirent.name)
        .sort();

    const options = [
        {
            label: "📋 Alle Befehle",
            description: "Zeige alle verfügbaren Befehle seitenweise an",
            value: ALL_COMMANDS_ID,
        },
        ...categoryDirs.map((category) => {
            const categoryName =
                category.charAt(0).toUpperCase() +
                category.slice(1).toLowerCase();
            const icon = CATEGORY_ICONS[categoryName] || "🔍";
            return {
                label: `${icon} ${categoryName}`,
                description: `Befehle aus der Kategorie ${categoryName} anzeigen`,
                value: category,
            };
        }),
    ];

    const botName = client?.user?.username || "Bot";
    const embed = createEmbed({ 
        title: `🤖 ${botName} Hilfe-Center`,
        description: "Dein All-in-One Discord-Begleiter für Moderation, Wirtschaft, Spaß und Serververwaltung.",
        color: 'primary'
    });

    embed.addFields(
        {
            name: "🛡️ **Moderation**",
            value: "Servermoderation, Benutzerverwaltung und Werkzeuge zur Durchsetzung von Regeln",
            inline: true
        },
        {
            name: "💰 **Wirtschaft**",
            value: "Währungssystem, Shops und virtuelle Wirtschaft",
            inline: true
        },
        {
            name: "🎮 **Spaß**",
            value: "Spiele, Unterhaltung und interaktive Befehle",
            inline: true
        },
        {
            name: "📊 **Level-System**",
            value: "Benutzer-Level, XP-System und Fortschrittsverfolgung",
            inline: true
        },
        {
            name: "🎫 **Tickets**",
            value: "Support-Ticket-System für die Serververwaltung",
            inline: true
        },
        {
            name: "🎉 **Giveaways**",
            value: "Automatisierte Verwaltung und Verteilung von Verlosungen",
            inline: true
        },
        {
            name: "👋 **Willkommen**",
            value: "Willkommensnachrichten für Mitglieder und Onboarding",
            inline: true
        },
        {
            name: "🎂 **Geburtstage**",
            value: "Geburtstagsverfolgung und Feierfunktionen",
            inline: true
        },
        {
            name: "👥 **Community**",
            value: "Community-Tools, Bewerbungen und Mitglieder-Engagement",
            inline: true
        },
        {
            name: "⚙️ **Konfiguration**",
            value: "Befehle zur Verwaltung der Server- und Bot-Konfiguration",
            inline: true
        },
        {
            name: "🔢 **Zähler**",
            value: "Einrichtung von Live-Zählerkanälen und Zählersteuerung",
            inline: true
        },
        {
            name: "🎙️ **Join to Create**",
            value: "Dynamische Erstellung und Verwaltung von Sprachkanälen",
            inline: true
        },
        {
            name: "🎭 **Reaktions-Rollen**",
            value: "Selbstzuweisbare Rollen über Reaktions-Rollen-Systeme",
            inline: true
        },
        {
            name: "✅ **Verifizierung**",
            value: "Abläufe zur Mitgliederverifizierung und Zugriffsbeschränkung",
            inline: true
        },
        {
            name: "🔧 **Nützliches**",
            value: "Praktische Werkzeuge und Server-Utilities",
            inline: true
        }
    );

    embed.setFooter({ 
        text: "Erstellt mit ❤️" 
    });
    embed.setTimestamp();

    const bugReportButton = new ButtonBuilder()
        .setCustomId(BUG_REPORT_BUTTON_ID)
        .setLabel("Fehler melden")
        .setStyle(ButtonStyle.Danger);

    const supportButton = new ButtonBuilder()
        .setLabel("Support-Server")
        .setURL("https://discord.gg/QnWNz2dKCE")
        .setStyle(ButtonStyle.Link);

    const touchpointButton = new ButtonBuilder()
        .setLabel("Von Touchpoint lernen")
        .setURL("https://www.youtube.com/@TouchDisc")
        .setStyle(ButtonStyle.Link);

    const selectRow = createSelectMenu(
        CATEGORY_SELECT_ID,
        "Wähle eine Option, um die Befehle zu sehen",
        options,
    );

    const buttonRow = new ActionRowBuilder().addComponents([
        bugReportButton,
        supportButton,
        touchpointButton,
    ]);

    return {
        embeds: [embed],
        components: [buttonRow, selectRow],
    };
}

export default {
    data: new SlashCommandBuilder()
        .setName("help")
        .setDescription("Zeigt das Hilfe-Menü mit allen verfügbaren Befehlen an"),

    async execute(interaction, guildConfig, client) {
        
        const { MessageFlags } = await import('discord.js');
        await InteractionHelper.safeDefer(interaction);
        
        const { embeds, components } = await createInitialHelpMenu(client);

        await InteractionHelper.safeEditReply(interaction, {
            embeds,
            components,
        });

        setTimeout(async () => {
            try {
                const closedEmbed = createEmbed({
                    title: "Hilfe-Menü geschlossen",
                    description: "Das Hilfe-Menü wurde geschlossen. Nutze `/help` erneut.",
                    color: "secondary",
                });

                await InteractionHelper.safeEditReply(interaction, {
                    embeds: [closedEmbed],
                    components: [],
                });
            } catch (error) {
                
            }
        }, HELP_MENU_TIMEOUT_MS);
    },
};
