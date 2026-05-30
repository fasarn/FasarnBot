import { MessageFlags } from 'discord.js';
import { createEmbed, errorEmbed, successEmbed } from '../../../utils/embeds.js';
import { getUserBirthday } from '../../../services/birthdayService.js';
import { logger } from '../../../utils/logger.js';
import { handleInteractionError } from '../../../utils/errorHandler.js';

import { InteractionHelper } from '../../../utils/interactionHelper.js';
export default {
    async execute(interaction, config, client) {
        try {
            await InteractionHelper.safeDefer(interaction);

            const targetUser = interaction.options.getUser("user") || interaction.user;
            const userId = targetUser.id;
            const guildId = interaction.guildId;

            
            const birthdayData = await getUserBirthday(client, guildId, userId);

            if (!birthdayData) {
                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [createEmbed({
                        title: '❌ Kein Geburtstag gefunden',
                        description: targetUser.id === interaction.user.id 
                            ? "Du hast deinen Geburtstag noch nicht eingetragen. Verwende `/birthday set`, um ihn hinzuzufügen!"
                            : `${targetUser.username} hat noch keinen Geburtstag eingetragen.`,
                        color: 'error'
                    })]
                });
            }
            
            const embed = createEmbed({
                title: "🎂 Geburtstags-Informationen",
                description: `**Datum:** ${birthdayData.day}. ${birthdayData.monthName}\n**Nutzer:** ${targetUser.toString()}`,
                color: 'info',
                footer: targetUser.id === interaction.user.id ? "Dein Geburtstag" : `Geburtstag von ${targetUser.username}`
            });
            
            await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
            
            logger.info('Birthday info retrieved successfully', {
                userId: interaction.user.id,
                targetUserId: targetUser.id,
                guildId,
                commandName: 'birthday_info'
            });
        } catch (error) {
            logger.error("Birthday info command execution failed", {
                error: error.message,
                stack: error.stack,
                userId: interaction.user.id,
                guildId: interaction.guildId,
                commandName: 'birthday_info'
            });
            await handleInteractionError(interaction, error, {
                commandName: 'birthday_info',
                source: 'birthday_info_module'
            });
        }
    }
};
