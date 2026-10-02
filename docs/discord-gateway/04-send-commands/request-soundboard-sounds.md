# Request Soundboard Sounds (Op 31) ✅

여러 길드의 사운드보드를 한 번에 요청.

```jsonc
{ "op": 31, "d": { "guild_ids": ["…", "…"] } }
```

응답: 길드마다 `SOUNDBOARD_SOUNDS` → `{ guild_id, soundboard_sounds[] }` (인텐트 불필요).

- 사운드보드 변경 알림은 `GUILD_SOUNDBOARD_SOUND_*` / `GUILD_SOUNDBOARD_SOUNDS_UPDATE` (→ `GUILD_EXPRESSIONS`)
- 초기값은 `GUILD_CREATE.soundboard_sounds` 에도 들어 있으므로 일반적으로는 별도 요청 없이도 캐시 가능
- 사운드를 **재생**하는 것은 Gateway 가 아닌 REST (`POST /channels/{id}/send-soundboard-sound`) ⚠️
→ [`03-events/expressions-soundboard.md`](../03-events/expressions-soundboard.md)
