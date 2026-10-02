# 봇 유형별 필요한 인텐트 조합

값은 [`../02-intents/intent-bits.md`](../02-intents/intent-bits.md) 기준. 🔒 = 특권.

| 봇 유형 | 인텐트 | 숫자 |
|---|---|---:|
| **슬래시 커맨드 전용** | 없음 (`INTERACTION_CREATE`) | 0 |
| 슬래시 + 캐시(채널/역할/길드) | `GUILDS` | 1 |
| 접두어(!) 명령 봇 | `GUILDS` `GUILD_MESSAGES` 🔒`MESSAGE_CONTENT` | 1+512+32768 = **33281** |
| 멘션 호출 봇(`@봇 …`) | `GUILDS` `GUILD_MESSAGES` (멘션 메시지는 내용 수신) | 1+512 = **513** |
| 환영/퇴장 봇 | `GUILDS` 🔒`GUILD_MEMBERS` | 1+2 = **3** |
| 역할 반응(리액션 롤) 봇 | `GUILDS` `GUILD_MESSAGE_REACTIONS` (+🔒`GUILD_MEMBERS` 로 역할 부여 대상 멤버 캐시) | 1+1024 = **1025** |
| 모더레이션/로깅 봇 | `GUILDS` 🔒`GUILD_MEMBERS` `GUILD_MODERATION` `GUILD_MESSAGES` `GUILD_INVITES` `GUILD_VOICE_STATES` (+🔒`MESSAGE_CONTENT`) | 1+2+4+512+64+128 = **711** (+32768) |
| AutoMod 연동 봇 | `AUTO_MODERATION_CONFIGURATION` `AUTO_MODERATION_EXECUTION` (+🔒`MESSAGE_CONTENT` 로 매치 내용) | 1048576+2097152 = **3145728** |
| 음악/음성 봇 | `GUILDS` `GUILD_VOICE_STATES` | 1+128 = **129** |
| 상태 대시보드 | `GUILDS` 🔒`GUILD_PRESENCES` 🔒`GUILD_MEMBERS` | 1+256+2 = **259** |
| 폴 집계 봇 | `GUILDS` `GUILD_MESSAGE_POLLS` | 1+16777216 = **16777217** |
| 이벤트 알림 봇 | `GUILDS` `GUILD_SCHEDULED_EVENTS` | 1+65536 = **65537** |
| 이모지/스티커 관리 | `GUILDS` `GUILD_EXPRESSIONS` | 1+8 = **9** |
| 수익화 봇 | 없음 (`ENTITLEMENT_*`, `SUBSCRIPTION_*`) | 0 |
| DM 봇 | `DIRECT_MESSAGES` (+`DIRECT_MESSAGE_REACTIONS` 등) | 4096 |

## 원칙
1. **최소 인텐트**만 켠다 — 대역폭·메모리·4014 위험 감소.
2. 특권 인텐트 의존을 줄이려면 슬래시 커맨드·컨텍스트 메뉴·버튼·모달을 우선한다.
3. 100 서버가 가까워지면 **미리** 인증·인텐트 승인 신청.
4. 이벤트를 놓치지 않으려면 캐시 의존 이벤트보다 **raw 이벤트**를 쓰고, 모르는 필드는 방어적으로 처리.
