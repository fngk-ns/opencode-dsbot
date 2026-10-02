# 길드 · 역할 이벤트 (`GUILDS`)

## `GUILD_CREATE` ✅
발생 시점 3가지: ① 접속 후 초기 로딩(READY 이후 길드별) ② 길드가 장애에서 복구(`unavailable` 해제) ③ 봇이 **새 길드에 참가**.

`APIGuild` 전체 + **이 이벤트에서만** 오는 필드:

| 필드 | 설명 | 인텐트 영향 |
|---|---|---|
| `joined_at` | 봇 참가 시각 | |
| `large` | 대형 길드 여부 (`large_threshold` 초과) | |
| `unavailable?` | 장애로 이용 불가 | |
| `member_count` | 총 멤버 수 | |
| `voice_states[]` | 음성 상태(`guild_id` 없음) | |
| `members[]` | 멤버 | 🔒GUILD_MEMBERS 없으면 사실상 봇 자신 위주 |
| `channels[]` | 채널 (스레드 제외) | |
| `threads[]` | 활성 스레드 | |
| `presences[]` | 프레즌스 (대형 길드는 비오프라인만) | 🔒GUILD_PRESENCES 없으면 비어 있음 |
| `stage_instances[]` | 스테이지 | |
| `guild_scheduled_events[]` | 예약 이벤트 | |
| `soundboard_sounds[]` | 사운드보드 | |

## `GUILD_UPDATE` ✅
`APIGuild` 전체 (이름·아이콘·설정·부스트 등 변경).

## `GUILD_DELETE` ✅
`{ id, unavailable? }` — `unavailable: true` = 장애(재접속 대기), **필드 없음 = 봇이 추방/탈퇴/길드 삭제**됨. 이때 캐시 제거.

## `GUILD_ROLE_CREATE` / `GUILD_ROLE_UPDATE` ✅
`{ guild_id, role }`

## `GUILD_ROLE_DELETE` ✅
`{ guild_id, role_id }`

> 멤버의 역할 **부여/회수**는 `GUILD_MEMBER_UPDATE`(🔒GUILD_MEMBERS) — [user-member-presence.md](user-member-presence.md)

## 같은 영역의 다른 이벤트
| 주제 | 문서 |
|---|---|
| 밴 · 감사 로그 | [moderation-automod.md](moderation-automod.md) |
| 이모지 · 스티커 · 사운드보드 | [expressions-soundboard.md](expressions-soundboard.md) |
| 통합 · 웹훅 · 초대 | [integration-webhook-invite.md](integration-webhook-invite.md) |
