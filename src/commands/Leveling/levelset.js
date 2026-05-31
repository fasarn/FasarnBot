import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags } from 'discord.js';
import { logger } from '../../utils/logger.js';
import { handleInteractionError, TitanBotError, ErrorTypes } from '../../utils/errorHandler.js';
import { checkUserPermissions } from '../../utils/permissionGuard.js';
import { setUserLevel, getLevelingConfig } from '../../services/leveling.js';
import { createEmbed } from '../../utils/embeds.js';

import { InteractionHelper } from '../../utils/interactionHelper.js';
export default {
  data: new SlashCommandBuilder()
    .setName('levelset')
    .setDescription('Setzt das Level eines Benutzers auf einen bestimmten Wert')
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription('Der Benutzer, dessen Level gesetzt werden soll')
        .setRequired(true)
    )
    .addIntegerOption((option) =>
      option
        .setName('level')
        .setDescription('Das zu setzende Level')
        .setRequired(true)
        .setMinValue(0)
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
      const newLevel = interaction.options.getInteger('level');

      const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
      if (!member) {
        throw new TitanBotError(
          `User ${targetUser.id} not found in this guild`,
          ErrorTypes.USER_INPUT,
          'Der angegebene Benutzer befindet sich nicht auf diesem Server.'
        );
      }

      const userData = await setUserLevel(client, interaction.guildId, targetUser.id, newLevel);

      await InteractionHelper.safeEditReply(interaction, {
        embeds: [
          createEmbed({
            title: '✅ Level gesetzt',
            description: `Das Level von ${targetUser.tag} wurde erfolgreich auf **${newLevel}** gesetzt.\n**Gesamte XP:** ${userData.totalXp}`,
            color: 'success'
          })
        ]
      });

      logger.info(
        `[ADMIN] User ${interaction.user.tag} set ${targetUser.tag}'s level to ${newLevel} in guild ${interaction.guildId}`
      );
    } catch (error) {
      logger.error('LevelSet command error:', error);
      await handleInteractionError(interaction, error, {
        type: 'command',
        commandName: 'levelset'
      });
    }
  }
};
