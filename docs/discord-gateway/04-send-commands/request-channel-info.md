# Request Channel Info (Op 43) ✅ — 신규

길드 채널의 **임시(ephemeral) 데이터**를 요청. 타입 정의에 "Request ephemeral channel data for channels in a guild" 로 설명.

```jsonc
{ "op": 43, "d": { "guild_id": "…", "fields": ["status", "voice_start_time"] } }
```

| 필드 | 설명 |
|---|---|
| `guild_id` | 길드 |
| `fields[]` | 요청할 필드. 현재 `"status"`(음성 채널 상태 문구), `"voice_start_time"`(음성 세션 시작 Unix 초) |

응답: `CHANNEL_INFO` → `{ guild_id, channels: [{ id, status?, voice_start_time? }] }`
변경 알림: `VOICE_CHANNEL_STATUS_UPDATE`, `VOICE_CHANNEL_START_TIME_UPDATE`

## ⚠️ 확인 필요
discord-api-types 의 타입 정의만 확인함. 공식 문서 상의 필요 인텐트·권한·rate limit 은 직접 확인하지 못했으므로 사용 전에 [Gateway Events 공식 문서](https://docs.discord.com/developers/events/gateway-events)에서 재확인할 것.

`fields` 의 타입이 `(Enum | (string & {}))[]` 로 열려 있어 **필드가 추가될 가능성**을 시사한다. ✅
