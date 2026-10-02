# Voice Gateway (v8) ✅

음성 송출·수신을 위한 **별도의 WebSocket + UDP** 연결. 메인 Gateway 와 독립. 출처: `discord-api-types` `voice/v8`.

## 접속 흐름

```
메인 Gateway:  Op 4 Voice State Update ──▶
               ◀── VOICE_STATE_UPDATE (session_id)
               ◀── VOICE_SERVER_UPDATE (token, endpoint)
Voice Gateway: wss://{endpoint}?v=8
   ◀ Op 8 Hello (heartbeat_interval, v)
   ▶ Op 0 Identify { server_id, user_id, session_id, token, max_dave_protocol_version? }
   ◀ Op 2 Ready { ssrc, ip, port, modes[] }
   ▶ (UDP IP discovery)  Op 1 Select Protocol { protocol:"udp", data:{address,port,mode} }
   ◀ Op 4 Session Description { mode, secret_key[], dave_protocol_version }
   ▶ Op 5 Speaking { speaking, delay, ssrc }  → 이후 UDP 로 RTP 음성 송출
```

## Opcodes (23개)

| Op | 이름 | 방향 | 설명 |
|---:|---|---|---|
| 0 | Identify | 송신 | 세션 시작 |
| 1 | Select Protocol | 송신 | 프로토콜·암호화 모드 선택 |
| 2 | Ready | 수신 | `ssrc`, UDP `ip/port`, 지원 `modes` |
| 3 | Heartbeat | 송신 | `{ t: nonce, seq_ack }` |
| 4 | Session Description | 수신 | 선택된 모드, `secret_key`, `dave_protocol_version` |
| 5 | Speaking | 양방향 | `speaking` 플래그, `ssrc`, `user_id` |
| 6 | Heartbeat ACK | 수신 | `{ t }` |
| 7 | Resume | 송신 | `{ server_id, session_id, token, seq_ack }` |
| 8 | Hello | 수신 | `heartbeat_interval`, `v` |
| 9 | Resumed | 수신 | Resume 성공 |
| 11 | Clients Connect | 수신 | 접속한 `user_ids[]` |
| 13 | Client Disconnect | 수신 | 나간 `user_id` |
| 21 | DAVE Prepare Transition | 수신 | DAVE 다운그레이드 예고 |
| 22 | DAVE Execute Transition | 수신 | 예고된 전환 실행 |
| 23 | DAVE Transition Ready | 송신 | 전환 준비 완료 |
| 24 | DAVE Prepare Epoch | 수신 | 프로토콜 버전/그룹 변경 예고 |
| 25 | DAVE MLS External Sender | 수신(바이너리) | MLS 외부 발신자 자격·공개키 |
| 26 | DAVE MLS Key Package | 송신(바이너리) | 대기 멤버 키 패키지 |
| 27 | DAVE MLS Proposals | 수신(바이너리) | 제안 추가/철회 |
| 28 | DAVE MLS Commit/Welcome | 송신(바이너리) | 커밋 + 환영 |
| 29 | DAVE MLS Announce Commit Transition | 수신(바이너리) | 커밋 전환 |
| 30 | DAVE MLS Welcome | 수신(바이너리) | 그룹 환영 |
| 31 | DAVE MLS Invalid Commit/Welcome | 송신 | 잘못된 커밋 신고·재추가 요청 |

## Close Codes

| 코드 | 이름 | 재접속 |
|---:|---|---|
| 4001 | Unknown Opcode | |
| 4002 | Failed to Decode | |
| 4003 | Not Authenticated | |
| 4004 | Authentication Failed | ❌ |
| 4005 | Already Authenticated | |
| 4006 | Session No Longer Valid | 새 세션 |
| 4009 | Session Timeout | |
| 4011 | Server Not Found | ❌ |
| 4012 | Unknown Protocol | |
| 4014 | **Disconnected** (채널 삭제·추방·메인 세션 끊김) | ❌ 재접속 금지 |
| 4015 | Voice Server Crashed | ✅ Resume |
| 4016 | Unknown Encryption Mode | |
| 4017 | **E2EE/DAVE protocol required** | DAVE 지원 필요 |
| 4020 | Bad Request | |
| 4021 | Rate Limited | ❌ 재접속 금지 |
| 4022 | Call Terminated | ❌ 재접속 금지 |

## 암호화 모드
| 모드 | 상태 |
|---|---|
| `aead_aes256_gcm_rtpsize` | 사용 |
| `aead_xchacha20_poly1305_rtpsize` | 사용 |
| `xsalsa20_poly1305_lite_rtpsize`, `aead_aes256_gcm`, `xsalsa20_poly1305`, `xsalsa20_poly1305_suffix`, `xsalsa20_poly1305_lite` | **폐기(discontinued)** |

## Speaking 플래그
`Microphone = 1`, `Soundshare = 2`, `Priority = 4`

## DAVE (종단 간 암호화, E2EE)
- 음성 연결에 **DAVE 프로토콜 지원이 필수**가 되는 방향(Close `4017` 존재). Identify 의 `max_dave_protocol_version` 로 지원 버전 광고, Session Description 의 `dave_protocol_version` 으로 협상 결과 수신. 
- 구현은 MLS(Messaging Layer Security) 기반이라 직접 구현보다 **라이브러리 사용**을 권장 (discord.py 2.x 는 `dave_session` 내장 ✅).
- ⚠️ 의무화 시점·범위(스테이지 제외 여부 등)는 공식 문서로 재확인할 것.

## 메인 Gateway 인텐트와의 관계
`GUILD_VOICE_STATES` 가 없으면 `session_id` 를 받지 못해 음성 연결이 사실상 불가. → [`../04-send-commands/update-voice-state.md`](../04-send-commands/update-voice-state.md)
