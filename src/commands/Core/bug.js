import { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

export default {
    data: new SlashCommandBuilder()
        .setName("bug")
        .setDescription("Melde einen Fehler oder ein Problem mit dem Bot"),

    async execute(interaction) {
        const githubButton = new ButtonBuilder()
            .setLabel('🐛 Fehler auf GitHub melden')
            .setStyle(ButtonStyle.Link)
            .setURL('https://github.com/codebymitch/TitanBot/issues');

        const row = new ActionRowBuilder().addComponents(githubButton);

        const bugReportEmbed = createEmbed({
            title: '🐛 Fehlerbericht (Bug Report)',
            description: 'Du hast einen Fehler gefunden? Bitte melde ihn auf unserer GitHub-Issues-Seite!\n\n' +
            '**Bitte gib bei deiner Meldung Folgendes an:**\n' +
            '• 📝 Eine detaillierte Beschreibung des Problems\n' +
            '• 🔁 Schritte, um den Fehler zu reproduzieren\n' +
            '• 📸 Screenshots (falls zutreffend)\n' +
            '• 🤖 Deine Bot-Version und die Laufzeitumgebung\n\n' +
            'Das hilft uns dabei, Fehler schneller und effektiver zu beheben!',
            color: 'error'
        })
            .setTimestamp();

        await InteractionHelper.safeReply(interaction, {
            embeds: [bugReportEmbed],
            components: [row],
        });
    },
};
