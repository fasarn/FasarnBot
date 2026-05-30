import { SlashCommandBuilder, PermissionFlagsBits, PermissionsBitField, ChannelType, MessageFlags } from 'discord.js';
import { createEmbed, errorEmbed, successEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { handleInteractionError } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { getColor } from '../../config/bot.js';

const ACTIVITIES = {
    'youtube': '880218394199220334',
    'poker': '755827207812677713',
    'chess': '832012774040141894',
    'checkers': '832013003968348200',
    'letter-league': '879863686565621790',
    'spellcast': '852509694341283871',
    'sketch': '902271654783242291',
    'blazing8s': '832025144389533716',
    'puttparty': '945737671223947305',
    'landio': '903769130790969345',
    'bobble': '947957217959759964',
    'knowwhat': '976052223358406656'
};

const ACTIVITY_NAMES = {
    'youtube': 'YouTube Together',
    'poker': 'Poker Night',
    'chess': 'Chess im Park',
    'checkers': 'Dame im Park',
    'letter-league': 'Letter League',
    'spellcast': 'SpellCast',
    'sketch': 'Sketch Heads',
    'blazing8s': 'Blazing 8s',
    'puttparty': 'Putt Party',
    'landio': 'Land-io',
    'bobble': 'Bobble League',
    'knowwhat': 'Weißt du was ich meine'
};

export default {

    data: new SlashCommandBuilder()

        .setName('activity')

        .setDescription(
            'Starte eine Discord Aktivität in deinem Sprachkanal'
        )

        .setDMPermission(false)

        .setDefaultMemberPermissions(
            PermissionFlagsBits.Connect
        )

        .addSubcommand(subcommand =>
            subcommand
                .setName('youtube')
                .setDescription(
                    'Schaue gemeinsam YouTube Videos im Sprachkanal'
                )
        )

        .addSubcommand(subcommand =>
            subcommand
                .setName('poker')
                .setDescription(
                    'Spiele Poker Night mit Freunden'
                )
        )

        .addSubcommand(subcommand =>
            subcommand
                .setName('chess')
                .setDescription(
                    'Spiele Schach im Park'
                )
        )

        .addSubcommand(subcommand =>
            subcommand
                .setName('checkers')
                .setDescription(
                    'Spiele Dame im Park'
                )
        )

        .addSubcommand(subcommand =>
            subcommand
                .setName('letter-league')
                .setDescription(
                    'Spiele das wortbasierte Spiel Letter League'
                )
        )

        .addSubcommand(subcommand =>
            subcommand
                .setName('spellcast')
                .setDescription(
                    'Spiele das magische Wortspiel SpellCast'
                )
        )

        .addSubcommand(subcommand =>
            subcommand
                .setName('sketch')
                .setDescription(
                    'Spiele Sketch Heads (Pictionary Stil)'
                )
        )

        .addSubcommand(subcommand =>
            subcommand
                .setName('blazing8s')
                .setDescription(
                    'Spiele das Kartenspiel Blazing 8s'
                )
        )

        .addSubcommand(subcommand =>
            subcommand
                .setName('puttparty')
                .setDescription(
                    'Spiele Putt Party (Minigolf)'
                )
        )

        .addSubcommand(subcommand =>
            subcommand
                .setName('landio')
                .setDescription(
                    'Spiele das Gebietsspiel Land-io'
                )
        )

        .addSubcommand(subcommand =>
            subcommand
                .setName('bobble')
                .setDescription(
                    'Spiele Bobble League'
                )
        )

        .addSubcommand(subcommand =>
            subcommand
                .setName('knowwhat')
                .setDescription(
                    'Spiele Weißt du was ich meine'
                )
        ),

    category: "Voice",

    async execute(interaction, config, client) {

        try {

            const deferred =
                await InteractionHelper.safeDefer(
                    interaction,
                    {
                        flags:
                            MessageFlags.Ephemeral
                    }
                );

            if (!deferred) {
                return;
            }

            const {
                member,
                options
            } = interaction;

            const activity =
                options.getSubcommand();

            const activityId =
                ACTIVITIES[
                    activity
                ];

            const activityName =
                ACTIVITY_NAMES[
                    activity
                ] || activity;

            if (
                !member.voice.channel
            ) {

                return await InteractionHelper.safeEditReply(
                    interaction,
                    {
                        embeds: [
                            errorEmbed(
                                'Nicht in einem Sprachkanal',
                                'Du musst in einem Sprachkanal sein, um eine Aktivität zu starten!'
                            )
                        ]
                    }
                );
            }

            const permissions =
                member.voice.channel.permissionsFor(
                    interaction.guild.members.me
                );

            if (
                !permissions.has(
                    'CreateInstantInvite'
                )
            ) {

                return await InteractionHelper.safeEditReply(
                    interaction,
                    {
                        embeds: [
                            errorEmbed(
                                'Fehlende Berechtigungen',
                                'Ich benötige die Berechtigung `Einladung erstellen`, um eine Aktivität zu starten!'
                            )
                        ]
                    }
                );
            }

            const invite =
                await interaction.client.rest.post(
                    `/channels/${member.voice.channel.id}/invites`,
                    {
                        body: {

                            max_age:
                                86400,

                            target_type:
                                2,

                            target_application_id:
                                activityId,
                        },
                    }
                );

            await InteractionHelper.safeEditReply(
                interaction,
                {
                    embeds: [
                        createEmbed({

                            title:
                                `🎮 ${activityName}`,

                            description:
                                `Klicke auf den Link unten, um **${activityName}** in ${member.voice.channel.name} zu starten!\n\n[${activityName} beitreten](https://discord.gg/${invite.code})`,

                            color:
                                'success'
                        })
                    ]
                }
            );

        } catch (error) {

            if (
                !interaction.deferred &&
                !interaction.replied
            ) {

                await handleInteractionError(
                    interaction,
                    error,
                    {
                        commandName:
                            'activity',

                        source:
                            'discord_activity_api'
                    }
                );

            } else {

                await InteractionHelper.safeEditReply(
                    interaction,
                    {
                        embeds: [
                            errorEmbed(
                                'Aktivität konnte nicht erstellt werden',
                                'Beim Erstellen der Aktivität ist ein Fehler aufgetreten. Bitte versuche es später erneut.'
                            )
                        ]
                    }
                );
            }
        }
    },
};
