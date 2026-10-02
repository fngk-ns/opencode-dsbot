# 인텐트 비트 표 ✅

출처: `discord-api-types` `GatewayIntentBits`, `discord.py` `Intents`

인텐트는 Identify 의 `intents` 필드에 **비트 OR** 로 넘기는 정수이며, 구독하지 않은 인텐트의 이벤트는 오지 않는다. (v10 부터 인텐트는 필수)

| 비트 | 값 | 이름 (Discord 공식) | 특권 | 별칭/구명칭 |
|---:|---:|---|:---:|---|
| 0 | 1 | `GUILDS` | | |
| 1 | 2 | `GUILD_MEMBERS` | 🔒 | |
| 2 | 4 | `GUILD_MODERATION` | | 구 `GUILD_BANS` |
| 3 | 8 | `GUILD_EXPRESSIONS` | | 구 `GUILD_EMOJIS_AND_STICKERS` |
| 4 | 16 | `GUILD_INTEGRATIONS` | | |
| 5 | 32 | `GUILD_WEBHOOKS` | | |
| 6 | 64 | `GUILD_INVITES` | | |
| 7 | 128 | `GUILD_VOICE_STATES` | | |
| 8 | 256 | `GUILD_PRESENCES` | 🔒 | |
| 9 | 512 | `GUILD_MESSAGES` | | |
| 10 | 1024 | `GUILD_MESSAGE_REACTIONS` | | |
| 11 | 2048 | `GUILD_MESSAGE_TYPING` | | |
| 12 | 4096 | `DIRECT_MESSAGES` | | |
| 13 | 8192 | `DIRECT_MESSAGE_REACTIONS` | | |
| 14 | 16384 | `DIRECT_MESSAGE_TYPING` | | |
| 15 | 32768 | `MESSAGE_CONTENT` | 🔒 | |
| 16 | 65536 | `GUILD_SCHEDULED_EVENTS` | | |
| 20 | 1048576 | `AUTO_MODERATION_CONFIGURATION` | | |
| 21 | 2097152 | `AUTO_MODERATION_EXECUTION` | | |
| 24 | 16777216 | `GUILD_MESSAGE_POLLS` | | |
| 25 | 33554432 | `DIRECT_MESSAGE_POLLS` | | |

비트 17~19, 22~23 은 현재 미사용(예약). ⚠️

## 자주 쓰는 조합

```ts
// 전체 21개 = 53608447
// 비특권 18개 전체 = 53575421  (= 53608447 - GUILD_MEMBERS(2) - GUILD_PRESENCES(256) - MESSAGE_CONTENT(32768))
const NON_PRIVILEGED = 53575421

// 슬래시 커맨드 전용 봇: 인텐트 0 도 가능 (INTERACTION_CREATE 는 인텐트 불필요)
const SLASH_ONLY = 0

// 일반 채팅 봇
const CHAT = 1 /*GUILDS*/ | 512 /*GUILD_MESSAGES*/ | 32768 /*MESSAGE_CONTENT*/
```

## 서브-인텐트 규칙

- 메시지·반응·타이핑·폴은 **`GUILD_*` 와 `DIRECT_*` 가 분리**되어 있다. 서버 이벤트만 필요하면 `DIRECT_*` 는 끈다.
- `AUTO_MODERATION_CONFIGURATION`(규칙 변경)과 `AUTO_MODERATION_EXECUTION`(실행)도 분리. discord.py 는 둘을 묶은 `auto_moderation` 편의 속성을 제공. ✅
- `GatewayCapabilityBits`(Identify `capabilities`)는 인텐트와 **별개**의 비트필드 — 현재 `ChannelObfuscation = 1<<15` 하나(테스트용, `@unstable`). ✅ → [`04-send-commands/identify-resume-heartbeat.md`](../04-send-commands/identify-resume-heartbeat.md)
