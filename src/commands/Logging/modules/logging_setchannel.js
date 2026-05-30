import { PermissionsBitField, ChannelType } from 'discord.js';
import { errorEmbed, successEmbed } from '../../../utils/embeds.js';
import { getGuildConfig, setGuildConfig } from '../../../services/guildConfig.js';
import { logEvent } from '../../../utils/moderation.js';
import { InteractionHelper } from '../../../utils/interactionHelper.js';
import { logger } from '../../../utils/logger.js';

export default {
    async execute(interaction, config, client) {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return InteractionHelper.safeReply(interaction, {
                embeds: [errorEmbed('Berechtigung verweigert', 'Du benötigst die Berechtigung **Administrator**, um die Log-Kanäle zu ändern.')],
            });
        }

        if (!client.db) {
            return InteractionHelper.safeEditReply(interaction, {
                embeds: [errorEmbed('Datenbankfehler', 'Die Datenbank wurde nicht initialisiert.')],
            });
        }

        const guildId = interaction.guildId;
        const currentConfig = await getGuildConfig(client, guildId);

        const logChannel = interaction.options.getChannel('channel');
        const disableLogging = interaction.options.getBoolean('disable');

        try {
            if (disableLogging) {
                currentConfig.logChannelId = null;
                currentConfig.enableLogging = false;
                currentConfig.logging = {
                    ...(currentConfig.logging || {}),
                    enabled: false,
                    channelId: null,
                };
                await setGuildConfig(client, guildId, currentConfig);
                return InteractionHelper.safeEditReply(interaction, {
                    embeds: [successEmbed('Logging deaktiviert 🚫', 'Die Audit-Protokollierung wurde für diesen Server deaktiviert.')],
                });
            }

            if (logChannel) {
                const perms = logChannel.permissionsFor(interaction.guild.members.me);
                if (!perms.has(PermissionsBitField.Flags.SendMessages) || !perms.has(PermissionsBitField.Flags.EmbedLinks)) {
                    return InteractionHelper.safeEditReply(interaction, {
                        embeds: [errorEmbed('Bot-Berechtigungsfehler', `Ich benötige die Berechtigungen **Nachrichten senden** und **Links einbetten** in ${logChannel}.`)],
                    });
                }

                currentConfig.logChannelId = logChannel.id;
                currentConfig.enableLogging = true;
                currentConfig.logging = {
                    ...(currentConfig.logging || {}),
                    enabled: true,
                    channelId: logChannel.id,
                };
                await setGuildConfig(client, guildId, currentConfig);

                await InteractionHelper.safeEditReply(interaction, {
                    embeds: [successEmbed('Log-Kanal festgelegt 📝', `Audit-Logs werden ab sofort in ${logChannel} gesendet.`)],
                });

                await logEvent({
                    client,
                    guild: interaction.guild,
                    event: {
                        action: 'Log Channel Activated',
                        target: logChannel.toString(),
                        executor: `${interaction.user.tag} (${interaction.user.id})`,
                        reason: `Logging channel set by ${interaction.user}`,
                        metadata: { channelId: logChannel.id, moderatorId: interaction.user.id, loggingEnabled: true },
                    },
                });
                return;
            }

            return InteractionHelper.safeEditReply(interaction, {
                embeds: [errorEmbed('Keine Option angegeben', 'Bitte gib eine der folgenden Optionen an: `channel` oder `disable: True`.\n\n> Kanäle für Ticket-Transkripte und Ticket-Logs werden über `/ticket setup` oder `/ticket dashboard` verwaltet.')],
            });
        } catch (error) {
            logger.error('logging setchannel error:', error);
            await InteractionHelper.safeEditReply(interaction, {
                embeds: [errorEmbed('Konfigurationsfehler', 'Die Konfiguration konnte nicht gespeichert werden.')],
            });
        }
    },
};
