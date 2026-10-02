# Presence · Activity 객체 ✅

출처: `discord-api-types` `payloads/v10/gateway`

## Presence (수신: `PRESENCE_UPDATE`, `GUILD_CREATE.presences`, `GUILD_MEMBERS_CHUNK.presences`)

| 필드 | 설명 |
|---|---|
| `user` | 부분 유저 (`id` 만 필수) |
| `guild_id` | 길드 (`PRESENCE_UPDATE`) |
| `status` | `online` `dnd` `idle` `offline` |
| `activities[]` | Activity |
| `client_status` | `desktop` / `mobile` / `web` / `vr` 별 상태 |

## Activity

| 필드 | 설명 | 봇 송신 |
|---|---|:---:|
| `name` | 활동 이름 | ✔ |
| `type` | 0 Playing · 1 Streaming · 2 Listening · 3 Watching · 4 Custom · 5 Competing | ✔ |
| `url?` | 스트리밍 URL (type 1) | ✔ |
| `state?` | 파티 상태 / 커스텀 상태 문구 | ✔ |
| `details?`, `details_url?`, `state_url?` | 세부 문구·링크 | ✘ |
| `status_display_type?` | 상태 표시에 쓸 필드: 0 Name · 1 State · 2 Details | ✘ |
| `created_at` | 추가 시각 | |
| `timestamps?` | `{ start?, end? }` (ms) | ✘ |
| `application_id?` | 앱 ID | ✘ |
| `emoji?` | 커스텀 상태 이모지 `{ name, id?, animated? }` | ✘ |
| `party?` | `{ id?, size?: [현재, 최대] }` | ✘ |
| `assets?` | `large_image/large_text/large_url/small_image/small_text/small_url/invite_cover_image` | ✘ |
| `secrets?` | `join` / `spectate` / `match` | ✘ |
| `instance?` | 인스턴스 게임 세션 | ✘ |
| `flags?` | ActivityFlags | ✘ |
| `buttons?` | 최대 2개 `{ label(1-32), url(1-512) }` | ✘ |
| `id`, `sync_id`, `platform`, `session_id` | 비공식 (`@unstable`) | |

## ActivityFlags (비트)
`Instance=1`, `Join=2`, `Spectate=4`, `JoinRequest=8`, `Sync=16`, `Play=32`, `PartyPrivacyFriends=64`, `PartyPrivacyVoiceChannel=128`, `Embedded=256`

## ActivityPlatform (비공식, `@unstable`)
`desktop`, `xbox`, `samsung`, `ios`, `android`, `embedded`, `ps4`, `ps5`

## 봇이 보낼 수 있는 것 요약
`GatewayActivityUpdateData = Pick<GatewayActivity, 'name' | 'state' | 'type' | 'url'>` — 그 외 Rich Presence 필드는 전송 불가. ✅
