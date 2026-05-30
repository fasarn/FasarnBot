import { SlashCommandBuilder, MessageFlags, ChannelType } from 'discord.js';
import { createEmbed, errorEmbed, successEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { handleInteractionError } from '../../utils/errorHandler.js';

import birthdaySet from './modules/birthday_set.js';
import birthdayInfo from './modules/birthday_info.js';
import birthdayList from './modules/birthday_list.js';
import birthdayRemove from './modules/birthday_remove.js';
import nextBirthdays from './modules/next_birthdays.js';
import birthdaySetchannel from './modules/birthday_setchannel.js';

import { InteractionHelper } from '../../utils/interactionHelper.js';
export default {
    data: new SlashCommandBuilder()
        .setName('birthday')
        .setDescription('Befehle für das Geburtstagssystem')
        .addSubcommand(subcommand =>
            subcommand
                .setName('set')
                .setDescription('Trage deinen Geburtstag ein')
                .addIntegerOption(option =>
                    option
                        .setName('month')
                        .setDescription('Geburtsmonat (1-12)')
                        .setRequired(true)
                        .setMinValue(1)
                        .setMaxValue(12)
                )
                .addIntegerOption(option =>
                    option
                        .setName('day')
                        .setDescription('Geburtstag (1-31)')
                        .setRequired(true)
                        .setMinValue(1)
                        .setMaxValue(31)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('info')
                .setDescription('Zeigt Geburtstagsinformationen an')
                .addUserOption(option =>
                    option
                        .setName('user')
                        .setDescription('Nutzer, dessen Geburtstag überprüft werden soll')
                        .setRequired(false)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('list')
                .setDescription('Listet alle Geburtstage auf diesem Server auf')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('remove')
                .setDescription('Entfernt deinen Geburtstag aus dem System')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('next')
                .setDescription('Zeigt die anstehenden Geburtstage an')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('setchannel')
                .setDescription('Aktiviert/Deaktiviert den Kanal für Geburtstags-Ankündigungen. (Server verwalten benötigt)')
                .addChannelOption(option =>
                    option
                        .setName('channel')
                        .setDescription('Der Textkanal für Ankündigungen. Leer lassen, um ihn zu deaktivieren.')
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(false)
                )
        ),

    async execute(interaction, config, client) {
        try {
            const subcommand = interaction.options.getSubcommand();
            
            switch (subcommand) {
                case 'set':
                    return await birthdaySet.execute(interaction, config, client);
                case 'info':
                    return await birthdayInfo.execute(interaction, config, client);
                case 'list':
                    return await birthdayList.execute(interaction, config, client);
                case 'remove':
                    return await birthdayRemove.execute(interaction, config, client);
                case 'next':
                    return await nextBirthdays.execute(interaction, config, client);
                case 'setchannel':
                    return await birthdaySetchannel.execute(interaction, config, client);
                default:
                    return InteractionHelper.safeReply(interaction, {
                        embeds: [errorEmbed('Fehler', 'Unbekannter Unterbefehl')],
                        flags: MessageFlags.Ephemeral
                    });
            }
        } catch (error) {
            logger.error('Birthday command execution failed', {
                error: error.message,
                stack: error.stack,
                userId: interaction.user.id,
                guildId: interaction.guildId,
                commandName: 'birthday',
                subcommand: interaction.options.getSubcommand()
            });
            await handleInteractionError(interaction, error, {
                commandName: 'birthday',
                source: 'birthday_command'
            });
        }
    }
};
