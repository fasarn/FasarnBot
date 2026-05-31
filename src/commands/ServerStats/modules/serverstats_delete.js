import { getColor } from '../../../config/bot.js';
import { PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { createEmbed, errorEmbed } from '../../../utils/embeds.js';
import { getServerCounters, saveServerCounters, getCounterEmoji, getCounterTypeLabel } from '../../../services/serverstatsService.js';
import { logger } from '../../../utils/logger.js';

import { InteractionHelper } from '../../../utils/interactionHelper.js';
export async function handleDelete(interaction, client) {
    const guild = interaction.guild;
    const counterId = interaction.options.getString("counter-id");
    
    // Defer reply immediately to ensure interaction is acknowledged
    try {
        await InteractionHelper.safeDefer(interaction);
    } catch (error) {
        logger.error("Failed to defer reply:", error);
        return;
    }

    // Check permissions after deferring
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
        await InteractionHelper.safeEditReply(interaction, { 
            embeds: [errorEmbed("Du benötigst die Berechtigung **Kanäle verwalten**, um Tracker zu löschen.")]
        }).catch(logger.error);
        return;
    }

    try {
        const counters = await getServerCounters(client, guild.id);

        if (counters.length === 0) {
            await InteractionHelper.safeEditReply(interaction, {
                embeds: [errorEmbed("Keine Tracker zum Löschen gefunden.")]
            }).catch(logger.error);
            return;
        }

        const counterToDelete = counters.find(c => c.id === counterId);
        if (!counterToDelete) {
            await InteractionHelper.safeEditReply(interaction, {
                embeds: [errorEmbed(`Tracker mit der ID \`${counterId}\` nicht gefunden. Nutze \`/serverstats list\`, um alle Tracker zu sehen.`)]
            }).catch(logger.error);
            return;
        }

        const channel = guild.channels.cache.get(counterToDelete.channelId);

        const embed = createEmbed({
            title: "⚠️ Tracker & Kanal löschen",
            description: `Bist du sicher, dass du diesen Tracker und den dazugehörigen Kanal löschen möchtest?\n\n**ID:** \`${counterToDelete.id}\`\n**Typ:** ${getCounterTypeDisplay(counterToDelete.type)}\n**Kanal:** ${channel || 'Gelöschter Kanal'}\n\n⚠️ **Der Kanal wird dauerhaft gelöscht!**`,
            color: getColor('error')
        });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`counter-delete:confirm:${counterToDelete.id}:${interaction.user.id}`)
                .setLabel("Löschen bestätigen")
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId(`counter-delete:cancel:${counterToDelete.id}:${interaction.user.id}`)
                .setLabel("Abbrechen")
                .setStyle(ButtonStyle.Secondary)
        );

        await InteractionHelper.safeEditReply(interaction, { embeds: [embed], components: [row] }).catch(logger.error);

    } catch (error) {
        logger.error("Error in handleDelete:", error);
        await InteractionHelper.safeEditReply(interaction, {
            embeds: [errorEmbed("Beim Abrufen der Tracker ist ein Fehler aufgetreten. Bitte versuche es erneut.")]
        }).catch(logger.error);
    }
}

export async function performDeletionByCounterId(client, guild, counterId) {
    try {
        const counters = await getServerCounters(client, guild.id);

        const counter = counters.find(c => c.id === counterId);
        if (!counter) {
            return {
                success: false,
                message: `Tracker mit der ID \`${counterId}\` wurde nicht gefunden.`
            };
        }

        const updatedCounters = counters.filter(c => c.id !== counter.id);

        const saved = await saveServerCounters(client, guild.id, updatedCounters);
        if (!saved) {
            return {
                success: false,
                message: "Tracker konnte nicht gelöscht werden. Bitte versuche es erneut."
            };
        }

        const channel = guild.channels.cache.get(counter.channelId);
        let channelDeleted = false;

        if (channel) {
            try {
                await channel.delete(`Counter deleted - removing channel: ${counter.id}`);
                channelDeleted = true;
            } catch (error) {
                logger.error("Error deleting channel:", error);
            }
        }

        let message = `✅ **Tracker erfolgreich gelöscht!**\n\n**ID:** \`${counter.id}\`\n**Typ:** ${getCounterTypeDisplay(counter.type)}`;
        
        if (channelDeleted) {
            message += `\n**Kanal:** ${channel.name} (gelöscht)`;
        } else if (channel) {
            message += `\n**Kanal:** ${channel.name} (Löschen fehlgeschlagen)`;
        } else {
            message += `\n**Kanal:** Bereits gelöscht`;
        }

        return {
            success: true,
            message
        };

    } catch (error) {
        logger.error("Error deleting counter:", error);
        return {
            success: false,
            message: "Beim Löschen des Trackers ist ein Fehler aufgetreten. Bitte versuche es erneut."
        };
    }
}

function getCounterTypeDisplay(type) {
    return `${getCounterEmoji(type)} ${getCounterTypeLabel(type)}`;
}
