# Discord Bot Gateway 기능 총정리

Discord **봇**이 Gateway(WebSocket)로 할 수 있는 모든 것 — 연결, 인텐트, 수신 이벤트, 송신 명령, Voice Gateway — 를 폴더별로 정리한 레퍼런스.

- 기준 시점: 2026-10-02
- 기준 API: Gateway **v10**
- 대상: 봇 토큰으로 접속하는 앱 (유저 토큰/셀프봇은 범위 밖)

## 폴더 트리

```
docs/discord-gateway/
├── README.md                          ← 이 파일 (색인 · 출처 · 신뢰도)
├── 01-connection/                     연결 · 세션 · 제한
│   ├── lifecycle.md                   접속 → Hello → Identify → Ready → Heartbeat → Resume
│   ├── opcodes.md                     Gateway Opcode 전체
│   ├── close-codes.md                 Close Code 전체 + 재접속 가능 여부
│   └── rate-limits-sharding.md        전송 제한 · Identify 제한 · 샤딩 · 압축
├── 02-intents/                        인텐트 (이벤트 구독 필터)
│   ├── intent-bits.md                 21개 인텐트 비트값 표
│   ├── privileged-intents.md          특권 인텐트 3종 규칙 · 승인 · 효과
│   └── intent-event-matrix.md         인텐트 ↔ 이벤트 매핑 (양방향)
├── 03-events/                         수신(Dispatch) 이벤트 — 총 79개
│   ├── README.md                      전체 이벤트 색인표
│   ├── connection.md                  READY · RESUMED · RATE_LIMITED
│   ├── guild.md                       GUILD_* · 역할 · 밴 · 감사로그
│   ├── channel-thread.md              CHANNEL_* · THREAD_* · CHANNEL_INFO
│   ├── message.md                     MESSAGE_* (생성/수정/삭제) · 내용 인텐트
│   ├── reaction-poll.md               MESSAGE_REACTION_* · MESSAGE_POLL_VOTE_*
│   ├── user-member-presence.md        GUILD_MEMBER_* · USER_UPDATE · PRESENCE_UPDATE · TYPING_START
│   ├── voice-stage.md                 VOICE_* · STAGE_INSTANCE_*
│   ├── moderation-automod.md          AUTO_MODERATION_* · BAN · AUDIT_LOG
│   ├── expressions-soundboard.md      이모지 · 스티커 · 사운드보드
│   ├── scheduled-events.md            GUILD_SCHEDULED_EVENT_*
│   ├── integration-webhook-invite.md  INTEGRATION_* · WEBHOOKS_UPDATE · INVITE_*
│   ├── interactions-commands.md       INTERACTION_CREATE · APPLICATION_COMMAND_PERMISSIONS_UPDATE
│   └── monetization.md                ENTITLEMENT_* · SUBSCRIPTION_*
├── 04-send-commands/                  송신(Send) 명령
│   ├── identify-resume-heartbeat.md   Op 2 · 6 · 1
│   ├── request-guild-members.md       Op 8
│   ├── update-presence.md             Op 3
│   ├── update-voice-state.md          Op 4
│   ├── request-soundboard-sounds.md   Op 31
│   └── request-channel-info.md        Op 43 (신규)
├── 05-voice-gateway/                  별도 WebSocket (v8) — 음성 전송
│   └── voice-gateway.md               Opcode · Close Code · 암호화 모드 · DAVE(E2EE)
└── 06-reference/
    ├── presence-activity.md           Activity / Presence 객체
    ├── bot-recipes.md                 봇 유형별 필요한 인텐트 조합
    └── sources-and-confidence.md      출처 · 확인 불가 항목 · 갱신 방법
```

## 신뢰도 표기

| 표기 | 의미 |
|---|---|
| ✅ | 아래 패키지의 **소스 코드로 직접 확인** (`discord-api-types@0.38.56`, `discord.py@2.7.1`, `@discordjs/ws@2.0.4`) |
| ⚠️ | 공식 문서 사이트(`discord.com`, `docs.discord.com`)가 이 세션의 네트워크 정책으로 **차단**되어 직접 대조하지 못함. 기존 지식 기반이므로 적용 전 공식 문서로 재확인 권장 |

자세한 내용은 [`06-reference/sources-and-confidence.md`](06-reference/sources-and-confidence.md).

## 한눈에 보는 요약

| 항목 | 수 |
|---|---|
| Gateway Opcode | 13개 (Dispatch 포함) |
| Close Code | 14개 (+ 일반 WebSocket 코드) |
| 인텐트 | 21개 (특권 3개) |
| 수신 Dispatch 이벤트 | 79개 |
| 송신 명령 | 8개 (Heartbeat · Identify · Resume · Presence Update · Voice State Update · Request Guild Members · Request Soundboard Sounds · Request Channel Info) |
| Voice Gateway Opcode | 23개 (DAVE 11개 포함) |

> 특권 인텐트 3종: `GUILD_MEMBERS`, `GUILD_PRESENCES`, `MESSAGE_CONTENT`
