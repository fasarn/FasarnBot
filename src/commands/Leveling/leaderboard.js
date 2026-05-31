import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { logger } from '../../utils/logger.js';
import { handleInteractionError, TitanBotError, ErrorTypes } from '../../utils/errorHandler.js';
import { getLeaderboard, getLevelingConfig, getXpForLevel } from '../../services/leveling.js';

import { InteractionHelper } from '../../utils/interactionHelper.js';
export default {
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Zeigt die Level-Rangliste des Servers an')
    .setDMPermission(false),
  category: 'Leveling',

  async execute(interaction, config, client) {
    try {
      await InteractionHelper.safeDefer(interaction);

      const levelingConfig = await getLevelingConfig(client, interaction.guildId);

      if (!levelingConfig?.enabled) {
        await InteractionHelper.safeEditReply(interaction, {
          embeds: [
            new EmbedBuilder()
              .setColor('#f1c40f')
              .setDescription('Das Level-System ist auf diesem Server zurzeit deaktiviert.')
          ],
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const leaderboard = await getLeaderboard(client, interaction.guildId, 10);

      if (leaderboard.length === 0) {
        throw new TitanBotError(
          'No leaderboard data found',
          ErrorTypes.DATABASE,
          'Es wurden noch keine Level-Daten gefunden. Schreibe in den Chats, um XP zu sammeln!'
        );
      }

      const embed = new EmbedBuilder()
        .setTitle('🏆 Level-Rangliste')
        .setColor('#2ecc71')
        .setDescription('Die 10 aktivsten Mitglieder auf diesem Server:')
        .setTimestamp();

      const leaderboardText = await Promise.all(
        leaderboard.map(async (user, index) => {
          try {
            const member = await interaction.guild.members.fetch(user.userId).catch(() => null);
            const userMention = member?.user.toString() || `<@${user.userId}>`;
            const xpForNextLevel = getXpForLevel(user.level + 1);

            let rankPrefix = `${index + 1}.`;
            if (index === 0) rankPrefix = '🥇';
            else if (index === 1) rankPrefix = '🥈';
            else if (index === 2) rankPrefix = '🥉';
            else rankPrefix = `**${index + 1}.**`;

            return `${rankPrefix} ${userMention} - Level ${user.level} (${user.xp}/${xpForNextLevel} XP)`;
          } catch {
            return `**${index + 1}.** Fehler beim Laden von Benutzer ${user.userId}`;
          }
        })
      );

      embed.addFields({
        name: 'Platzierungen',
        value: leaderboardText.join('\n')
      });

      await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
      logger.debug(`Leaderboard displayed for guild ${interaction.guildId}`);
    } catch (error) {
      logger.error('Leaderboard command error:', error);
      await handleInteractionError(interaction, error, {
        type: 'command',
        commandName: 'leaderboard'
      });
    }
  }
};
