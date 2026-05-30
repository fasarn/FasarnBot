import { SlashCommandBuilder, PermissionFlagsBits, PermissionsBitField, ChannelType, MessageFlags } from 'discord.js';
import { createEmbed, errorEmbed, successEmbed, infoEmbed, warningEmbed } from '../../utils/embeds.js';
import { logEvent } from '../../utils/moderation.js';
import { logger } from '../../utils/logger.js';
import { sanitizeMarkdown } from '../../utils/sanitization.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

export default {
    data: new SlashCommandBuilder()
        .setName("dm")
        .setDescription("Sendet eine Direktnachricht an einen Nutzer (Nur für Teammitglieder)")
        .addUserOption(option =>
            option
                .setName("user")
                .setDescription("Der Nutzer, der die DM erhalten soll")
                .setRequired(true)
        )
        .addStringOption(option =>
            option
                .setName("message")
                .setDescription("Die zu sendende Nachricht")
                .setRequired(true)
        )
        .addBooleanOption(option =>
            option
                .setName("anonymous")
                .setDescription("Die Nachricht anonym senden (Standard: false)")
                .setRequired(false)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .setDMPermission(false),
    category: "Moderation",

    async execute(interaction, config, client) {
        const deferSuccess = await InteractionHelper.safeDefer(interaction);
        if (!deferSuccess) {
            logger.warn(`DM interaction defer failed`, {
                userId: interaction.user.id,
                guildId: interaction.guildId,
                commandName: 'dm'
            });
            return;
        }

        const targetUser = interaction.options.getUser("user");
        const message = interaction.options.getString("message");
        const anonymous = interaction.options.getBoolean("anonymous") || false;

        try {
            
            if (message.length > 2000) {
                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [
                        errorEmbed(
                            "Nachricht zu lang",
                            "Nachrichten müssen weniger als 2000 Zeichen enthalten."
                        ),
                    ],
                    flags: MessageFlags.Ephemeral,
                });
            }

            
            if (targetUser.bot) {
                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [
                        errorEmbed(
                            "Bot-Direktnachricht unmöglich",
                            "Du kannst keine Direktnachrichten an Bot-Accounts senden."
                        ),
                    ],
                    flags: MessageFlags.Ephemeral,
                });
            }

            
            const sanitized = sanitizeMarkdown(message);

            const dmChannel = await targetUser.createDM();
            
            await dmChannel.send({
                embeds: [
                    successEmbed(
                        anonymous ? "Nachricht vom Server-Team" : `Nachricht von ${interaction.user.tag}`,
                        sanitized
                    ).setFooter({
                        text: `Du kannst auf diese Nachricht nicht antworten. | Protokoll-ID: ${interaction.id}`
                    })
                ]
            });

            await logEvent({
                client: interaction.client,
                guild: interaction.guild,
                event: {
                    action: "DM Sent",
                    target: `${targetUser.tag} (${targetUser.id})`,
                    executor: `${interaction.user.tag} (${interaction.user.id})`,
                    reason: `Anonymous: ${anonymous ? 'Yes' : 'No'}`,
                    metadata: {
                        userId: targetUser.id,
                        moderatorId: interaction.user.id,
                        anonymous,
                        messageLength: sanitized.length
                    }
                }
            });

            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [
                    successEmbed(
                        "DM gesendet",
                        `Die Nachricht wurde erfolgreich an ${targetUser.tag} zugestellt.`
                    ),
                ],
            });
        } catch (error) {
            logger.error('DM command error:', error);
            
            if (error.code === 50007) {
                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [
                        errorEmbed("Fehler", `Nachricht an ${targetUser.tag} konnte nicht gesendet werden. Der Nutzer hat Direktnachrichten möglicherweise deaktiviert oder blockiert den Bot.`),
                    ],
                });
            }
            
            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [
                    errorEmbed("Fehler", `Die Direktnachricht konnte nicht gesendet werden: ${error.message}`),
                ],
            });
        }
    }
};
