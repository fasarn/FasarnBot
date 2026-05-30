import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { createEmbed, errorEmbed, successEmbed, infoEmbed, warningEmbed } from '../../utils/embeds.js';
import { logEvent } from '../../utils/moderation.js';
import { logger } from '../../utils/logger.js';
import { getColor } from '../../config/bot.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

export default {
    data: new SlashCommandBuilder()
        .setName("unlock")
        .setDescription("Entsperrt den aktuellen Kanal (erlaubt es @everyone wieder, Nachrichten zu senden).")
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
    category: "moderation",

    async execute(interaction, config, client) {
        const deferSuccess = await InteractionHelper.safeDefer(interaction);
        if (!deferSuccess) {
            logger.warn(`Unlock interaction defer failed`, {
                userId: interaction.user.id,
                guildId: interaction.guildId,
                commandName: 'unlock'
            });
            return;
        }

        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [
                    errorEmbed(
                        "Berechtigung verweigert",
                        "Du benötigst die Berechtigung `Kanäle verwalten`, um Kanäle zu entsperren.",
                    ),
                ],
            });
        }

        const channel = interaction.channel;
        const everyoneRole = interaction.guild.roles.everyone;

        try {
            const currentPermissions = channel.permissionsFor(everyoneRole);
            if (
                currentPermissions.has(PermissionFlagsBits.SendMessages) === true ||
                currentPermissions.has(PermissionFlagsBits.SendMessages) === null
            ) {
                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [
                        errorEmbed(
                            "Kanal bereits entsperrt",
                            `${channel} ist nicht explizit gesperrt (jeder kann hier bereits Nachrichten senden).`,
                        ),
                    ],
                });
            }

            await channel.permissionOverwrites.edit(
                everyoneRole,
                { SendMessages: true },
                {
                    type: 0,
                    reason: `Kanal entsperrt von ${interaction.user.tag}`,
                },
            );

            const unlockEmbed = createEmbed(
                "🔓 Kanal entsperrt (Aktionsprotokoll)",
                `${channel} wurde von ${interaction.user} entsperrt.`,
            )
                .setColor(getColor('success'))
                .addFields(
                    {
                        name: "Kanal",
                        value: channel.toString(),
                        inline: true,
                    },
                    {
                        name: "Moderator",
                        value: `${interaction.user.tag} (${interaction.user.id})`,
                        inline: true,
                    },
                );

            await logEvent({
                client,
                guild: interaction.guild,
                event: {
                    action: "Channel Unlocked",
                    target: channel.toString(),
                    executor: `${interaction.user.tag} (${interaction.user.id})`,
                    metadata: {
                        channelId: channel.id,
                        category: channel.parent?.name || 'None'
                    }
                }
            });

            await InteractionHelper.safeEditReply(interaction, {
                embeds: [
                    successEmbed(
                        `🔓 **Kanal entsperrt**`,
                        `${channel} ist nun wieder entsperrt. Textnachrichten können wieder gesendet werden.`,
                    ),
                ],
            });
        } catch (error) {
            logger.error('Unlock command error:', error);
            await InteractionHelper.safeEditReply(interaction, {
                embeds: [
                    errorEmbed(
                        "Ein unerwarteter Fehler ist beim Entsperren des Kanals aufgetreten. Bitte überprüfe meine Berechtigungen (ich benötige `Kanäle verwalten`).",
                    ),
                ],
            });
        }
    }
};
