# Gateway Opcodes ✅

출처: `discord-api-types` `GatewayOpcodes` (v10)

| Op | 이름 | 방향 | 설명 |
|---:|---|---|---|
| 0 | Dispatch | 수신 | 이벤트 전달 (`t` 에 이벤트명) |
| 1 | Heartbeat | 양방향 | 연결 유지. 서버가 보내면 즉시 응답 요청 |
| 2 | Identify | 송신 | 새 세션 시작 |
| 3 | Presence Update | 송신 | 봇 상태 변경 |
| 4 | Voice State Update | 송신 | 음성 채널 입장/퇴장/이동 |
| 6 | Resume | 송신 | 끊긴 세션 재개 |
| 7 | Reconnect | 수신 | 즉시 재접속 후 Resume 하라는 요청 |
| 8 | Request Guild Members | 송신 | 길드 멤버 요청 (→ `GUILD_MEMBERS_CHUNK`) |
| 9 | Invalid Session | 수신 | 세션 무효화 (`d`: 재개 가능 여부 bool) |
| 10 | Hello | 수신 | `heartbeat_interval` 전달 |
| 11 | Heartbeat ACK | 수신 | 하트비트 수신 확인 |
| 31 | Request Soundboard Sounds | 송신 | 사운드보드 목록 요청 (→ `SOUNDBOARD_SOUNDS`) |
| 43 | Request Channel Info | 송신 | **신규** — 임시(ephemeral) 채널 정보 요청 (→ `CHANNEL_INFO`) |

> 5·12 등 빠진 번호는 폐기/예약. 구버전의 Op 12(Request Guild Sync) 등은 봇에서 사용 불가. ⚠️

## 송신 가능한 페이로드 ✅ (`GatewaySendPayload`)

`Heartbeat | Identify | RequestChannelInfo | RequestGuildMembers | RequestSoundboardSounds | Resume | UpdatePresence | VoiceStateUpdate`

## 수신 가능한 비-Dispatch 페이로드 ✅ (`GatewayReceivePayload`)

`HeartbeatAck | HeartbeatRequest(Op 1) | Hello | InvalidSession | Reconnect` + Dispatch(Op 0)
