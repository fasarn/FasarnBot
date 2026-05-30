import { getColor } from '../../config/bot.js';
import { SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder, MessageFlags } from 'discord.js';
import { errorEmbed } from '../../utils/embeds.js';
import { getWelcomeConfig, updateWelcomeConfig } from '../../utils/database.js';
import { formatWelcomeMessage } from '../../utils/welcome.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

export default {
    data: new SlashCommandBuilder()
        .setName('goodbye')
        .setDescription('Konfiguriere das Verabschiedungssystem')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand(subcommand =>
            subcommand
                .setName('setup')
                .setDescription('Richte die Verabschiedungsnachricht ein')
                .addChannelOption(option =>
                    option.setName('channel')
                        .setDescription('Der Kanal, in den Verabschiedungsnachrichten gesendet werden')
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('message')
                        .setDescription('Verabschiedungsnachricht. Variablen: {user}, {username}, {server}, {memberCount}')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('image')
                        .setDescription('URL des Bildes, das in der Verabschiedungsnachricht angezeigt werden soll')
                        .setRequired(false))
                .addBooleanOption(option =>
                    option.setName('ping')
                        .setDescription('Ob der Nutzer in der Verabschiedungsnachricht gepingt werden soll')
                        .setRequired(false))),

    async execute(interaction) {
        const deferSuccess = await InteractionHelper.safeDefer(interaction);

        if (!deferSuccess) {
            logger.warn(`Goodbye interaction defer failed`, {
                userId: interaction.user.id,
                guildId: interaction.guildId,
                commandName: 'goodbye'
            });

            return;
        }

        const { options, guild, client } = interaction;

        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {

            return await InteractionHelper.safeEditReply(
                interaction,
                {
                    embeds: [
                        errorEmbed(
                            'Fehlende Berechtigungen',
                            'Du benötigst die Berechtigung **Server verwalten**, um `/goodbye` zu verwenden.'
                        )
                    ],

                    flags:
                        MessageFlags.Ephemeral
                }
            );
        }

        const subcommand =
            options.getSubcommand();

        if (subcommand === 'setup') {

            const channel =
                options.getChannel('channel');

            const message =
                options.getString('message');

            const image =
                options.getString('image');

            const ping =
                options.getBoolean('ping') ?? false;

            const existingConfig =
                await getWelcomeConfig(
                    client,
                    guild.id
                );

            if (existingConfig?.goodbyeChannelId) {

                logger.info(
                    `[Goodbye] Setup blocked because config already exists in channel ${existingConfig.goodbyeChannelId} for guild ${guild.id}`
                );

                return await InteractionHelper.safeEditReply(
                    interaction,
                    {
                        embeds: [
                            errorEmbed(
                                'Verabschiedungssystem bereits eingerichtet',
                                `Verabschiedungen sind bereits für <#${existingConfig.goodbyeChannelId}> eingerichtet. Nutze **/goodbye config**, um Kanal, Nachricht, Ping oder Bild anzupassen.`
                            )
                        ],

                        flags:
                            MessageFlags.Ephemeral
                    }
                );
            }

            if (
                !message ||
                message.trim().length === 0
            ) {

                logger.warn(
                    `[Goodbye] Empty message provided by ${interaction.user.tag} in ${guild.name}`
                );

                return await InteractionHelper.safeEditReply(
                    interaction,
                    {
                        embeds: [
                            errorEmbed(
                                'Ungültige Eingabe',
                                'Die Verabschiedungsnachricht darf nicht leer sein'
                            )
                        ],

                        flags:
                            MessageFlags.Ephemeral
                    }
                );
            }

            if (image) {

                try {

                    new URL(
                        image
                    );

                } catch (e) {

                    logger.warn(
                        `[Goodbye] Invalid image URL provided by ${interaction.user.tag}: ${image}`
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
                        goodbyeEnabled: true,
                        goodbyeChannelId: channel.id,
                        leaveMessage: message,
                        goodbyePing: ping,

                        leaveEmbed: {

                            title:
                                "Auf Wiedersehen {user.tag}",

                            description:
                                message,

                            color:
                                getColor(
                                    'error'
                                ),

                            footer:
                                `Auf Wiedersehen von ${guild.name}!`,

                            ...(image && {
                                image: {
                                    url:
                                        image
                                }
                            })
                        }
                    }
                );

                logger.info(
                    `[Goodbye] Setup configured by ${interaction.user.tag} for guild ${guild.name} (${guild.id})`
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
                            '✅ Verabschiedungssystem eingerichtet'
                        )

                        .setDescription(
                            `Verabschiedungsnachrichten werden nun in ${channel} gesendet`
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
                                'Tipp: Nutze /goodbye config um die Einstellungen anzupassen'
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
                    `[Goodbye] Failed to setup goodbye system for guild ${guild.id}:`,
                    error
                );

                await InteractionHelper.safeEditReply(
                    interaction,
                    {
                        embeds: [
                            errorEmbed(
                                'Einrichtung fehlgeschlagen',
                                'Beim Konfigurieren des Verabschiedungssystems ist ein Fehler aufgetreten. Bitte versuche es erneut.',
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
