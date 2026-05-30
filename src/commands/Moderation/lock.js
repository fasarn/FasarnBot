import { SlashCommandBuilder, PermissionFlagsBits, PermissionsBitField, ChannelType } from 'discord.js';
import { createEmbed, errorEmbed, successEmbed, infoEmbed, warningEmbed } from '../../utils/embeds.js';
import { logEvent } from '../../utils/moderation.js';
import { logger } from '../../utils/logger.js';
import { getColor } from '../../config/bot.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

export default {
    data: new SlashCommandBuilder()
        .setName("lock")
        .setDescription(
            "Sperrt den aktuellen Kanal (verhindert, dass @everyone Nachrichten senden kann).",
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
    category: "moderation",

    async execute(interaction, config, client) {
        const deferSuccess = await InteractionHelper.safeDefer(interaction);
        if (!deferSuccess) {
            logger.warn(`Lock interaction defer failed`, {
                userId: interaction.user.id,
                guildId: interaction.guildId,
                commandName: 'lock'
            });
            return;
        }

        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [
                    errorEmbed(
                        "Berechtigung verweigert",
                        "Du benötigst die Berechtigung `Kanäle verwalten`, um Kanäle zu sperren.",
                    ),
                ],
            });
        }

        const channel = interaction.channel;
        const everyoneRole = interaction.guild.roles.everyone;

        try {
            const currentPermissions = channel.permissionsFor(everyoneRole);
            if (currentPermissions.has(PermissionFlagsBits.SendMessages) === false) {
                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [
                        errorEmbed(
                            "Kanal bereits gesperrt",
                            `${channel} ist bereits gesperrt.`,
                        ),
                    ],
                });
            }

            await channel.permissionOverwrites.edit(
                everyoneRole,
                { SendMessages: false },
                { type: 0, reason: `Kanal gesperrt von ${interaction.user.tag}` },
            );

            const lockEmbed = createEmbed(
                "🔒 Kanal gesperrt (Aktionsprotokoll)",
                `${channel} wurde von ${interaction.user} gesperrt.`,
            )
                .setColor(getColor('moderation'))
                .addFields(
                    { name: "Kanal", value: channel.toString(), inline: true },
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
                    action: "Channel Locked",
                    target: channel.toString(),
                    executor: `${interaction.user.tag} (${interaction.user.id})`,
                    metadata: {
                        channelId: channel.id,
                        category: channel.parent?.name || 'Keine',
                        moderatorId: interaction.user.id
                    }
                }
            });

            await InteractionHelper.safeEditReply(interaction, {
                embeds: [
                    successEmbed(
                        `🔒 **Kanal gesperrt**`,
                        `${channel} ist jetzt gesperrt. Hier kann vorerst niemand mehr schreiben.`,
                    ),
                ],
            });
        } catch (error) {
            logger.error('Lock command error:', error);
            await InteractionHelper.safeEditReply(interaction, {
                embeds: [
                    errorEmbed(
                        "Ein unerwarteter Fehler ist aufgetreten. Bitte überprüfe meine Berechtigungen (ich benötige `Kanäle verwalten`).",
                    ),
                ],
            });
        }
    }
};
