import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { errorEmbed } from '../../utils/embeds.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { logger } from '../../utils/logger.js';
import { handleInteractionError, TitanBotError } from '../../utils/errorHandler.js';
import greetDashboard from './modules/greet_dashboard.js';

export default {
    data: new SlashCommandBuilder()
        .setName('greet')
        .setDescription('Verwalte Willkommens- & Verabschiedungseinstellungen')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand(subcommand =>
            subcommand
                .setName('dashboard')
                .setDescription('Öffne das Konfigurationsdashboard für Willkommen & Verabschiedung'),
        ),

    async execute(interaction, config, client) {
        try {

            if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {

                return await InteractionHelper.safeReply(
                    interaction,
                    {
                        embeds: [
                            errorEmbed(
                                'Fehlende Berechtigungen',
                                'Du benötigst die Berechtigung **Server verwalten**, um `/greet` zu verwenden.',
                            ),
                        ],

                        flags:
                            MessageFlags.Ephemeral,
                    }
                );
            }

            const subcommand =
                interaction.options.getSubcommand();

            switch (subcommand) {

                case 'dashboard':

                    return await greetDashboard.execute(
                        interaction,
                        config,
                        client
                    );

                default:

                    logger.warn(
                        `Unknown /greet subcommand: ${subcommand}`
                    );
            }

        } catch (error) {

            if (
                error instanceof TitanBotError
            ) {

                return await InteractionHelper.safeReply(
                    interaction,
                    {
                        embeds: [
                            errorEmbed(
                                'Konfigurationsfehler',
                                error.userMessage ||
                                'Etwas ist schiefgelaufen.'
                            ),
                        ],

                        flags:
                            MessageFlags.Ephemeral,
                    }
                );
            }

            await handleInteractionError(
                interaction,
                error,
                {
                    command:
                        'greet'
                }
            );
        }
    },
};
