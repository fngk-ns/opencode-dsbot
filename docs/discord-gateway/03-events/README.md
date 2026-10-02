# 수신(Dispatch) 이벤트 전체 색인 — 79개 ✅

출처: `discord-api-types@0.38.56` `GatewayDispatchEvents`. 인텐트 열은 [`../02-intents/intent-event-matrix.md`](../02-intents/intent-event-matrix.md) 기준. `—` = 인텐트 불필요.

| # | 이벤트 | 인텐트 | 문서 |
|--:|---|---|---|
| 1 | `READY` | — | [connection](connection.md) |
| 2 | `RESUMED` | — | [connection](connection.md) |
| 3 | `RATE_LIMITED` | — | [connection](connection.md) |
| 4 | `APPLICATION_COMMAND_PERMISSIONS_UPDATE` | — | [interactions-commands](interactions-commands.md) |
| 5 | `INTERACTION_CREATE` | — | [interactions-commands](interactions-commands.md) |
| 6 | `AUTO_MODERATION_RULE_CREATE` | AUTO_MODERATION_CONFIGURATION | [moderation-automod](moderation-automod.md) |
| 7 | `AUTO_MODERATION_RULE_UPDATE` | AUTO_MODERATION_CONFIGURATION | 〃 |
| 8 | `AUTO_MODERATION_RULE_DELETE` | AUTO_MODERATION_CONFIGURATION | 〃 |
| 9 | `AUTO_MODERATION_ACTION_EXECUTION` | AUTO_MODERATION_EXECUTION (+🔒MESSAGE_CONTENT 으로 내용) | 〃 |
| 10 | `CHANNEL_CREATE` | GUILDS | [channel-thread](channel-thread.md) |
| 11 | `CHANNEL_UPDATE` | GUILDS | 〃 |
| 12 | `CHANNEL_DELETE` | GUILDS | 〃 |
| 13 | `CHANNEL_PINS_UPDATE` | GUILDS / DIRECT_MESSAGES | 〃 |
| 14 | `CHANNEL_INFO` | — (Op 43 응답) | 〃 |
| 15 | `THREAD_CREATE` | GUILDS | 〃 |
| 16 | `THREAD_UPDATE` | GUILDS | 〃 |
| 17 | `THREAD_DELETE` | GUILDS | 〃 |
| 18 | `THREAD_LIST_SYNC` | GUILDS | 〃 |
| 19 | `THREAD_MEMBER_UPDATE` | GUILDS | 〃 |
| 20 | `THREAD_MEMBERS_UPDATE` | GUILDS (+🔒GUILD_MEMBERS) | 〃 |
| 21 | `GUILD_CREATE` | GUILDS | [guild](guild.md) |
| 22 | `GUILD_UPDATE` | GUILDS | 〃 |
| 23 | `GUILD_DELETE` | GUILDS | 〃 |
| 24 | `GUILD_ROLE_CREATE` | GUILDS | 〃 |
| 25 | `GUILD_ROLE_UPDATE` | GUILDS | 〃 |
| 26 | `GUILD_ROLE_DELETE` | GUILDS | 〃 |
| 27 | `GUILD_AUDIT_LOG_ENTRY_CREATE` | GUILD_MODERATION | [moderation-automod](moderation-automod.md) |
| 28 | `GUILD_BAN_ADD` | GUILD_MODERATION | 〃 |
| 29 | `GUILD_BAN_REMOVE` | GUILD_MODERATION | 〃 |
| 30 | `GUILD_EMOJIS_UPDATE` | GUILD_EXPRESSIONS | [expressions-soundboard](expressions-soundboard.md) |
| 31 | `GUILD_STICKERS_UPDATE` | GUILD_EXPRESSIONS | 〃 |
| 32 | `GUILD_SOUNDBOARD_SOUND_CREATE` | GUILD_EXPRESSIONS | 〃 |
| 33 | `GUILD_SOUNDBOARD_SOUND_UPDATE` | GUILD_EXPRESSIONS | 〃 |
| 34 | `GUILD_SOUNDBOARD_SOUND_DELETE` | GUILD_EXPRESSIONS | 〃 |
| 35 | `GUILD_SOUNDBOARD_SOUNDS_UPDATE` | GUILD_EXPRESSIONS | 〃 |
| 36 | `SOUNDBOARD_SOUNDS` | — (Op 31 응답) | 〃 |
| 37 | `GUILD_INTEGRATIONS_UPDATE` | GUILD_INTEGRATIONS | [integration-webhook-invite](integration-webhook-invite.md) |
| 38 | `INTEGRATION_CREATE` | GUILD_INTEGRATIONS | 〃 |
| 39 | `INTEGRATION_UPDATE` | GUILD_INTEGRATIONS | 〃 |
| 40 | `INTEGRATION_DELETE` | GUILD_INTEGRATIONS | 〃 |
| 41 | `WEBHOOKS_UPDATE` | GUILD_WEBHOOKS | 〃 |
| 42 | `INVITE_CREATE` | GUILD_INVITES | 〃 |
| 43 | `INVITE_DELETE` | GUILD_INVITES | 〃 |
| 44 | `GUILD_MEMBER_ADD` | 🔒GUILD_MEMBERS | [user-member-presence](user-member-presence.md) |
| 45 | `GUILD_MEMBER_UPDATE` | 🔒GUILD_MEMBERS | 〃 |
| 46 | `GUILD_MEMBER_REMOVE` | 🔒GUILD_MEMBERS | 〃 |
| 47 | `GUILD_MEMBERS_CHUNK` | — (Op 8 응답) | 〃 |
| 48 | `PRESENCE_UPDATE` | 🔒GUILD_PRESENCES | 〃 |
| 49 | `USER_UPDATE` | — | 〃 |
| 50 | `TYPING_START` | GUILD_/DIRECT_MESSAGE_TYPING | 〃 |
| 51 | `MESSAGE_CREATE` | GUILD_/DIRECT_MESSAGES (+🔒MESSAGE_CONTENT) | [message](message.md) |
| 52 | `MESSAGE_UPDATE` | 〃 | 〃 |
| 53 | `MESSAGE_DELETE` | 〃 | 〃 |
| 54 | `MESSAGE_DELETE_BULK` | GUILD_MESSAGES | 〃 |
| 55 | `MESSAGE_REACTION_ADD` | GUILD_/DIRECT_MESSAGE_REACTIONS | [reaction-poll](reaction-poll.md) |
| 56 | `MESSAGE_REACTION_REMOVE` | 〃 | 〃 |
| 57 | `MESSAGE_REACTION_REMOVE_ALL` | 〃 | 〃 |
| 58 | `MESSAGE_REACTION_REMOVE_EMOJI` | 〃 | 〃 |
| 59 | `MESSAGE_POLL_VOTE_ADD` | GUILD_/DIRECT_MESSAGE_POLLS | 〃 |
| 60 | `MESSAGE_POLL_VOTE_REMOVE` | 〃 | 〃 |
| 61 | `VOICE_STATE_UPDATE` | GUILD_VOICE_STATES | [voice-stage](voice-stage.md) |
| 62 | `VOICE_SERVER_UPDATE` | — | 〃 |
| 63 | `VOICE_CHANNEL_EFFECT_SEND` | GUILD_VOICE_STATES ⚠️ | 〃 |
| 64 | `VOICE_CHANNEL_STATUS_UPDATE` | ⚠️ 미확정 | 〃 |
| 65 | `VOICE_CHANNEL_START_TIME_UPDATE` | ⚠️ 미확정 | 〃 |
| 66 | `STAGE_INSTANCE_CREATE` | GUILDS | 〃 |
| 67 | `STAGE_INSTANCE_UPDATE` | GUILDS | 〃 |
| 68 | `STAGE_INSTANCE_DELETE` | GUILDS | 〃 |
| 69 | `GUILD_SCHEDULED_EVENT_CREATE` | GUILD_SCHEDULED_EVENTS | [scheduled-events](scheduled-events.md) |
| 70 | `GUILD_SCHEDULED_EVENT_UPDATE` | 〃 | 〃 |
| 71 | `GUILD_SCHEDULED_EVENT_DELETE` | 〃 | 〃 |
| 72 | `GUILD_SCHEDULED_EVENT_USER_ADD` | 〃 | 〃 |
| 73 | `GUILD_SCHEDULED_EVENT_USER_REMOVE` | 〃 | 〃 |
| 74 | `ENTITLEMENT_CREATE` | — | [monetization](monetization.md) |
| 75 | `ENTITLEMENT_UPDATE` | — | 〃 |
| 76 | `ENTITLEMENT_DELETE` | — | 〃 |
| 77 | `SUBSCRIPTION_CREATE` | — | 〃 |
| 78 | `SUBSCRIPTION_UPDATE` | — | 〃 |
| 79 | `SUBSCRIPTION_DELETE` | — | 〃 |

## 공통 규칙

- 봇은 **볼 수 있는(VIEW_CHANNEL) 채널**의 이벤트만 받는다. ⚠️
- 모든 Dispatch 는 `{ op:0, t, s, d }` 구조이며 `s`(시퀀스)는 Resume 용으로 항상 저장해야 한다. ✅
- 필드명은 `snake_case`, ID 는 문자열 Snowflake. ✅
- 서버 전용 이벤트에는 `guild_id`, DM 에서도 올 수 있는 이벤트(`MESSAGE_*`, `TYPING_START`, `MESSAGE_REACTION_*`, `CHANNEL_PINS_UPDATE`, 폴 이벤트)에는 `guild_id?` 가 **선택**이다. ✅
