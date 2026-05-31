import { PermissionFlagsBits, ChannelType } from 'discord.js';
import { createEmbed, errorEmbed, successEmbed } from '../../../utils/embeds.js';
import { getServerCounters, saveServerCounters, updateCounter, getCounterBaseName, getCounterTypeLabel } from '../../../services/serverstatsService.js';
import { logger } from '../../../utils/logger.js';

import { InteractionHelper } from '../../../utils/interactionHelper.js';
export async function handleCreate(interaction, client) {
    const guild = interaction.guild;
    const type = interaction.options.getString("type");
    const channelType = interaction.options.getString("channel_type");
    const category = interaction.options.getChannel("category");

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
            embeds: [errorEmbed("Du benötigst die Berechtigung **Kanäle verwalten**, um Tracker zu erstellen.")]
        }).catch(logger.error);
        return;
    }

    try {
        if (!category || category.type !== ChannelType.GuildCategory) {
            await InteractionHelper.safeEditReply(interaction, {
                embeds: [errorEmbed("Bitte wähle eine gültige Kategorie für den Tracker-Kanal aus.")]
            }).catch(logger.error);
            return;
        }

        const targetChannelType = channelType === 'voice' ? ChannelType.GuildVoice : ChannelType.GuildText;
        const baseChannelName = getCounterBaseName(type);

        const counters = await getServerCounters(client, guild.id);

        const duplicateType = counters.find(counter => counter.type === type);

        if (duplicateType) {
            const duplicateChannel = guild.channels.cache.get(duplicateType.channelId);
            await InteractionHelper.safeEditReply(interaction, {
                embeds: [errorEmbed(`Ein Tracker für **${getCounterTypeLabel(type)}** existiert bereits auf diesem Server${duplicateChannel ? ` in ${duplicateChannel}` : ''}. Lösche diesen zuerst, bevor du einen neuen erstellst.`)]
            }).catch(logger.error);
            return;
        }

        const targetChannel = await guild.channels.create({
            name: baseChannelName,
            type: targetChannelType,
            parent: category.id,
            reason: `Counter channel created by ${interaction.user.tag}`
        });

        const existingCounter = counters.find(c => c.channelId === targetChannel.id);
        if (existingCounter) {
            await InteractionHelper.safeEditReply(interaction, {
                embeds: [errorEmbed(`Ein Tracker existiert bereits für den Kanal **${targetChannel.name}**. Bitte lösche diesen zuerst oder wähle einen anderen Typ.`)]
            }).catch(logger.error);
            return;
        }

        const newCounter = {
            id: Date.now().toString(),
            type: type,
            channelId: targetChannel.id,
            guildId: guild.id,
            createdAt: new Date().toISOString(),
            enabled: true
        };

        counters.push(newCounter);

        const saved = await saveServerCounters(client, guild.id, counters);
        if (!saved) {
            await targetChannel.delete('Counter creation failed during save').catch(() => null);
            await InteractionHelper.safeEditReply(interaction, {
                embeds: [errorEmbed("Die Tracker-Daten konnten nicht gespeichert werden. Bitte versuche es erneut.")]
            }).catch(logger.error);
            return;
        }

        const updated = await updateCounter(client, guild, newCounter);
        if (!updated) {
            await InteractionHelper.safeEditReply(interaction, {
                embeds: [errorEmbed("Der Tracker wurde erstellt, aber der Kanalname konnte nicht aktualisiert werden. Der Tracker aktualisiert sich beim nächsten geplanten Durchlauf.")]
            }).catch(logger.error);
            return;
        }

        await InteractionHelper.safeEditReply(interaction, {
            embeds: [successEmbed(`✅ **Tracker erfolgreich erstellt!**\n\n**Typ:** ${getCounterTypeLabel(type)}\n**Kanaltyp:** ${targetChannel.type === ChannelType.GuildVoice ? 'Sprachkanal' : 'Textkanal'}\n**Kategorie:** ${category}\n**Kanal:** ${targetChannel}\n**Kanalname:** ${targetChannel.name}\n**Tracker-ID:** \`${newCounter.id}\`\n\nDer Tracker aktualisiert sich automatisch alle 15 Minuten.\n\nNutze \`/serverstats list\`, um alle Tracker anzuzeigen.`)]
        }).catch(logger.error);

    } catch (error) {
        logger.error("Error creating counter:", error);
        await InteractionHelper.safeEditReply(interaction, {
            embeds: [errorEmbed("Beim Erstellen des Trackers ist ein Fehler aufgetreten. Bitte versuche es erneut.")]
        }).catch(logger.error);
    }
}
