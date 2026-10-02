# 예약 이벤트 (`GUILD_SCHEDULED_EVENTS` 1<<16) ✅

| 이벤트 | `d` | 설명 |
|---|---|---|
| `GUILD_SCHEDULED_EVENT_CREATE` | GuildScheduledEvent | 생성 |
| `GUILD_SCHEDULED_EVENT_UPDATE` | GuildScheduledEvent | 수정 · **상태 전환**(예약됨→진행 중→종료/취소) |
| `GUILD_SCHEDULED_EVENT_DELETE` | GuildScheduledEvent | 삭제 |
| `GUILD_SCHEDULED_EVENT_USER_ADD` | `{ guild_scheduled_event_id, user_id, guild_id }` | 유저가 "관심 있음" 등록 |
| `GUILD_SCHEDULED_EVENT_USER_REMOVE` | 〃 | 등록 해제 |

## 팁 ⚠️
- 이벤트 시작/종료 알림은 `UPDATE` 의 `status` 변화로 구현한다 (SCHEDULED=1, ACTIVE=2, COMPLETED=3, CANCELED=4).
- 참여자 목록은 이벤트가 아닌 REST (`GET /guilds/{id}/scheduled-events/{event_id}/users`) 로 가져온다.
- `GUILD_CREATE.guild_scheduled_events` 로 초기 상태가 채워진다.
