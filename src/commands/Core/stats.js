import { SlashCommandBuilder, version, MessageFlags } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

export default {
    data: new SlashCommandBuilder()
        .setName("stats")
        .setDescription("Zeigt Statistiken des Bots an"),

    async execute(interaction) {
        try {
            await InteractionHelper.safeDefer(interaction);
          
            const totalGuilds = interaction.client.guilds.cache.size;
            const totalMembers = interaction.client.guilds.cache.reduce(
                (acc, guild) => acc + guild.memberCount,
                0,
            );
            const nodeVersion = process.version;

            const embed = createEmbed({ 
                title: "📊 Systemstatistiken", 
                description: "Leistungsmetriken in Echtzeit." 
            }).addFields(
                { name: "Server", value: `${totalGuilds}`, inline: true },
                { name: "Benutzer", value: `${totalMembers}`, inline: true },
                { name: "Node.js", value: `${nodeVersion}`, inline: true },
                { name: "Discord.js", value: `v${version}`, inline: true },
                {
                    name: "Arbeitsspeicher",
                    value: `${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB`,
                    inline: true,
                },
            );

            await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
        } catch (error) {
            logger.error('Stats command error:', error);
            return InteractionHelper.safeEditReply(interaction, {
                embeds: [createEmbed({ title: 'Systemfehler', description: 'Die Systemstatistiken konnten nicht abgerufen werden.', color: 'error' })],
                flags: MessageFlags.Ephemeral,
            });
        }
    },
};
