import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { createEmbed, errorEmbed, successEmbed, infoEmbed, warningEmbed } from '../../utils/embeds.js';
import { logModerationAction } from '../../utils/moderation.js';
import { logger } from '../../utils/logger.js';
import { checkRateLimit } from '../../utils/rateLimiter.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

export default {
    data: new SlashCommandBuilder()
        .setName("masskick")
        .setDescription("Wirft mehrere Nutzer gleichzeitig vom Server")
        .addStringOption(option =>
            option
                .setName("users")
                .setDescription("Nutzer-IDs oder Erwähnungen (getrennt durch Leerzeichen oder Kommas)")
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName("reason")
                .setDescription("Grund für den Massen-Kick")
                .setRequired(false)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),
    category: "moderation",

    async execute(interaction, config, client) {
        const deferSuccess = await InteractionHelper.safeDefer(interaction);
        if (!deferSuccess) {
            logger.warn(`Masskick interaction defer failed`, {
                userId: interaction.user.id,
                guildId: interaction.guildId,
                commandName: 'masskick'
            });
            return;
        }

        if (!interaction.member.permissions.has(PermissionFlagsBits.KickMembers)) {
            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [
                    errorEmbed(
                        "Berechtigung verweigert",
                        "Du hast keine Berechtigung, um Mitglieder vom Server zu werfen."
                    ),
                ],
            });
        }

        const usersInput = interaction.options.getString("users");
        const reason = interaction.options.getString("reason") || "Massen-Kick - Kein Grund angegeben";

        try {
            
            const rateLimitKey = `masskick_${interaction.user.id}`;
            const isAllowed = await checkRateLimit(rateLimitKey, 3, 60000);
            if (!isAllowed) {
                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [
                        warningEmbed(
                            "Du führst Massen-Kicks zu schnell aus. Bitte warte eine Minute, bevor du es erneut versuchst.",
                            "⏳ Ratenbegrenzung (Rate Limit)"
                        ),
                    ],
                    flags: MessageFlags.Ephemeral,
                });
            }

            const userIds = usersInput
                .replace(/<@!?(\d+)>/g, '$1')
                .split(/[\s,]+/)
                .filter(id => id && /^\d+$/.test(id))
                .slice(0, 20);

            if (userIds.length === 0) {
                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [
                        errorEmbed(
                            "Ungültige Nutzer",
                            "Bitte gib gültige Nutzer-IDs oder Erwähnungen an. Maximal 20 Nutzer gleichzeitig."
                        ),
                    ],
                });
            }

            if (userIds.includes(interaction.user.id)) {
                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [
                        errorEmbed(
                            "Selbstkick unmöglich",
                            "Du kannst dich nicht selbst in einen Massen-Kick einschließen."
                        ),
                    ],
                });
            }

            if (userIds.includes(client.user.id)) {
                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [
                        errorEmbed(
                            "Bot-Kick unmöglich",
                            "Du kannst den Bot nicht in einen Massen-Kick einschließen."
                        ),
                    ],
                });
            }

            const results = {
                successful: [],
                failed: [],
                skipped: []
            };

            for (const userId of userIds) {
                try {
                    const member = await interaction.guild.members.fetch(userId).catch(() => null);
                    
                    if (!member) {
                        results.failed.push({ userId, reason: "Nutzer nicht auf dem Server" });
                        continue;
                    }

                    if (member.roles.highest.position >= interaction.member.roles.highest.position && 
                        interaction.guild.ownerId !== interaction.user.id) {
                        results.skipped.push({ 
                            user: member.user.tag, 
                            userId, 
                            reason: "Gleichwertige oder höhere Rolle" 
                        });
                        continue;
                    }

                    await member.kick(reason);

                    results.successful.push({
                        user: member.user.tag,
                        userId
                    });

                    await logModerationAction({
                        client,
                        guild: interaction.guild,
                        event: {
                            action: "Member Kicked",
                            target: `${member.user.tag} (${member.user.id})`,
                            executor: `${interaction.user.tag} (${interaction.user.id})`,
                            reason: `${reason} (Mass Kick)`,
                            metadata: {
                                userId: member.user.id,
                                moderatorId: interaction.user.id,
                                massKick: true
                            }
                        }
                    });

                } catch (error) {
                    logger.error(`Failed to kick user ${userId}:`, error);
                    results.failed.push({ 
                        userId, 
                        reason: error.message || "Unbekannter Fehler" 
                    });
                }
            }

            let description = `**Ergebnisse des Massen-Kicks:**\n\n`;
            
            if (results.successful.length > 0) {
                description += `✅ **Erfolgreich gekickt (${results.successful.length}):**\n`;
                results.successful.forEach(result => {
                    description += `• ${result.user} (${result.userId})\n`;
                });
                description += '\n';
            }

            if (results.skipped.length > 0) {
                description += `⚠️ **Übersprungen (${results.skipped.length}):**\n`;
                results.skipped.forEach(result => {
                    description += `• ${result.user} - ${result.reason}\n`;
                });
                description += '\n';
            }

            if (results.failed.length > 0) {
                description += `❌ **Fehlgeschlagen (${results.failed.length}):**\n`;
                results.failed.forEach(result => {
                    description += `• ${result.userId} - ${result.reason}\n`;
                });
            }

            const embed = results.successful.length > 0 ? successEmbed : warningEmbed;
            
            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [
                    embed(
                        `Components 📢 Massen-Kick abgeschlossen`,
                        description
                    )
                ]
            });

        } catch (error) {
            logger.error("Error in masskick command:", error);
            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [
                    errorEmbed(
                        "Systemfehler",
                        "Beim Verarbeiten des Massen-Kicks ist ein Fehler aufgetreten. Bitte versuche es später noch einmal."
                    ),
                ],
            });
        }
    }
};
