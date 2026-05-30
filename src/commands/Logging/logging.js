import { SlashCommandBuilder, PermissionFlagsBits, ChannelType } from 'discord.js';
import { errorEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

import dashboard from './modules/logging_dashboard.js';
import setchannel from './modules/logging_setchannel.js';
import filter from './modules/logging_filter.js';

export default {
    data: new SlashCommandBuilder()
        .setName('logging')
        .setDescription('Verwaltet die Audit-Protokollierung für diesen Server.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .setDMPermission(false)
        .addSubcommand((subcommand) =>
            subcommand
                .setName('dashboard')
                .setDescription('Öffnet das interaktive Logging-Dashboard — Status ansehen und Kategorien umschalten.'),
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName('setchannel')
                .setDescription('Legt den Kanal für das Audit-Protokoll auf diesem Server fest.')
                .addChannelOption((option) =>
                    option
                        .setName('channel')
                        .setDescription('Der Textkanal für die Audit-Logs.')
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(false),
                )
                .addBooleanOption((option) =>
                    option
                        .setName('disable')
                        .setDescription('Auf True setzen, um die Audit-Protokollierung vollständig zu deaktivieren.')
                        .setRequired(false),
                ),
        )
        .addSubcommandGroup((group) =>
            group
                .setName('filter')
                .setDescription('Verwaltet die Ignorierliste für Logs (Nutzer und Kanäle überspringen).')
                .addSubcommand((subcommand) =>
                    subcommand
                        .setName('add')
                        .setDescription('Fügt einen Nutzer oder Kanal zur Ignorierliste hinzu.')
                        .addStringOption((option) =>
                            option
                                .setName('type')
                                .setDescription('Gibt an, ob ein Nutzer oder ein Kanal ignoriert werden soll.')
                                .setRequired(true)
                                .addChoices(
                                    { name: 'Nutzer', value: 'user' },
                                    { name: 'Kanal', value: 'channel' },
                                ),
                        )
                        .addStringOption((option) =>
                            option
                                .setName('id')
                                .setDescription('Die ID des zu ignorierenden Nutzers oder Kanals.')
                                .setRequired(true),
                        ),
                )
                .addSubcommand((subcommand) =>
                    subcommand
                        .setName('remove')
                        .setDescription('Entfernt einen Nutzer oder Kanal von der Ignorierliste.')
                        .addStringOption((option) =>
                            option
                                .setName('type')
                                .setDescription('Gibt an, ob es sich um einen Nutzer oder Kanal handelt.')
                                .setRequired(true)
                                .addChoices(
                                    { name: 'Nutzer', value: 'user' },
                                    { name: 'Kanal', value: 'channel' },
                                ),
                        )
                        .addStringOption((option) =>
                            option
                                .setName('id')
                                .setDescription('Die ID des Nutzers oder Kanals, der von der Liste entfernt werden soll.')
                                .setRequired(true),
                        ),
                ),
        ),

    async execute(interaction, config, client) {
        try {
            // setchannel und filter benötigen beide ein safeDefer, bevor ihre Logik ausgeführt wird
            const subcommandGroup = interaction.options.getSubcommandGroup(false);
            const subcommand = interaction.options.getSubcommand();

            if (subcommand === 'dashboard') {
                return await dashboard.execute(interaction, config, client);
            }

            await InteractionHelper.safeDefer(interaction);

            if (subcommand === 'setchannel') {
                return await setchannel.execute(interaction, config, client);
            }

            if (subcommandGroup === 'filter') {
                return await filter.execute(interaction, config, client);
            }

            await InteractionHelper.safeEditReply(interaction, {
                embeds: [errorEmbed('Unbekannter Unterbefehl', 'Dieser Unterbefehl wurde nicht erkannt.')],
            });
        } catch (error) {
            logger.error('logging command error:', error);
            await InteractionHelper.safeReply(interaction, {
                embeds: [errorEmbed('Fehler', 'Ein unerwarteter Fehler ist aufgetreten.')],
                ephemeral: true,
            }).catch(() => {});
        }
    },
};
