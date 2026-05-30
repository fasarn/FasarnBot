import { SlashCommandBuilder, PermissionFlagsBits, PermissionsBitField, ChannelType } from 'discord.js';
import { createEmbed, errorEmbed, successEmbed, infoEmbed, warningEmbed } from '../../utils/embeds.js';
import { logModerationAction } from '../../utils/moderation.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { TitanBotError, ErrorTypes } from '../../utils/errorHandler.js';

export default {
    data: new SlashCommandBuilder()
        .setName("kick")
        .setDescription("Wirft einen Nutzer vom Server (Kick)")
        .addUserOption((option) =>
            option
                .setName("target")
                .setDescription("Der zu werfende Nutzer")
                .setRequired(true),
        )
        .addStringOption((option) =>
            option
                .setName("reason")
                .setDescription("Grund für den Kick"),
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),
    category: "moderation",

    async execute(interaction, config, client) {
        try {
            
            if (!interaction.member.permissions.has(PermissionFlagsBits.KickMembers)) {
                throw new TitanBotError(
                    "User lacks permission",
                    ErrorTypes.PERMISSION,
                    "Du hast keine Berechtigung, um Mitglieder vom Server zu werfen."
                );
            }

            const targetUser = interaction.options.getUser("target");
            const member = interaction.options.getMember("target");
            const reason = interaction.options.getString("reason") || "Kein Grund angegeben";

            
            if (targetUser.id === interaction.user.id) {
                throw new TitanBotError(
                    "Cannot kick self",
                    ErrorTypes.VALIDATION,
                    "Du kannst dich nicht selbst vom Server werfen."
                );
            }

            
            if (targetUser.id === client.user.id) {
                throw new TitanBotError(
                    "Cannot kick bot",
                    ErrorTypes.VALIDATION,
                    "Du kannst den Bot nicht vom Server werfen."
                );
            }

            
            if (!member) {
                throw new TitanBotError(
                    "Target not found",
                    ErrorTypes.USER_INPUT,
                    "Der Zielnutzer befindet sich derzeit nicht auf diesem Server.",
                    { subtype: 'user_not_found' }
                );
            }

            
            if (interaction.member.roles.highest.position <= member.roles.highest.position) {
                throw new TitanBotError(
                    "Cannot kick user",
                    ErrorTypes.PERMISSION,
                    "Du kannst keine Nutzer werfen, die eine gleichwertige oder höhere Rolle als du haben."
                );
            }

            
            if (!member.kickable) {
                throw new TitanBotError(
                    "Bot cannot kick",
                    ErrorTypes.PERMISSION,
                    "Ich kann diesen Nutzer nicht werfen. Bitte überprüfe die Position meiner Rolle im Vergleich zum Zielnutzer."
                );
            }

            
            await member.kick(reason);

            
            const caseId = await logModerationAction({
                client,
                guild: interaction.guild,
                event: {
                    action: "Member Kicked",
                    target: `${targetUser.tag} (${targetUser.id})`,
                    executor: `${interaction.user.tag} (${interaction.user.id})`,
                    reason,
                    metadata: {
                        userId: targetUser.id,
                        moderatorId: interaction.user.id
                    }
                }
            });

            
            await InteractionHelper.universalReply(interaction, {
                embeds: [
                    successEmbed(
                        `👢 **Gekickt:** ${targetUser.tag}`,
                        `**Grund:** ${reason}\n**Fall-ID:** #${caseId}`,
                    ),
                ],
            });
        } catch (error) {
            logger.error('Kick command error:', error);
            const errorEmbed_default = errorEmbed(
                "Ein unerwarteter Fehler ist beim Kicken des Nutzers aufgetreten.",
                error.message || "Der Nutzer konnte nicht geworfen werden."
            );
            await InteractionHelper.universalReply(interaction, { embeds: [errorEmbed_default] });
        }
    }
};
