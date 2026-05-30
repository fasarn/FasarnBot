import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { createEmbed, errorEmbed, successEmbed, infoEmbed, warningEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { getFromDb, setInDb, deleteFromDb } from '../../utils/database.js';
import { sanitizeInput } from '../../utils/sanitization.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

function getUserNotesKey(guildId, userId) {
    return `moderation_user_notes_${guildId}_${userId}`;
}

function getGuildNotesListKey(guildId) {
    return `moderation_user_notes_list_${guildId}`;
}

export default {
    data: new SlashCommandBuilder()
        .setName("usernotes")
        .setDescription("Verwaltet Moderationsnotizen für einen Nutzer")
        .addSubcommand(subcommand =>
            subcommand
                .setName("add")
                .setDescription("Fügt einem Nutzer eine Notiz hinzu")
                .addUserOption(option =>
                    option
                        .setName("target")
                        .setDescription("Der Nutzer, dem die Notiz hinzugefügt wird")
                        .setRequired(true)
                )
                .addStringOption(option =>
                    option
                        .setName("note")
                        .setDescription("Der Inhalt der Notiz")
                        .setRequired(true)
                )
                .addStringOption(option =>
                    option
                        .setName("type")
                        .setDescription("Typ der Notiz")
                        .addChoices(
                            { name: "Warnung", value: "warning" },
                            { name: "Positiv", value: "positive" },
                            { name: "Neutral", value: "neutral" },
                            { name: "Alarm", value: "alert" }
                        )
                        .setRequired(false)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName("view")
                .setDescription("Zeigt die Notizen eines Nutzers an")
                .addUserOption(option =>
                    option
                        .setName("target")
                        .setDescription("Der Nutzer, dessen Notizen angezeigt werden")
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName("remove")
                .setDescription("Entfernt eine bestimmte Notiz eines Nutzers")
                .addUserOption(option =>
                    option
                        .setName("target")
                        .setDescription("Der Nutzer, dessen Notiz entfernt wird")
                        .setRequired(true)
                )
                .addIntegerOption(option =>
                    option
                        .setName("index")
                        .setDescription("Die Nummer (Index) der zu entfernenden Notiz")
                        .setRequired(true)
                        .setMinValue(1)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName("clear")
                .setDescription("Löscht alle Notizen eines Nutzers")
                .addUserOption(option =>
                    option
                        .setName("target")
                        .setDescription("Der Nutzer, dessen Notizen vollständig gelöscht werden")
                        .setRequired(true)
                )
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
    category: "moderation",

    async execute(interaction, config, client) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
            return InteractionHelper.safeReply(interaction, {
                embeds: [
                    errorEmbed(
                        "Berechtigung verweigert",
                        "Du hast keine Berechtigung, Nutzernotizen zu verwalten."
                    ),
                ],
            });
        }

        const subcommand = interaction.options.getSubcommand();
        const targetUser = interaction.options.getUser("target");
        const guildId = interaction.guild.id;

        if (subcommand !== "view" && subcommand !== "remove" && subcommand !== "clear" && subcommand !== "add") {
            return InteractionHelper.safeReply(interaction, {
                embeds: [
                    errorEmbed(
                        "Ungültiger Unterbefehl",
                        "Bitte wähle einen gültigen Unterbefehl aus."
                    ),
                ],
            });
        }

        let notes = [];
        if (targetUser) {
            const notesKey = getUserNotesKey(guildId, targetUser.id);
            notes = await getFromDb(notesKey, []);
        }

        try {
            switch (subcommand) {
                case "add":
                    return await handleAddNote(interaction, targetUser, notes, guildId);
                case "view":
                    return await handleViewNotes(interaction, targetUser, notes);
                case "remove":
                    return await handleRemoveNote(interaction, targetUser, notes, guildId);
                case "clear":
                    return await handleClearNotes(interaction, targetUser, notes, guildId);
                default:
                    return InteractionHelper.safeReply(interaction, {
                        embeds: [
                            errorEmbed(
                                "Ungültiger Unterbefehl",
                                "Bitte wähle einen gültigen Unterbefehl aus."
                            ),
                        ],
                    });
            }
        } catch (error) {
            logger.error(`Error in usernotes command (${subcommand}):`, error);
            return InteractionHelper.safeReply(interaction, {
                embeds: [
                    errorEmbed(
                        "Systemfehler",
                        "Beim Verarbeiten deiner Anfrage ist ein Fehler aufgetreten. Bitte versuche es später noch einmal."
                    ),
                ],
                flags: MessageFlags.Ephemeral
            });
        }
    }
};

async function handleAddNote(interaction, targetUser, notes, guildId) {
    let note = interaction.options.getString("note").trim();
    const type = interaction.options.getString("type") || "neutral";

    if (note.length > 1000) {
        return InteractionHelper.safeReply(interaction, {
            embeds: [
                errorEmbed(
                    "Notiz zu lang",
                    "Notizen dürfen maximal 1000 Zeichen lang sein."
                ),
            ],
        });
    }

    if (note.length === 0) {
        return InteractionHelper.safeReply(interaction, {
            embeds: [
                errorEmbed(
                    "Leere Notiz",
                    "Die Notiz darf nicht leer sein."
                ),
            ],
        });
    }

    note = sanitizeInput(note);

    const noteData = {
        id: Date.now(),
        content: note,
        type: type,
        author: interaction.user.tag,
        authorId: interaction.user.id,
        timestamp: new Date().toISOString()
    };

    notes.push(noteData);

    const notesKey = getUserNotesKey(guildId, targetUser.id);
    await setInDb(notesKey, notes);

    const typeInfo = getNoteTypeInfo(type);
    
    const translatedTypes = { warning: "Warnung", positive: "Positiv", neutral: "Neutral", alert: "Alarm" };
    const displayType = translatedTypes[type] || type;

    return InteractionHelper.safeReply(interaction, {
        embeds: [
            successEmbed(
                `${typeInfo.emoji} Notiz hinzugefügt`,
                `Eine **${displayType}**-Notiz für **${targetUser.tag}** wurde hinzugefügt:\n\n` +
                `> ${note}\n\n` +
                `**Moderator:** ${interaction.user.tag}\n` +
                `**Notizen insgesamt:** ${notes.length}`
            )
        ]
    });
}

async function handleViewNotes(interaction, targetUser, notes) {
    if (notes.length === 0) {
        return InteractionHelper.safeReply(interaction, {
            embeds: [
                infoEmbed(
                    "📝 Keine Notizen",
                    `Es liegen keine Notizen für **${targetUser.tag}** vor.`
                ),
            ],
        });
    }

    const sortedNotes = [...notes].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    const translatedTypes = { warning: "Warnung", positive: "Positiv", neutral: "Neutral", alert: "Alarm" };

    let description = `**Notizen für ${targetUser.tag} (${targetUser.id}):**\n\n`;
    
    sortedNotes.forEach((note, index) => {
        const typeInfo = getNoteTypeInfo(note.type);
        const date = new Date(note.timestamp).toLocaleDateString('de-DE');
        const displayType = translatedTypes[note.type] || note.type;
        
        description += `${typeInfo.emoji} **Notiz #${index + 1}** (${displayType}) - ${date}\n`;
        description += `> ${note.content}\n`;
        description += `*Hinzugefügt von ${note.author}*\n\n`;
    });

    if (description.length > 4000) {
        description = description.substring(0, 3900) + "\n... *(gekürzt)*";
    }

    return InteractionHelper.safeReply(interaction, {
        embeds: [
            infoEmbed(
                `📝 Nutzernotizen (${notes.length})`,
                description
            )
        ]
    });
}

async function handleRemoveNote(interaction, targetUser, notes, guildId) {
    const index = interaction.options.getInteger("index") - 1;

    if (index < 0 || index >= notes.length) {
        return InteractionHelper.safeReply(interaction, {
            embeds: [
                errorEmbed(
                    "Ungültiger Index",
                    `Bitte gib eine gültige Notiznummer an (1-${notes.length}).`
                ),
            ],
        });
    }

    const removedNote = notes[index];
    notes.splice(index, 1);

    const notesKey = getUserNotesKey(guildId, targetUser.id);
    await setInDb(notesKey, notes);

    const typeInfo = getNoteTypeInfo(removedNote.type);

    return InteractionHelper.safeReply(interaction, {
        embeds: [
            successEmbed(
                `${typeInfo.emoji} Notiz entfernt`,
                `Notiz #${index + 1} von **${targetUser.tag}** wurde gelöscht:\n\n` +
                `> ${removedNote.content}\n\n` +
                `**Verbleibende Notizen:** ${notes.length}`
            )
        ]
    });
}

async function handleClearNotes(interaction, targetUser, notes, guildId) {
    const noteCount = notes.length;
    
    if (noteCount === 0) {
        return InteractionHelper.safeReply(interaction, {
            embeds: [
                infoEmbed(
                    "Keine Notizen zum Löschen",
                    `Es gibt keine Notizen für **${targetUser.tag}**, die gelöscht werden könnten.`
                ),
            ],
        });
    }

    notes.length = 0;

    const notesKey = getUserNotesKey(guildId, targetUser.id);
    await setInDb(notesKey, notes);

    return InteractionHelper.safeReply(interaction, {
        embeds: [
            successEmbed(
                "🗑️ Notizen gelöscht",
                `Es wurden alle **${noteCount}** Notizen von **${targetUser.tag}** gelöscht.`
            )
        ]
    });
}

function getNoteTypeInfo(type) {
    const types = {
        warning: { emoji: "⚠️", color: "#FF6B6B" },
        positive: { emoji: "✅", color: "#51CF66" },
        neutral: { emoji: "📝", color: "#74C0FC" },
        alert: { emoji: "🚨", color: "#FFD43B" }
    };
    
    return types[type] || types.neutral;
}
