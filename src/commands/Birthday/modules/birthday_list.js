import { MessageFlags } from 'discord.js';
import { createEmbed, errorEmbed, successEmbed } from '../../../utils/embeds.js';
import { getAllBirthdays } from '../../../services/birthdayService.js';
import { deleteBirthday } from '../../../utils/database.js';
import { logger } from '../../../utils/logger.js';
import { handleInteractionError } from '../../../utils/errorHandler.js';

import { InteractionHelper } from '../../../utils/interactionHelper.js';
export default {
    async execute(interaction, config, client) {
        try {
            await InteractionHelper.safeDefer(interaction);

            const guildId = interaction.guildId;
            
            
            const sortedBirthdays = await getAllBirthdays(client, guildId);

            if (sortedBirthdays.length === 0) {
                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [createEmbed({
                        title: '❌ Keine Geburtstage',
                        description: 'Auf diesem Server wurden bisher noch keine Geburtstage eingetragen.',
                        color: 'error'
                    })]
                });
            }

            const embed = createEmbed({
                title: "🎂 Geburtstage auf dem Server",
                color: 'info'
            });

            // Batch-Abfrage, um zu überprüfen, welche Benutzer noch auf dem Server sind
            const userIds = sortedBirthdays.map(b => b.userId);
            const fetchedMembers = await interaction.guild.members.fetch({ user: userIds }).catch(() => null);

            let birthdayList = '';
            let displayIndex = 0;
            const staleUserIds = [];

            for (const birthday of sortedBirthdays) {
                if (fetchedMembers && !fetchedMembers.has(birthday.userId)) {
                    staleUserIds.push(birthday.userId);
                    continue;
                }
                displayIndex++;
                birthdayList += `${displayIndex}. <@${birthday.userId}> - ${birthday.day}. ${birthday.monthName}\n`;
            }

            // Bereinige Geburtstagseinträge von Mitgliedern, die den Server verlassen haben
            if (fetchedMembers && staleUserIds.length > 0) {
                for (const userId of staleUserIds) {
                    deleteBirthday(client, guildId, userId).catch(() => null);
                }
            }

            if (displayIndex === 0) {
                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [createEmbed({
                        title: '❌ Keine Geburtstage',
                        description: 'Von den aktuellen Servermitgliedern wurden keine Geburtstage eingetragen.',
                        color: 'error'
                    })]
                });
            }

            birthdayList = `**${displayIndex} Geburtstag${displayIndex !== 1 ? 'e' : ''} auf ${interaction.guild.name}**\n\n` + birthdayList;

            embed.setDescription(birthdayList);
            embed.setFooter({ text: `Gesamt: ${displayIndex} Geburtstag${displayIndex !== 1 ? 'e' : ''}` });

            await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
            
            logger.info('Birthday list retrieved successfully', {
                userId: interaction.user.id,
                guildId,
                birthdayCount: displayIndex,
                staleRemoved: staleUserIds.length,
                commandName: 'birthday_list'
            });
        } catch (error) {
            logger.error("Birthday list command execution failed", {
                error: error.message,
                stack: error.stack,
                userId: interaction.user.id,
                guildId: interaction.guildId,
                commandName: 'birthday_list'
            });
            await handleInteractionError(interaction, error, {
                commandName: 'birthday_list',
                source: 'birthday_list_module'
            });
        }
    }
};
