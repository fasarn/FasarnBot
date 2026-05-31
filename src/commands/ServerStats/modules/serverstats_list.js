import { getColor } from '../../../config/bot.js';
import { PermissionFlagsBits } from 'discord.js';
import { createEmbed, errorEmbed } from '../../../utils/embeds.js';
import { getServerCounters, saveServerCounters, getCounterEmoji as getCounterTypeEmoji, getCounterTypeLabel, getGuildCounterStats } from '../../../services/serverstatsService.js';
import { logger } from '../../../utils/logger.js';

import { InteractionHelper } from '../../../utils/interactionHelper.js';
export async function handleList(interaction, client) {
    const guild = interaction.guild;
    
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
            embeds: [errorEmbed("Du benötigst die Berechtigung **Kanäle verwalten**, um Tracker anzuzeigen.")]
        }).catch(logger.error);
        return;
    }

    try {
        const counters = await getServerCounters(client, guild.id);
        const stats = await getGuildCounterStats(guild);

        // Clean up counters with deleted channels
        const validCounters = [];
        const orphanedCounters = [];
        
        for (const counter of counters) {
            const channel = guild.channels.cache.get(counter.channelId);
            if (channel) {
                validCounters.push(counter);
            } else {
                orphanedCounters.push(counter);
                logger.info(`Removing orphaned counter ${counter.id} (type: ${counter.type}, deleted channel: ${counter.channelId}) from guild ${guild.id}`);
            }
        }
        
        // Save cleaned counters if any were orphaned
        if (orphanedCounters.length > 0) {
            await saveServerCounters(client, guild.id, validCounters);
            logger.info(`Cleaned up ${orphanedCounters.length} orphaned counter(s) from guild ${guild.id}`);
        }

        if (validCounters.length === 0) {
            const embed = createEmbed({
                title: "📋 Server-Tracker",
                description: "Für diesen Server wurden noch keine Tracker eingerichtet.\n\nNutze `/serverstats create`, um deinen ersten Tracker zu erstellen!",
                color: getColor('warning')
            });

            embed.addFields({
                name: "🔧 **Verfügbare Tracker-Typen**",
                value: "👥 **Mitglieder + Bots** - Gesamte Mitgliederanzahl des Servers\n👤 **Nur Mitglieder** - Nur menschliche Mitglieder\n🤖 **Nur Bots** - Nur Bot-Mitglieder",
                inline: false
            });

            embed.addFields({
                name: "📝 **Anwendungsbeispiele**",
                value: "`/serverstats create type:members channel_type:voice category:Statistiken`\n`/serverstats create type:bots channel_type:text category:Server-Info`\n`/serverstats list`",
                inline: false
            });

            embed.setFooter({ 
                text: "Tracker-System • Automatische Aktualisierung alle 15 Minuten" 
            });

            await InteractionHelper.safeEditReply(interaction, { embeds: [embed] }).catch(logger.error);
            return;
        }

        const embed = createEmbed({
            title: `📋 Server-Tracker (${validCounters.length})`,
            description: "Hier sind alle aktiven Tracker für diesen Server.\n\nTracker aktualisieren sich automatisch alle 15 Minuten.",
            color: getColor('info')
        });

        for (let i = 0; i < validCounters.length; i++) {
            const counter = validCounters[i];
            const channel = guild.channels.cache.get(counter.channelId);
            
            if (!channel) {
                // This should not happen since we filtered above, but keep as safety check
                logger.warn(`Counter ${counter.id} still has missing channel after cleanup`);
                continue;
            }

            const currentCount = getCurrentCount(stats, counter.type);
            const status = channel.name.includes(':') ? '✅ Aktiv' : '⚠️ Nicht aktualisiert';
            
            embed.addFields({
                name: `${getCounterTypeEmoji(counter.type)} Tracker #${i + 1} - ${channel.name}`,
                value: `**ID:** \`${counter.id}\`\n**Typ:** ${getCounterTypeDisplay(counter.type)}\n**Kanal:** ${channel}\n**Aktueller Wert:** ${currentCount}\n**Status:** ${status}\n**Erstellt am:** ${new Date(counter.createdAt).toLocaleDateString('de-DE')}`,
                inline: false
            });
        }

        embed.addFields({
            name: "📊 **Statistiken**",
            value: `**Tracker gesamt:** ${validCounters.length}\n**Aktive Tracker:** ${validCounters.filter(c => {
                const channel = guild.channels.cache.get(c.channelId);
                return channel && channel.name.includes(':');
            }).length}\n**Nächste Aktualisierung:** <t:${Math.floor(Date.now() / 1000) + 900}:R>`,
            inline: false
        });

        embed.addFields({
            name: "🔧 **Verwaltungsbefehle**",
            value: "`/serverstats create` - Neuen Tracker erstellen\n`/serverstats update` - Bestehenden Tracker aktualisieren\n`/serverstats delete` - Tracker löschen",
            inline: false
        });

        embed.setFooter({ 
            text: "Tracker-System • Automatische Aktualisierung alle 15 Minuten" 
        });
        embed.setTimestamp();

        await InteractionHelper.safeEditReply(interaction, { embeds: [embed] }).catch(logger.error);

    } catch (error) {
        logger.error("Error displaying counters:", error);
        await InteractionHelper.safeEditReply(interaction, {
            embeds: [errorEmbed("Beim Abrufen der Tracker ist ein Fehler aufgetreten. Bitte versuche es erneut.")]
        }).catch(logger.error);
    }
}

function getCounterTypeDisplay(type) {
    return `${getCounterTypeEmoji(type)} ${getCounterTypeLabel(type)}`;
}

function getCounterEmoji(type) {
    return getCounterTypeEmoji(type);
}

function getCurrentCount(stats, type) {
    switch (type) {
        case "members":
            return stats.totalCount;
        case "bots":
            return stats.botCount;
        case "members_only":
            return stats.humanCount;
        default:
            return 0;
    }
}
