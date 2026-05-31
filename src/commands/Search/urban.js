import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import axios from 'axios';
import { createEmbed, errorEmbed, successEmbed, infoEmbed, warningEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { handleInteractionError } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { getGuildConfig } from '../../services/guildConfig.js';
import { getColor } from '../../config/bot.js';

export default {
    data: new SlashCommandBuilder()
        .setName('urban')
        .setDescription('Sucht im Urban Dictionary nach Definitionen')
        .addStringOption(option => 
            option.setName('term')
                .setDescription('Der Begriff, der im Urban Dictionary nachgeschlagen werden soll')
                .setRequired(true)),
    
    async execute(interaction) {
        try {
            const term = interaction.options.getString('term');
            
            if (term.length < 2) {
                logger.warn('Urban command - term too short', {
                    userId: interaction.user.id,
                    term: term,
                    guildId: interaction.guildId
                });
                return await InteractionHelper.safeReply(interaction, {
                    embeds: [errorEmbed('Fehler', 'Bitte gib einen Begriff mit mindestens 2 Zeichen ein.')],
                    flags: MessageFlags.Ephemeral
                });
            }
            
            const guildConfig = await getGuildConfig(interaction.client, interaction.guild?.id);
            if (guildConfig?.disabledCommands?.includes('urban')) {
                logger.warn('Urban command disabled in guild', {
                    userId: interaction.user.id,
                    guildId: interaction.guildId,
                    commandName: 'urban'
                });
                return await InteractionHelper.safeReply(interaction, {
                    embeds: [errorEmbed('Befehl deaktiviert', 'Der Urban Dictionary-Befehl ist auf diesem Server deaktiviert.')],
                    flags: MessageFlags.Ephemeral
                });
            }

            let deferTimer = null;
            const clearDeferTimer = () => {
                if (deferTimer) {
                    clearTimeout(deferTimer);
                    deferTimer = null;
                }
            };

            deferTimer = setTimeout(() => {
                InteractionHelper.safeDefer(interaction).catch((deferError) => {
                    logger.debug('Urban command defer fallback failed', {
                        error: deferError?.message,
                        interactionId: interaction.id,
                        commandName: 'urban'
                    });
                });
            }, 1500);
            
            const response = await axios.get(
                `https://api.urbandictionary.com/v0/define?term=${encodeURIComponent(term)}`,
                { timeout: 5000 }
            );
            clearDeferTimer();
            
            if (!response.data?.list?.length) {
                return await InteractionHelper.safeReply(interaction, {
                    embeds: [errorEmbed('Nicht gefunden', `Keine Definitionen für "${term}" im Urban Dictionary gefunden.`)]
                });
            }
            
            const definition = response.data.list[0];
            const cleanDefinition = definition.definition.replace(/\[|\]/g, '');
            const cleanExample = definition.example.replace(/\[|\]/g, '');
            
            const formattedDefinition = cleanDefinition
                .replace(/\n\s*\n/g, '\n\n')
                .slice(0, 2000);
                
            const formattedExample = cleanExample
                ? `*"${cleanExample.replace(/\n/g, ' ').slice(0, 500)}..."*`
                : '*Kein Beispiel angegeben*';
            
            const embed = createEmbed({
                title: definition.word,
                description: formattedDefinition,
                color: 'info'
            })
            .setURL(definition.permalink)
            .addFields(
                { 
                    name: 'Beispiel', 
                    value: formattedExample,
                    inline: false 
                },
                { 
                    name: 'Statistiken', 
                    value: `👍 ${definition.thumbs_up.toLocaleString('de-DE')} • 👎 ${definition.thumbs_down.toLocaleString('de-DE')}`,
                    inline: true 
                },
                { 
                    name: 'Autor', 
                    value: definition.author || 'Anonym',
                    inline: true 
                }
            )
            .setFooter({ 
                text: 'Urban Dictionary',
                iconURL: 'https://i.imgur.com/8aQrX3a.png' 
            });
                
            await InteractionHelper.safeReply(interaction, { embeds: [embed] });
            
            logger.info('Urban Dictionary definition retrieved', {
                userId: interaction.user.id,
                term: term,
                guildId: interaction.guildId,
                commandName: 'urban'
            });
            
        } catch (error) {
            logger.error('Urban Dictionary error', {
                error: error.message,
                stack: error.stack,
                userId: interaction.user.id,
                term: interaction.options.getString('term'),
                guildId: interaction.guildId,
                apiStatus: error.response?.status,
                commandName: 'urban'
            });
            
            if (error.response?.status === 404 || !error.response) {
                await InteractionHelper.safeEditReply(interaction, {
                    embeds: [errorEmbed('Nicht gefunden', `Keine Definitionen für "${interaction.options.getString('term')}" im Urban Dictionary gefunden.`)]
                });
            } else if (error.response?.status === 429) {
                await InteractionHelper.safeEditReply(interaction, {
                    embeds: [errorEmbed('Ratenbegrenzung', 'Zu viele Anfragen an das Urban Dictionary. Bitte versuche es in einigen Minuten erneut.')]
                });
            } else {
                await handleInteractionError(interaction, error, {
                    commandName: 'urban',
                    source: 'urban_dictionary_api'
                });
            }
        }
    },
};
