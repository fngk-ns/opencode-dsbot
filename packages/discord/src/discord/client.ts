import { Client, GatewayIntentBits, Options, Partials } from "discord.js"

/**
 * Privileged intents used: GUILD_MEMBERS (the full member cache) and MESSAGE_CONTENT (message cache).
 * Both must be enabled in the Developer Portal, otherwise the gateway closes with 4014.
 */
export function createClient() {
  return new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel],
    // Members, users, channels, roles and threads stay cached without limit. Messages are kept in SQLite by
    // MessageStore, so discord.js must not keep (or lazily refetch) its own copy.
    makeCache: Options.cacheWithLimits({
      MessageManager: 0,
      PresenceManager: 0,
      ReactionManager: 0,
      ReactionUserManager: 0,
      VoiceStateManager: 0,
      StageInstanceManager: 0,
      GuildScheduledEventManager: 0,
      GuildInviteManager: 0,
      GuildBanManager: 0,
      AutoModerationRuleManager: 0,
    }),
    // Model output must never ping @everyone, roles or users.
    allowedMentions: { parse: [], repliedUser: false },
  })
}
