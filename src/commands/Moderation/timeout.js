import { SlashCommandBuilder, PermissionFlagsBits, PermissionsBitField, ChannelType } from 'discord.js';
import { createEmbed, errorEmbed, successEmbed, infoEmbed, warningEmbed } from '../../utils/embeds.js';
import { logModerationAction } from '../../utils/moderation.js';
import { logger } from '../../utils/logger.js';
import { TitanBotError, ErrorTypes } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

const durationChoices = [
    { name: "5 Minuten", value: 5 },
    { name: "10 Minuten", value: 10 },
    { name: "30 Minuten", value: 30 },
    { name: "1 Stunde", value: 60 },
    { name: "6 Stunden", value: 360 },
    { name: "1 Tag", value: 1440 },
    { name: "1 Woche", value: 10080 },
];

export default {
    data: new SlashCommandBuilder()
        .setName("timeout")
        .setDescription("Verhängt ein Timeout (Stummschaltung) gegen einen Nutzer für eine bestimmte Zeit.")
        .addUserOption((option) =>
            option
                .setName("target")
                .setDescription("Der stummzuschaltende Nutzer")
                .setRequired(true),
        )
        .addIntegerOption(
            (option) =>
                option
                    .setName("duration")
                    .setDescription("Dauer des Timeouts")
                    .setRequired(true)
                    .addChoices(...durationChoices),
        )
        .addStringOption((option) =>
            option.setName("reason").setDescription("Grund für das Timeout"),
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
    category: "moderation",

    async execute(interaction, config, client) {
        const deferSuccess = await InteractionHelper.safeDefer(interaction);
        if (!deferSuccess) {
            logger.warn(`Timeout interaction defer failed`, {
                userId: interaction.user.id,
                guildId: interaction.guildId,
                commandName: 'timeout'
            });
            return;
        }

        try {
            if (!interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
                throw new TitanBotError(
                    "User lacks permission",
                    ErrorTypes.PERMISSION,
                    "Du benötigst die Berechtigung `Mitglieder moderieren`, um ein Timeout zu verhängen."
                );
            }

            const targetUser = interaction.options.getUser("target");
            const member = interaction.options.getMember("target");
            const durationMinutes = interaction.options.getInteger("duration");
            const reason = interaction.options.getString("reason") || "Kein Grund angegeben";

            if (targetUser.id === interaction.user.id) {
                throw new TitanBotError(
                    "Cannot timeout self",
                    ErrorTypes.VALIDATION,
                    "Du kannst dir nicht selbst ein Timeout geben."
                );
            }
            if (targetUser.id === client.user.id) {
                throw new TitanBotError(
                    "Cannot timeout bot",
                    ErrorTypes.VALIDATION,
                    "Du kannst dem Bot kein Timeout geben."
                );
            }
            if (!member) {
                throw new TitanBotError(
                    "Target not found",
                    ErrorTypes.USER_INPUT,
                    "Der Zielnutzer befindet sich derzeit nicht auf diesem Server."
                );
            }

            if (!member.moderatable) {
                throw new TitanBotError(
                    "Cannot timeout member",
                    ErrorTypes.PERMISSION,
                    "Ich kann dieses Mitglied nicht stummschalten. Der Nutzer hat möglicherweise eine höhere Rolle als ich oder du."
                );
            }

            const durationMs = durationMinutes * 60 * 1000;
            await member.timeout(durationMs, reason);

            const durationDisplay =
                durationChoices.find((c) => c.value === durationMinutes)
                    ?.name || `${durationMinutes} Minuten`;

            const caseId = await logModerationAction({
                client,
                guild: interaction.guild,
                event: {
                    action: "Member Timed Out",
                    target: `${targetUser.tag} (${targetUser.id})`,
                    executor: `${interaction.user.tag} (${interaction.user.id})`,
                    reason: `${reason}\nDuration: ${durationDisplay}`,
                    duration: durationDisplay,
                    metadata: {
                        userId: targetUser.id,
                        moderatorId: interaction.user.id,
                        durationMinutes,
                        timeoutEnds: new Date(Date.now() + durationMs).toISOString()
                    }
                }
            });

            await InteractionHelper.safeEditReply(interaction, {
                embeds: [
                    successEmbed(
                        `⏳ **Timeout verhängt gegen** ${targetUser.tag} für ${durationDisplay}.`,
                        `**Grund:** ${reason}\n**Fall-ID:** #${caseId}`,
                    ),
                ],
            });
        } catch (error) {
            logger.error('Timeout command error:', error);
            await InteractionHelper.safeEditReply(interaction, {
                embeds: [
                    errorEmbed(
                        error.userMessage || "Ein unerwarteter Fehler ist beim Verhängen des Timeouts aufgetreten. Bitte überprüfe meine Rollenberechtigungen.",
                    ),
                ],
            });
        }
    }
};
