import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { errorEmbed, infoEmbed, successEmbed } from '../../utils/embeds.js';
import { withErrorHandling } from '../../utils/errorHandler.js';
import { verifyUser } from '../../services/verificationService.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

export default {
    data: new SlashCommandBuilder()
        .setName('verify')
        .setDescription('Verifiziere dich selbst, um Zugriff auf den Server zu erhalten'),

    async execute(interaction, config, client) {
        const wrappedExecute = withErrorHandling(async () => {
            const guild = interaction.guild;

            const result = await verifyUser(client, guild.id, interaction.user.id, {
                source: 'command_self',
                moderatorId: null
            });

            if (!result.success) {
                if (result.alreadyVerified) {
                    return await InteractionHelper.safeReply(interaction, {
                        embeds: [infoEmbed("Bereits verifiziert", "Du bist bereits verifiziert.")],
                        flags: MessageFlags.Ephemeral
                    });
                }

                return await InteractionHelper.safeReply(interaction, {
                    embeds: [errorEmbed(
                        "Verifizierung fehlgeschlagen",
                        "Während der Verifizierung ist ein Fehler aufgetreten. Bitte versuche es erneut oder kontaktiere einen Administrator."
                    )],
                    flags: MessageFlags.Ephemeral
                });
            }

            await InteractionHelper.safeReply(interaction, {
                embeds: [successEmbed(
                    "Verifizierung abgeschlossen",
                    `Du wurdest erfolgreich verifiziert und hast die Rolle **${result.roleName}** erhalten! Willkommen auf dem Server! 🎉`
                )],
                flags: MessageFlags.Ephemeral
            });
        }, { command: 'verify' });

        return await wrappedExecute(interaction, config, client);
    }
};
