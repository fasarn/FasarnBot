import { getColor } from '../../config/bot.js';
import { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } from 'discord.js';
import { createEmbed, errorEmbed } from '../../utils/embeds.js';
import { getLevelingConfig, saveLevelingConfig } from '../../services/leveling.js';
import { botHasPermission } from '../../utils/permissionGuard.js';
import { TitanBotError, ErrorTypes, handleInteractionError } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { logger } from '../../utils/logger.js';
import levelDashboard from './modules/level_dashboard.js';

export default {
    data: new SlashCommandBuilder()
        .setName('level')
        .setDescription('Verwaltet das Level-System')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .setDMPermission(false)
        .addSubcommand((subcommand) =>
            subcommand
                .setName('setup')
                .setDescription('Richtete das Level-System ein — dies aktiviert es auch')
                .addChannelOption((option) =>
                    option
                        .setName('channel')
                        .setDescription('Kanal, in dem Level-Up-Benachrichtigungen gesendet werden')
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(true),
                )
                .addIntegerOption((option) =>
                    option
                        .setName('xp_min')
                        .setDescription('Minimale XP-Zuweisung pro Nachricht (Standard: 15)')
                        .setMinValue(1)
                        .setMaxValue(500)
                        .setRequired(false),
                )
                .addIntegerOption((option) =>
                    option
                        .setName('xp_max')
                        .setDescription('Maximale XP-Zuweisung pro Nachricht (Standard: 25)')
                        .setMinValue(1)
                        .setMaxValue(500)
                        .setRequired(false),
                )
                .addStringOption((option) =>
                    option
                        .setName('message')
                        .setDescription(
                            'Level-Up-Nachricht. Verwende {user} und {level} als Platzhalter (Standard vorhanden)',
                        )
                        .setMaxLength(500)
                        .setRequired(false),
                )
                .addIntegerOption((option) =>
                    option
                        .setName('xp_cooldown')
                        .setDescription('Sekunden zwischen XP-Zuweisungen pro Benutzer (Standard: 60)')
                        .setMinValue(0)
                        .setMaxValue(3600)
                        .setRequired(false),
                ),
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName('dashboard')
                .setDescription('Öffnet das interaktive Dashboard zur Level-Konfiguration'),
        ),
    category: 'Leveling',

    async execute(interaction, config, client) {
        try {
            const deferred = await InteractionHelper.safeDefer(interaction, {
                flags: MessageFlags.Ephemeral,
            });
            if (!deferred) return;

            if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [
                        errorEmbed(
                            'Fehlende Berechtigungen',
                            'Du benötigst die Berechtigung **Server verwalten**, um diesen Befehl auszuführen.',
                        ),
                    ],
                });
            }

            const subcommand = interaction.options.getSubcommand();

            if (subcommand === 'dashboard') {
                return levelDashboard.execute(interaction, config, client);
            }

            if (subcommand === 'setup') {
                const channel = interaction.options.getChannel('channel');
                const xpMin = interaction.options.getInteger('xp_min') ?? 15;
                const xpMax = interaction.options.getInteger('xp_max') ?? 25;
                const message =
                    interaction.options.getString('message') ??
                    '{user} hat Level {level} erreicht!';
                const xpCooldown = interaction.options.getInteger('xp_cooldown') ?? 60;

                if (xpMin > xpMax) {
                    return await InteractionHelper.safeEditReply(interaction, {
                        embeds: [
                            errorEmbed(
                                'Ungültiger XP-Bereich',
                                `Die minimale XP (**${xpMin}**) darf nicht größer als die maximale XP (**${xpMax}**) sein.`,
                            ),
                        ],
                    });
                }

                if (!botHasPermission(channel, ['SendMessages', 'EmbedLinks'])) {
                    throw new TitanBotError(
                        'Bot missing permissions in the specified channel',
                        ErrorTypes.PERMISSION,
                        `Ich benötige die Berechtigungen **Nachrichten senden** und **Links einbetten** in ${channel}, um Level-Up-Benachrichtigungen zu senden.`,
                    );
                }

                const existingConfig = await getLevelingConfig(client, interaction.guildId);

                if (existingConfig.configured) {
                    return await InteractionHelper.safeEditReply(interaction, {
                        embeds: [
                            errorEmbed(
                                'Level-System bereits aktiv',
                                `Das Level-System ist auf diesem Server bereits eingerichtet (Level-Up-Benachrichtigungen werden an <#${existingConfig.levelUpChannel}> gesendet).\n\nNutze \`/level dashboard\`, um Einstellungen anzupassen.`,
                            ),
                        ],
                    });
                }

                const newConfig = {
                    ...existingConfig,
                    configured: true,
                    enabled: true,
                    levelUpChannel: channel.id,
                    xpRange: { min: xpMin, max: xpMax },
                    xpCooldown: xpCooldown,
                    levelUpMessage: message,
                    announceLevelUp: true,
                };

                await saveLevelingConfig(client, interaction.guildId, newConfig);

                logger.info(`Leveling system set up in guild ${interaction.guildId}`, {
                    channelId: channel.id,
                    xpMin,
                    xpMax,
                    xpCooldown,
                    userId: interaction.user.id,
                });

                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [
                        createEmbed({
                            title: '✅ Level-System eingerichtet',
                            description:
                                `Das Level-System ist nun **aktiviert** und einsatzbereit.\n\n` +
                                `**Level-Up-Kanal:** ${channel}\n` +
                                `**XP pro Nachricht:** ${xpMin} – ${xpMax}\n` +
                                `**XP-Abklingzeit:** ${xpCooldown}s\n` +
                                `**Level-Up-Nachricht:** \`${message}\`\n\n` +
                                `Nutze jederzeit \`/level dashboard\`, um diese Einstellungen anzupassen.`,
                            color: 'success',
                        }),
                    ],
                });
            }
        } catch (error) {
            logger.error('Level command error:', error);
            await handleInteractionError(interaction, error, {
                type: 'command',
                commandName: 'level',
            });
        }
    },
};
