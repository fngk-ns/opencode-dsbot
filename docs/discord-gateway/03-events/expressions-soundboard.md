# 표현(Expressions) 이벤트 — 이모지 · 스티커 · 사운드보드

인텐트: `GUILD_EXPRESSIONS` (1<<3) — 구 `GUILD_EMOJIS_AND_STICKERS` ✅

| 이벤트 | `d` | 비고 |
|---|---|---|
| `GUILD_EMOJIS_UPDATE` | `{ guild_id, emojis[] }` | **전체 목록 스냅샷** (diff 아님) |
| `GUILD_STICKERS_UPDATE` | `{ guild_id, stickers[] }` | 전체 목록 스냅샷 |
| `GUILD_SOUNDBOARD_SOUND_CREATE` | SoundboardSound | 사운드 추가 |
| `GUILD_SOUNDBOARD_SOUND_UPDATE` | SoundboardSound | 사운드 수정 |
| `GUILD_SOUNDBOARD_SOUND_DELETE` | `{ sound_id, guild_id }` | |
| `GUILD_SOUNDBOARD_SOUNDS_UPDATE` | `{ guild_id, soundboard_sounds[] }` | 전체 스냅샷 (여러 개 동시에 바뀔 때) |
| `SOUNDBOARD_SOUNDS` | `{ guild_id, soundboard_sounds[] }` | **Op 31 응답** (인텐트 불필요) |

## 참고 ✅
- 이모지·스티커는 `GUILD_CREATE` 의 `APIGuild` 에도 이미 포함되어 초기 캐시가 채워진다.
- **사운드보드 사운드는 `GUILD_CREATE.soundboard_sounds`** 로도 온다. 이후 변경을 `GUILD_EXPRESSIONS` 로 받는다.
- 사운드보드를 가져오려면 명시적으로 `Request Soundboard Sounds` (Op 31)을 쓸 수도 있다 → [`04-send-commands/request-soundboard-sounds.md`](../04-send-commands/request-soundboard-sounds.md)
- 음성 채널에서 사운드가 **재생**되는 순간은 `VOICE_CHANNEL_EFFECT_SEND` → [voice-stage.md](voice-stage.md)
