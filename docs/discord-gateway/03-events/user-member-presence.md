# 유저 · 멤버 · 프레즌스 · 타이핑

## 멤버 (🔒`GUILD_MEMBERS` 1<<1) ✅

| 이벤트 | `d` | 설명 |
|---|---|---|
| `GUILD_MEMBER_ADD` | Member + `guild_id` | 서버 입장. 입장 승인(`pending`)·초대 정보 필드 포함 가능 |
| `GUILD_MEMBER_UPDATE` | Member 필드 + `guild_id` | 역할·닉네임·부스트·타임아웃(`communication_disabled_until`)·아바타·플래그 변경 |
| `GUILD_MEMBER_REMOVE` | `{ guild_id, user }` | 퇴장·추방·밴 (구분은 `GUILD_BAN_ADD`/감사로그) |
| `GUILD_MEMBERS_CHUNK` | `{ guild_id, members[], chunk_index, chunk_count, not_found?, presences?, nonce? }` | **Op 8 응답** (인텐트 불필요, 요청 시 필요) |

`GUILD_MEMBER_UPDATE` 타입에는 `joined_at`, 아바타/배너(`avatar`/`banner`), 음성(`deaf`/`mute`), `flags`, `user` 가 필수로 포함. ✅

### `GUILD_MEMBERS_CHUNK` 상세 ✅
- 큰 응답은 여러 조각: `0 <= chunk_index < chunk_count`
- `not_found`: 존재하지 않는 `user_ids`
- `presences`: 요청에 `presences: true` 였을 때 (🔒`GUILD_PRESENCES` 필요)
- `nonce`: 요청에 넣은 nonce (최대 32바이트, 잘못되면 무시되어 응답에 안 붙음)

## 프레즌스 (🔒`GUILD_PRESENCES` 1<<8) ✅

### `PRESENCE_UPDATE`
| 필드 | 설명 |
|---|---|
| `user` | 부분 유저 (`id` 만 필수) |
| `guild_id` | 길드 |
| `status` | `online` `idle` `dnd` `offline` (수신에는 `invisible` 없음) |
| `activities[]` | 활동 목록 → [`06-reference/presence-activity.md`](../06-reference/presence-activity.md) |
| `client_status` | `{ desktop?, mobile?, web?, vr? }` 플랫폼별 상태 |

## 유저

### `USER_UPDATE` ✅
`d` = User. **봇 자신**의 유저 정보(이름·아바타·배너 등)가 바뀔 때. 인텐트 불필요. ⚠️
다른 유저의 프로필 변화는 `GUILD_MEMBER_UPDATE`(🔒) 또는 `PRESENCE_UPDATE`(🔒)로 간접 확인.

## 타이핑 (`GUILD_MESSAGE_TYPING` 1<<11 / `DIRECT_MESSAGE_TYPING` 1<<14) ✅

### `TYPING_START`
`{ channel_id, guild_id?, user_id, timestamp(Unix 초), member? }`

> 약 10초 유효. 종료 이벤트는 없다 — 메시지 전송 또는 타임아웃으로 판단.

## 정리: "유저 정보를 최신으로" 유지하려면
| 알고 싶은 것 | 필요한 인텐트 |
|---|---|
| 새 멤버 입장/퇴장 | 🔒GUILD_MEMBERS |
| 닉네임·역할 변경 | 🔒GUILD_MEMBERS |
| 온라인/게임 중 | 🔒GUILD_PRESENCES |
| 메시지 작성자 정보 | 인텐트 불필요 (`MESSAGE_CREATE.member`, `.author`) |
| 반응한 사람 | `GUILD_MESSAGE_REACTIONS` (`MESSAGE_REACTION_ADD.member`) |
| 봇 자신의 프로필 | 불필요 (`USER_UPDATE`) |
