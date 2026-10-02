# Update Voice State (Op 4) ✅

음성 채널 입장 · 퇴장 · 이동 및 자기 음소거/귀닫기.

```jsonc
{ "op": 4, "d": { "guild_id": "…", "channel_id": "…"|null, "self_mute": false, "self_deaf": false } }
```

| 필드 | 설명 |
|---|---|
| `guild_id` | 길드 |
| `channel_id` | 입장할 음성/스테이지 채널. **`null` = 퇴장** |
| `self_mute` | 자신 마이크 음소거 |
| `self_deaf` | 자신 헤드셋 귀닫기 |

## 연결 절차 (봇이 실제로 음성을 송출하려면)
1. Op 4 전송
2. 수신: `VOICE_STATE_UPDATE`(→ `session_id`) 와 `VOICE_SERVER_UPDATE`(→ `token`, `endpoint`)
3. `wss://{endpoint}?v=8` 에 접속해 **Voice Gateway** Identify → [`../05-voice-gateway/voice-gateway.md`](../05-voice-gateway/voice-gateway.md)

## 요건 ⚠️
- 인텐트: `GUILD_VOICE_STATES` (이벤트 수신 및 연결에 사실상 필수 — discord.py 문서 ✅)
- 권한: 대상 채널에 `CONNECT`, 송출에는 `SPEAK`, 스테이지는 추가 요건(`REQUEST_TO_SPEAK` 등)
- 한 길드에서 봇은 **동시에 하나의 음성 채널**에만 연결 가능
