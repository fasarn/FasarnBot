import { getColor } from '../../config/bot.js';
import { SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder, MessageFlags } from 'discord.js';
import { errorEmbed } from '../../utils/embeds.js';
import { getWelcomeConfig, updateWelcomeConfig } from '../../utils/database.js';
import { formatWelcomeMessage } from '../../utils/welcome.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

export default {
    data: new SlashCommandBuilder()
        .setName('welcome')
        .setDescription('Konfiguriere das Willkommenssystem')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand(subcommand =>
            subcommand
                .setName('setup')
                .setDescription('Richte die Willkommensnachricht ein')
                .addChannelOption(option =>
                    option.setName('channel')
                        .setDescription('Der Kanal, in den Willkommensnachrichten gesendet werden')
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('message')
                        .setDescription('Willkommensnachricht. Variablen: {user}, {username}, {server}, {memberCount}')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('image')
                        .setDescription('URL des Bildes, das in der Willkommensnachricht angezeigt werden soll')
                        .setRequired(false))
                .addBooleanOption(option =>
                    option.setName('ping')
                        .setDescription('Ob der Nutzer in der Willkommensnachricht gepingt werden soll')
                        .setRequired(false))),

    async execute(interaction) {
        try {
            const deferSuccess = await InteractionHelper.safeDefer(interaction);

            if (!deferSuccess) {
                logger.warn(`Welcome interaction defer failed`, {
                    userId: interaction.user.id,
                    guildId: interaction.guildId,
                    commandName: 'welcome'
                });

                return;
            }
        } catch (deferError) {
            logger.error(`Welcome defer error`, {
                error: deferError.message
            });

            return;
        }

        const { options, guild, client } = interaction;

        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [
                    errorEmbed(
                        'Fehlende Berechtigungen',
                        'Du benötigst die Berechtigung **Server verwalten**, um `/welcome` zu benutzen.'
                    )
                ],
                flags: MessageFlags.Ephemeral
            });
        }

        const subcommand = options.getSubcommand();

        if (subcommand === 'setup') {

            const channel = options.getChannel('channel');
            const message = options.getString('message');
            const image = options.getString('image');
            const ping = options.getBoolean('ping') ?? false;

            const existingConfig =
                await getWelcomeConfig(
                    client,
                    guild.id
                );

            if (existingConfig?.channelId) {

                logger.info(
                    `[Welcome] Setup blocked because config already exists in channel ${existingConfig.channelId} for guild ${guild.id}`
                );

                return await InteractionHelper.safeEditReply(
                    interaction,
                    {
                        embeds: [
                            errorEmbed(
                                'Willkommenssystem bereits eingerichtet',
                                `Willkommen ist bereits für <#${existingConfig.channelId}> eingerichtet. Nutze **/welcome config**, um Kanal, Nachricht, Ping oder Bild anzupassen.`
                            )
                        ],
                        flags:
                            MessageFlags.Ephemeral
                    }
                );
            }

            if (!message || message.trim().length === 0) {

                logger.warn(
                    `[Welcome] Empty message provided by ${interaction.user.tag} in ${guild.name}`
                );

                return await InteractionHelper.safeEditReply(
                    interaction,
                    {
                        embeds: [
                            errorEmbed(
                                'Ungültige Eingabe',
                                'Die Willkommensnachricht darf nicht leer sein'
                            )
                        ],
                        flags:
                            MessageFlags.Ephemeral
                    }
                );
            }

            if (image) {
                try {
                    new URL(image);
                } catch (e) {

                    logger.warn(
                        `[Welcome] Invalid image URL provided by ${interaction.user.tag}: ${image}`
                    );

                    return await InteractionHelper.safeEditReply(
                        interaction,
                        {
                            embeds: [
                                errorEmbed(
                                    'Ungültige Bild URL',
                                    'Bitte gib eine gültige Bild URL an (muss mit http:// oder https:// beginnen)'
                                )
                            ],
                            flags:
                                MessageFlags.Ephemeral
                        }
                    );
                }
            }

            try {

                await updateWelcomeConfig(
                    client,
                    guild.id,
                    {
                        enabled: true,
                        channelId: channel.id,
                        welcomeMessage: message,
                        welcomeImage: image || undefined,
                        welcomePing: ping
                    }
                );

                logger.info(
                    `[Welcome] Setup configured by ${interaction.user.tag} for guild ${guild.name} (${guild.id})`
                );

                const previewMessage =
                    formatWelcomeMessage(
                        message,
                        {
                            user:
                                interaction.user,
                            guild
                        }
                    );

                const embed =
                    new EmbedBuilder()
                        .setColor(
                            getColor(
                                'success'
                            )
                        )

                        .setTitle(
                            '✅ Willkommenssystem eingerichtet'
                        )

                        .setDescription(
                            `Willkommensnachrichten werden nun in ${channel} gesendet`
                        )

                        .addFields(
                            {
                                name:
                                    'Nachrichtenvorschau',
                                value:
                                    previewMessage
                            },
                            {
                                name:
                                    'Nutzer pingen',
                                value:
                                    ping
                                        ? '✅ Ja'
                                        : '❌ Nein'
                            },
                            {
                                name:
                                    'Status',
                                value:
                                    '✅ Aktiviert'
                            }
                        )

                        .setFooter({
                            text:
                                'Tipp: Nutze /welcome config um die Einstellungen anzupassen'
                        });

                if (image) {
                    embed.setImage(
                        image
                    );
                }

                await InteractionHelper.safeEditReply(
                    interaction,
                    {
                        embeds: [
                            embed
                        ]
                    }
                );

            } catch (error) {

                logger.error(
                    `[Welcome] Failed to setup welcome system for guild ${guild.id}:`,
                    error
                );

                await InteractionHelper.safeEditReply(
                    interaction,
                    {
                        embeds: [
                            errorEmbed(
                                'Einrichtung fehlgeschlagen',
                                'Beim Konfigurieren des Willkommenssystems ist ein Fehler aufgetreten. Bitte versuche es erneut.',
                                {
                                    showDetails:
                                        true
                                }
                            )
                        ],
                        flags:
                            MessageFlags.Ephemeral
                    }
                );
            }
        }
    },
};
