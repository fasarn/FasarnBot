import { PermissionsBitField, MessageFlags } from 'discord.js';
import { errorEmbed, successEmbed } from '../../../utils/embeds.js';
import { getGuildConfig, setGuildConfig } from '../../../services/guildConfig.js';
import { InteractionHelper } from '../../../utils/interactionHelper.js';
import { logger } from '../../../utils/logger.js';

export default {
    async execute(interaction, config, client) {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
            return InteractionHelper.safeReply(interaction, {
                embeds: [errorEmbed('Berechtigung verweigert', 'Du benötigst die Berechtigung **Server verwalten**, um den Geburtstagskanal zu konfigurieren.')],
                flags: MessageFlags.Ephemeral,
            });
        }

        try {
            const channel = interaction.options.getChannel('channel');
            const guildId = interaction.guildId;
            const guildConfig = await getGuildConfig(client, guildId);

            if (channel) {
                guildConfig.birthdayChannelId = channel.id;
                await setGuildConfig(client, guildId, guildConfig);
                return InteractionHelper.safeReply(interaction, {
                    embeds: [successEmbed('🎂 Geburtstags-Ankündigungen aktiviert', `Geburtstags-Ankündigungen werden ab sofort in ${channel} gepostet.`)],
                    flags: MessageFlags.Ephemeral,
                });
            } else {
                guildConfig.birthdayChannelId = null;
                await setGuildConfig(client, guildId, guildConfig);
                return InteractionHelper.safeReply(interaction, {
                    embeds: [successEmbed('🎂 Geburtstags-Ankündigungen deaktiviert', 'Es wurde kein Kanal angegeben — die Geburtstags-Ankündigungen wurden deaktiviert.')],
                    flags: MessageFlags.Ephemeral,
                });
            }
        } catch (error) {
            logger.error('birthday_setchannel error:', error);
            return InteractionHelper.safeReply(interaction, {
                embeds: [errorEmbed('Konfigurationsfehler', 'Die Konfiguration für den Geburtstagskanal konnte nicht gespeichert werden.')],
                flags: MessageFlags.Ephemeral,
            });
        }
    },
};
