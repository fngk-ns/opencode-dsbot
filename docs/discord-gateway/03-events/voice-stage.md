# 음성 · 스테이지 이벤트

## 음성 (`GUILD_VOICE_STATES` 1<<7)

| 이벤트 | `d` | 인텐트 |
|---|---|---|
| `VOICE_STATE_UPDATE` ✅ | VoiceState (`guild_id?, channel_id\|null, user_id, member?, session_id, deaf, mute, self_deaf, self_mute, self_stream?, self_video, suppress, request_to_speak_timestamp …`) | GUILD_VOICE_STATES |
| `VOICE_SERVER_UPDATE` ✅ | `{ token, guild_id, endpoint\|null }` | 불필요 ⚠️ |
| `VOICE_CHANNEL_EFFECT_SEND` ✅ | 아래 | GUILD_VOICE_STATES ⚠️ |
| `VOICE_CHANNEL_STATUS_UPDATE` ✅ | `{ id, guild_id, status\|null }` | ⚠️ 미확정 |
| `VOICE_CHANNEL_START_TIME_UPDATE` ✅ | `{ id, guild_id, voice_start_time? }` | ⚠️ 미확정 |

### `VOICE_STATE_UPDATE`
- 유저가 입장/퇴장/이동/음소거/화면공유 시작 등 모든 상태 변화.
- `channel_id: null` = 음성 채널 퇴장.
- 봇이 음성에 연결하려면 **이 이벤트의 `session_id`** 와 `VOICE_SERVER_UPDATE` 의 `token`·`endpoint` 를 모아 Voice Gateway 에 접속 → [`05-voice-gateway/voice-gateway.md`](../05-voice-gateway/voice-gateway.md)
- discord.py: "음성에 연결하려면 이 인텐트가 필요" ✅

### `VOICE_SERVER_UPDATE`
`endpoint: null` = 할당된 음성 서버가 사라졌고 재할당 중 → **현재 음성 서버에서 연결을 끊고, 새 서버가 할당될 때까지 재접속하지 말 것.** ✅

### `VOICE_CHANNEL_EFFECT_SEND` ✅
음성 채널 이모지 리액션 / 사운드보드 재생.

| 필드 | 설명 |
|---|---|
| `channel_id`, `guild_id`, `user_id` | 위치·보낸 사람 |
| `emoji?` | 이모지 리액션/사운드보드의 이모지 |
| `animation_type?` | `0` Premium(Nitro) / `1` Basic |
| `animation_id?` | 애니메이션 ID |
| `sound_id?` | 사운드보드 사운드 ID |
| `sound_volume?` | 0~1 |

### `VOICE_CHANNEL_STATUS_UPDATE` / `VOICE_CHANNEL_START_TIME_UPDATE` ✅ (신규)
음성 채널 **상태 문구**와 **음성 세션 시작 시각** 변경. 초기값은 Op 43 `Request Channel Info` 로 조회 가능 → [`04-send-commands/request-channel-info.md`](../04-send-commands/request-channel-info.md)

## 스테이지 (`GUILDS`) ✅

| 이벤트 | `d` |
|---|---|
| `STAGE_INSTANCE_CREATE` | StageInstance (`id, guild_id, channel_id, topic, privacy_level, discoverable_disabled, guild_scheduled_event_id …`) |
| `STAGE_INSTANCE_UPDATE` | 〃 |
| `STAGE_INSTANCE_DELETE` | 〃 |

스테이지 참가자 상태(청중 → 발언 요청 등)는 `VOICE_STATE_UPDATE.request_to_speak_timestamp` / `suppress` 로 확인.
