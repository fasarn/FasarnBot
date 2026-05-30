import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { TitanBotError, ErrorTypes, handleInteractionError } from '../../utils/errorHandler.js';
import { getGuildGiveaways, saveGiveaway } from '../../utils/giveaways.js';
import { 
    selectWinners,
    createGiveawayEmbed, 
    createGiveawayButtons 
} from '../../services/giveawayService.js';
import { logEvent, EVENT_TYPES } from '../../services/loggingService.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

export default {
    data: new SlashCommandBuilder()
        .setName("greroll")
        .setDescription("Lost die Gewinner eines beendeten Gewinnspiels neu aus.")
        .addStringOption((option) =>
            option
                .setName("messageid")
                .setDescription("Die Nachrichten-ID des beendeten Gewinnspiels.")
                .setRequired(true),
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    async execute(interaction) {
        try {
            
            if (!interaction.inGuild()) {
                throw new TitanBotError(
                    'Giveaway command used outside guild',
                    ErrorTypes.VALIDATION,
                    'Dieser Befehl kann nur innerhalb eines Servers verwendet werden.',
                    { userId: interaction.user.id }
                );
            }

            
            if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
                throw new TitanBotError(
                    'User lacks ManageGuild permission',
                    ErrorTypes.PERMISSION,
                    "Du benötigst die Berechtigung 'Server verwalten', um ein Gewinnspiel neu auszulosen.",
                    { userId: interaction.user.id, guildId: interaction.guildId }
                );
            }

            logger.info(`Giveaway reroll initiated by ${interaction.user.tag} in guild ${interaction.guildId}`);

            const messageId = interaction.options.getString("messageid");

            
            if (!messageId || !/^\d+$/.test(messageId)) {
                throw new TitanBotError(
                    'Invalid message ID format',
                    ErrorTypes.VALIDATION,
                    'Bitte gib eine gültige Nachrichten-ID an.',
                    { providedId: messageId }
                );
            }

            const giveaways = await getGuildGiveaways(
                interaction.client,
                interaction.guildId,
            );

            
            const giveaway = giveaways.find(g => g.messageId === messageId);

            if (!giveaway) {
                throw new TitanBotError(
                    `Giveaway not found: ${messageId}`,
                    ErrorTypes.VALIDATION,
                    "Es wurde kein Gewinnspiel mit dieser Nachrichten-ID in der Datenbank gefunden.",
                    { messageId, guildId: interaction.guildId }
                );
            }

            
            if (!giveaway.isEnded && !giveaway.ended) {
                throw new TitanBotError(
                    `Giveaway still active: ${messageId}`,
                    ErrorTypes.VALIDATION,
                    "Dieses Gewinnspiel ist noch aktiv. Bitte verwende zuerst `/gend`, um es zu beenden.",
                    { messageId, status: 'active' }
                );
            }

            const participants = giveaway.participants || [];
            
            if (participants.length < giveaway.winnerCount) {
                throw new TitanBotError(
                    `Insufficient participants for reroll: ${participants.length} < ${giveaway.winnerCount}`,
                    ErrorTypes.VALIDATION,
                    "Es gibt nicht genügend Teilnahmen, um die erforderliche Anzahl an Gewinnern auszulosen.",
                    { participantsCount: participants.length, winnersNeeded: giveaway.winnerCount }
                );
            }

            
            const newWinners = selectWinners(
                participants,
                giveaway.winnerCount,
            );

            
            const updatedGiveaway = {
                ...giveaway,
                winnerIds: newWinners,
                rerolledAt: new Date().toISOString(),
                rerolledBy: interaction.user.id
            };

            
            const channel = await interaction.client.channels.fetch(
                giveaway.channelId,
            ).catch(err => {
                logger.warn(`Could not fetch channel ${giveaway.channelId}:`, err.message);
                return null;
            });

            if (!channel || !channel.isTextBased()) {
                
                await saveGiveaway(
                    interaction.client,
                    interaction.guildId,
                    updatedGiveaway,
                );
                
                logger.warn(`Could not find channel for giveaway ${messageId}, but saved new winners to database`);
                
                return InteractionHelper.safeReply(interaction, {
                    embeds: [
                        successEmbed(
                            "Neu-Auslosung abgeschlossen",
                            "Die neuen Gewinner wurden ausgewählt und in der Datenbank gespeichert. Der Kanal für die Bekanntmachung wurde nicht gefunden.",
                        ),
                    ],
                    flags: MessageFlags.Ephemeral,
                });
            }

            
            const message = await channel.messages
                .fetch(messageId)
                .catch(err => {
                    logger.warn(`Could not fetch message ${messageId}:`, err.message);
                    return null;
                });

            if (!message) {
                
                await saveGiveaway(
                    interaction.client,
                    interaction.guildId,
                    updatedGiveaway,
                );

                const winnerMentions = newWinners
                    .map((id) => `<@${id}>`)
                    .join(", ");
                
                
                const existingPingMsg = giveaway.winnerPingMessageId
                    ? await channel.messages.fetch(giveaway.winnerPingMessageId).catch(() => null)
                    : null;
                if (existingPingMsg) {
                    await existingPingMsg.edit({
                        content: `🔄 **GEWINNSPIEL NEU-AUSLOSUNG** 🔄 Neue Gewinner für **${giveaway.prize}**: ${winnerMentions}!`,
                    });
                } else {
                    const newPingMsg = await channel.send({
                        content: `🔄 **GEWINNSPIEL NEU-AUSLOSUNG** 🔄 Neue Gewinner für **${giveaway.prize}**: ${winnerMentions}!`,
                    });
                    updatedGiveaway.winnerPingMessageId = newPingMsg.id;
                }

                logger.info(`Giveaway rerolled (message not found, but announced): ${messageId}`);

                try {
                    await logEvent({
                        client: interaction.client,
                        guildId: interaction.guildId,
                        eventType: EVENT_TYPES.GIVEAWAY_REROLL,
                        data: {
                            description: `Giveaway rerolled: ${giveaway.prize}`,
                            channelId: giveaway.channelId,
                            userId: interaction.user.id,
                            fields: [
                                {
                                    name: '🎁 Gewinn',
                                    value: giveaway.prize || 'Geheimnisvoller Preis!',
                                    inline: true
                                },
                                {
                                    name: '🏆 Neue Gewinner',
                                    value: winnerMentions,
                                    inline: false
                                },
                                {
                                    name: '👥 Teilnahmen gesamt',
                                    value: participants.length.toString(),
                                    inline: true
                                }
                            ]
                        }
                    });
                } catch (logError) {
                    logger.debug('Error logging giveaway reroll:', logError);
                }

                return InteractionHelper.safeReply(interaction, {
                    embeds: [
                        successEmbed(
                            "Neu-Auslosung abgeschlossen",
                            `Die neuen Gewinner wurden in ${channel} bekannt gegeben. (Ursprüngliche Nachricht wurde nicht gefunden).`,
                        ),
                    ],
                    flags: MessageFlags.Ephemeral,
                });
            }

            
            await saveGiveaway(
                interaction.client,
                interaction.guildId,
                updatedGiveaway,
            );

            const newEmbed = createGiveawayEmbed(updatedGiveaway, "reroll", newWinners);
            const newRow = createGiveawayButtons(true);

            await message.edit({
                content: "🔄 **GEWINNSPIEL NEU AUSGELOST** 🔄",
                embeds: [newEmbed],
                components: [newRow],
            });

            const winnerMentions = newWinners
                .map((id) => `<@${id}>`)
                .join(", ");
            
            
            const existingPingMsg = giveaway.winnerPingMessageId
                ? await channel.messages.fetch(giveaway.winnerPingMessageId).catch(() => null)
                : null;
            if (existingPingMsg) {
                await existingPingMsg.edit({
                    content: `🔄 **NEUE GEWINNER** 🔄 HERZLICHEN GLÜCKWUNSCH ${winnerMentions}! Du hast die neue Auslosung für das Gewinnspiel **${giveaway.prize}** gewonnen! Bitte melde dich bei dem Organisator <@${giveaway.hostId}>, um deinen Gewinn einzufordern.`,
                });
            } else {
                const newPingMsg = await channel.send({
                    content: `🔄 **NEUE GEWINNER** 🔄 HERZLICHEN GLÜCKWUNSCH ${winnerMentions}! Du hast die neue Auslosung für das Gewinnspiel **${giveaway.prize}** gewonnen! Bitte melde dich bei dem Organisator <@${giveaway.hostId}>, um deinen Gewinn einzufordern.`,
                });
                updatedGiveaway.winnerPingMessageId = newPingMsg.id;
            }

            logger.info(`Giveaway successfully rerolled: ${messageId} with ${newWinners.length} new winners`);

            try {
                await logEvent({
                    client: interaction.client,
                    guildId: interaction.guildId,
                    eventType: EVENT_TYPES.GIVEAWAY_REROLL,
                    data: {
                        description: `Giveaway rerolled: ${giveaway.prize}`,
                        channelId: giveaway.channelId,
                        userId: interaction.user.id,
                        fields: [
                            {
                                name: '🎁 Gewinn',
                                value: giveaway.prize || 'Geheimnisvoller Preis!',
                                inline: true
                            },
                            {
                                name: '🏆 Neue Gewinner',
                                value: winnerMentions,
                                inline: false
                            },
                            {
                                name: '👥 Teilnahmen gesamt',
                                value: participants.length.toString(),
                                inline: true
                            }
                        ]
                    }
                });
            } catch (logError) {
                logger.debug('Error logging giveaway reroll event:', logError);
            }

            return InteractionHelper.safeReply(interaction, {
                embeds: [
                    successEmbed(
                        "Neu-Auslosung erfolgreich ✅",
                        `Das Gewinnspiel für **${giveaway.prize}** in ${channel} wurde erfolgreich neu ausgelost. Es wurden ${newWinners.length} neue Gewinner ausgewählt.`,
                    ),
                ],
                flags: MessageFlags.Ephemeral,
            });

        } catch (error) {
            logger.error('Error in greroll command:', error);
            await handleInteractionError(interaction, error, {
                type: 'command',
                commandName: 'greroll',
                context: 'giveaway_reroll'
            });
        }
    },
};
