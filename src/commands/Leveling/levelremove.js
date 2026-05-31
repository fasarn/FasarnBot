import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags } from 'discord.js';
import { logger } from '../../utils/logger.js';
import { handleInteractionError, TitanBotError, ErrorTypes } from '../../utils/errorHandler.js';
import { checkUserPermissions } from '../../utils/permissionGuard.js';
import { removeLevels, getUserLevelData, getLevelingConfig } from '../../services/leveling.js';
import { createEmbed } from '../../utils/embeds.js';

import { InteractionHelper } from '../../utils/interactionHelper.js';
export default {
  data: new SlashCommandBuilder()
    .setName('levelremove')
    .setDescription('Entfernt Level von einem Benutzer')
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription('Der Benutzer, dem Level entfernt werden sollen')
        .setRequired(true)
    )
    .addIntegerOption((option) =>
      option
        .setName('levels')
        .setDescription('Anzahl der zu entfernenden Level')
        .setRequired(true)
        .setMinValue(1)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false),
  category: 'Leveling',

  async execute(interaction, config, client) {
    try {
      await InteractionHelper.safeDefer(interaction);

      const hasPermission = await checkUserPermissions(
        interaction,
        PermissionFlagsBits.ManageGuild,
        'Du benötigst die Berechtigung „Server verwalten“, um diesen Befehl zu nutzen.'
      );
      if (!hasPermission) return;

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

      const targetUser = interaction.options.getUser('user');
      const levelsToRemove = interaction.options.getInteger('levels');

      const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
      if (!member) {
        throw new TitanBotError(
          `User ${targetUser.id} not found in this guild`,
          ErrorTypes.USER_INPUT,
          'Der angegebene Benutzer befindet sich nicht auf diesem Server.'
        );
      }

      const userData = await getUserLevelData(client, interaction.guildId, targetUser.id);
      if (userData.level === 0) {
        throw new TitanBotError(
          `User ${targetUser.id} is already at minimum level`,
          ErrorTypes.VALIDATION,
          `${targetUser.tag} ist bereits auf Level 0. Es können keine weiteren Level entfernt werden.`
        );
      }

      const updatedData = await removeLevels(client, interaction.guildId, targetUser.id, levelsToRemove);

      await InteractionHelper.safeEditReply(interaction, {
        embeds: [
          createEmbed({
            title: '✅ Level entfernt',
            description: `Erfolgreich ${levelsToRemove} Level von ${targetUser.tag} abgezogen.\n**Neues Level:** ${updatedData.level}`,
            color: 'success'
          })
        ]
      });

      logger.info(
        `[ADMIN] User ${interaction.user.tag} removed ${levelsToRemove} levels from ${targetUser.tag} in guild ${interaction.guildId}`
      );
    } catch (error) {
      logger.error('LevelRemove command error:', error);
      await handleInteractionError(interaction, error, {
        type: 'command',
        commandName: 'levelremove'
      });
    }
  }
};
