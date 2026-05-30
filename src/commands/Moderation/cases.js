import { SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, MessageFlags } from 'discord.js';
import { createEmbed, errorEmbed, successEmbed } from '../../utils/embeds.js';
import { getModerationCases } from '../../utils/moderation.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

export default {
    data: new SlashCommandBuilder()
        .setName('cases')
        .setDescription('Zeigt Moderationsfälle und das Audit-Protokoll an')
        .setDefaultMemberPermissions(PermissionFlagsBits.ViewAuditLog)
        .setDMPermission(false)
        .addStringOption(option =>
            option.setName('filter')
                .setDescription('Filtert die Fälle nach Typ')
                .addChoices(
                    { name: 'Alle Fälle', value: 'all' },
                    { name: 'Sperren (Bans)', value: 'Member Banned' },
                    { name: 'Kicks', value: 'Member Kicked' },
                    { name: 'Timeouts', value: 'Member Timed Out' },
                    { name: 'Verwarnungen (Warnings)', value: 'User Warned' }
                )
        )
        .addUserOption(option =>
            option.setName('user')
                .setDescription('Filtert die Fälle nach einem bestimmten Nutzer')
        )
        .addIntegerOption(option =>
            option.setName('limit')
                .setDescription('Anzahl der anzuzeigenden Fälle (Standard: 10)')
                .setMinValue(1)
                .setMaxValue(50)
        ),

    async execute(interaction, config, client) {
        const deferSuccess = await InteractionHelper.safeDefer(interaction);
        if (!deferSuccess) {
            logger.warn(`Cases interaction defer failed`, {
                userId: interaction.user.id,
                guildId: interaction.guildId,
                commandName: 'cases'
            });
            return;
        }

        try {
            const filterType = interaction.options.getString('filter') || 'all';
            const targetUser = interaction.options.getUser('user');
            const limit = interaction.options.getInteger('limit') || 10;

            const filters = {
                limit,
                action: filterType === 'all' ? undefined : filterType,
                userId: targetUser?.id
            };

            const cases = await getModerationCases(interaction.guild.id, filters);

            if (cases.length === 0) {
                throw new Error(targetUser 
                    ? `Keine Moderationsfälle für ${targetUser.tag} gefunden.`
                    : `Keine Fälle vom Typ "${filterType === 'all' ? 'Alle Fälle' : filterType}" auf diesem Server gefunden.`
                );
            }

            const CASES_PER_PAGE = 5;
            const totalPages = Math.ceil(cases.length / CASES_PER_PAGE);
            let currentPage = 1;

            const createCasesEmbed = (page) => {
                const startIndex = (page - 1) * CASES_PER_PAGE;
                const endIndex = startIndex + CASES_PER_PAGE;
                const pageCases = cases.slice(startIndex, endIndex);

                const embed = createEmbed({
                    title: '📋 Moderationsfälle',
                    description: `Angezeigte Moderationsfälle für **${interaction.guild.name}**\n\n**Seite ${page} von ${totalPages}**`
                });

                pageCases.forEach(case_ => {
                    const date = new Date(case_.createdAt).toLocaleDateString('de-DE');
                    const time = new Date(case_.createdAt).toLocaleTimeString('de-DE');
                    
                    embed.addFields({
                        name: `Fall #${case_.caseId} - ${case_.action}`,
                        value: `**Ziel:** ${case_.target}\n**Moderator:** ${case_.executor}\n**Datum:** ${date} um ${time}\n**Grund:** ${case_.reason || 'Kein Grund angegeben'}`,
                        inline: false
                    });
                });

                embed.setFooter({
                    text: `Fälle insgesamt: ${cases.length} | Filter: ${filterType}${targetUser ? ` | Nutzer: ${targetUser.tag}` : ''}`
                });

                return embed;
            };

            const createNavigationRow = (page) => {
                const row = new ActionRowBuilder();
                
                const prevButton = new ButtonBuilder()
                    .setCustomId('prev_page')
                    .setLabel('⬅️ Zurück')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(page === 1);

                const pageInfoButton = new ButtonBuilder()
                    .setCustomId('page_info')
                    .setLabel(`Seite ${page}/${totalPages}`)
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(true);

                const nextButton = new ButtonBuilder()
                    .setCustomId('next_page')
                    .setLabel('Weiter ➡️')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(page === totalPages);

                row.addComponents(prevButton, pageInfoButton, nextButton);
                return row;
            };

            const message = await interaction.editReply({ 
                embeds: [createCasesEmbed(currentPage)], 
                components: [createNavigationRow(currentPage)]
            });

            const collector = message.createMessageComponentCollector({
                componentType: ComponentType.Button,
                time: 120000
            });

            collector.on('collect', async (buttonInteraction) => {
                await buttonInteraction.deferUpdate();

                if (buttonInteraction.user.id !== interaction.user.id) {
                    await buttonInteraction.followUp({
                        content: 'Du kannst diese Buttons nicht verwenden. Nutze den Befehl `/cases` selbst, um deine eigene Übersicht zu öffnen.',
                        flags: MessageFlags.Ephemeral
                    });
                    return;
                }

                const { customId } = buttonInteraction;

                if (customId === 'prev_page' && currentPage > 1) {
                    currentPage--;
                } else if (customId === 'next_page' && currentPage < totalPages) {
                    currentPage++;
                }

                await buttonInteraction.editReply({
                    embeds: [createCasesEmbed(currentPage)],
                    components: [createNavigationRow(currentPage)]
                });
            });

            collector.on('end', async () => {
                const disabledRow = createNavigationRow(currentPage);
                disabledRow.components.forEach(button => button.setDisabled(true));
                
                try {
                    await message.edit({
                        components: [disabledRow]
                    });
                } catch (error) {
                    // Fehler beim Deaktivieren der Buttons ignorieren (falls Nachricht gelöscht wurde)
                }
            });

        } catch (error) {
            logger.error('Error in cases command:', error);
            return InteractionHelper.safeEditReply(interaction, {
                embeds: [
                    errorEmbed(
                        'Systemfehler',
                        error.message.startsWith('Keine') 
                            ? error.message 
                            : 'Beim Abrufen der Moderationsfälle ist ein Fehler aufgetreten. Bitte versuche es später noch einmal.'
                    )
                ],
                flags: MessageFlags.Ephemeral
            });
        }
    }
};
