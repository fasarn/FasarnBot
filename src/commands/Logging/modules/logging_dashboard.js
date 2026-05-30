import { EmbedBuilder, PermissionsBitField } from 'discord.js';
import { getColor } from '../../../config/bot.js';
import { getGuildConfig } from '../../../services/guildConfig.js';
import { getLoggingStatus, EVENT_TYPES } from '../../../services/loggingService.js';
import { createLoggingDashboardComponents } from '../../../utils/loggingUi.js';
import { errorEmbed } from '../../../utils/embeds.js';
import { InteractionHelper } from '../../../utils/interactionHelper.js';
import { logger } from '../../../utils/logger.js';

const EVENT_TYPES_BY_CATEGORY = Object.values(EVENT_TYPES).reduce((acc, eventType) => {
    const [category] = eventType.split('.');
    if (!acc[category]) acc[category] = [];
    acc[category].push(eventType);
    return acc;
}, {});

const CATEGORY_MAP = [
    ['moderation',   '🔨 Moderation'],
    ['ticket',       '🎫 Ticket-Ereignisse'],
    ['message',      '✉️ Nachrichten-Ereignisse'],
    ['role',         '🏷️ Rollen-Ereignisse'],
    ['member',       '👥 Mitglieder-Ereignisse'],
    ['leveling',     '📈 Levelsystem-Ereignisse'],
    ['reactionrole', '🎭 Reaktionsrollen-Ereignisse'],
    ['giveaway',     '🎁 Giveaway-Ereignisse'],
    ['counter',      '📊 Counter-Ereignisse'],
];

function getCategoryStatus(enabledEvents, category, auditEnabled) {
    if (!auditEnabled) return false;
    const events = enabledEvents || {};
    if (events[`${category}.*`] === false) return false;
    const categoryEvents = EVENT_TYPES_BY_CATEGORY[category] || [];
    if (categoryEvents.length === 0) return true;
    return categoryEvents.every((eventType) => events[eventType] !== false);
}

async function formatChannelMention(guild, id) {
    if (!id) return '`Nicht konfiguriert`';
    const channel = guild.channels.cache.get(id) ?? await guild.channels.fetch(id).catch(() => null);
    return channel ? channel.toString() : `⚠️ Fehlt (${id})`;
}

export async function buildLoggingDashboardView(interaction, client) {
    const guildConfig = await getGuildConfig(client, interaction.guildId);
    const loggingStatus = await getLoggingStatus(client, interaction.guildId);

    const auditEnabled = Boolean(loggingStatus.enabled);
    const auditChannel = await formatChannelMention(
        interaction.guild,
        loggingStatus.channelId || guildConfig.logging?.channelId || guildConfig.logChannelId,
    );
    const lifecycleChannel = await formatChannelMention(interaction.guild, guildConfig.ticketLogsChannelId);
    const transcriptChannel = await formatChannelMention(interaction.guild, guildConfig.ticketTranscriptChannelId);

    const ignoredUsers = guildConfig.logIgnore?.users || [];
    const ignoredChannels = guildConfig.logIgnore?.channels || [];

    const categoryLines = CATEGORY_MAP.map(([key, label]) => {
        const on = getCategoryStatus(loggingStatus.enabledEvents, key, auditEnabled);
        return `${on ? '✅' : '❌'} ${label}`;
    }).join('\n');

    const embed = new EmbedBuilder()
        .setTitle('📋 Logging-Dashboard')
        .setDescription(`Verwalte die Audit-Protokollierung für **${interaction.guild.name}**. Die Kategorie-Buttons schalten das Logging sofort um.`)
        .setColor(auditEnabled ? getColor('success') : getColor('warning'))
        .addFields(
            {
                name: '🧾 Audit-Logging',
                value: auditEnabled ? '✅ Aktiviert' : '❌ Deaktiviert',
                inline: true,
            },
            {
                name: '\u200B',
                value: '\u200B',
                inline: true,
            },
            {
                name: '\u200B',
                value: '\u200B',
                inline: true,
            },
            {
                name: '📡 Log-Kanäle',
                value: [
                    `**Audit:** ${auditChannel}`,
                    `**Ticket-Logs:** ${lifecycleChannel}`,
                    `**Ticket-Transkripte:** ${transcriptChannel}`,
                ].join('\n'),
                inline: false,
            },
            {
                name: '📋 Ereigniskategorien',
                value: categoryLines,
                inline: false,
            },
            {
                name: '🧹 Ignorier-Filter',
                value: `Nutzer: **${ignoredUsers.length}**\nKanäle: **${ignoredChannels.length}**`,
                inline: true,
            },
            {
                name: '🕒 Letzte Aktualisierung',
                value: `<t:${Math.floor(Date.now() / 1000)}:R>`,
                inline: true,
            },
        )
        .setFooter({ text: 'Nutze /logging setchannel für den Audit-Kanal  •  /ticket setup oder /ticket dashboard für Ticket-Kanäle' })
        .setTimestamp();

    const components = createLoggingDashboardComponents(loggingStatus.enabledEvents, auditEnabled);
    return { embed, components };
}

export default {
    async execute(interaction, config, client) {
        try {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
                return InteractionHelper.safeReply(interaction, {
                    embeds: [errorEmbed('Berechtigung verweigert', 'Du benötigst die Berechtigung **Server verwalten**, um das Logging-Dashboard anzuzeigen.')],
                });
            }

            await InteractionHelper.safeDefer(interaction);
            const { embed, components } = await buildLoggingDashboardView(interaction, client);
            await InteractionHelper.safeEditReply(interaction, { embeds: [embed], components });
        } catch (error) {
            logger.error('logging_dashboard error:', error);
            await InteractionHelper.safeEditReply(interaction, {
                embeds: [errorEmbed('Dashboard-Fehler', 'Das Logging-Dashboard konnte nicht geladen werden.')],
            });
        }
    },
};
