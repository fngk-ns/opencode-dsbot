# 반응 · 폴 이벤트

## 반응 (`GUILD_MESSAGE_REACTIONS` 1<<10 / `DIRECT_MESSAGE_REACTIONS` 1<<13) ✅

| 이벤트 | `d` 핵심 필드 |
|---|---|
| `MESSAGE_REACTION_ADD` | `user_id, channel_id, message_id, guild_id?, emoji, burst, type` + `member?`, `message_author_id?`, `burst_colors?` |
| `MESSAGE_REACTION_REMOVE` | `user_id, channel_id, message_id, guild_id?, emoji, burst, type` |
| `MESSAGE_REACTION_REMOVE_ALL` | `channel_id, message_id, guild_id?` (이모지 정보 없음) |
| `MESSAGE_REACTION_REMOVE_EMOJI` | `channel_id, message_id, guild_id?, emoji` |

| 필드 | 설명 |
|---|---|
| `burst` | 슈퍼 리액션 여부 |
| `type` | `ReactionType` — 일반(0) / 버스트(1) ⚠️ |
| `burst_colors[]` | 슈퍼 리액션 애니메이션 색 `#rrggbb` |
| `message_author_id` | 반응이 달린 메시지 작성자 ID (ADD 만) |
| `member` | 서버에서 반응한 멤버 (ADD 만) |

> 오래된/캐시 밖 메시지의 반응도 오므로 **raw 이벤트**로 처리하면 놓치지 않는다 (discord.py `on_raw_reaction_*`).

## 폴 투표 (`GUILD_MESSAGE_POLLS` 1<<24 / `DIRECT_MESSAGE_POLLS` 1<<25) ✅

| 이벤트 | `d` |
|---|---|
| `MESSAGE_POLL_VOTE_ADD` | `{ user_id, channel_id, message_id, guild_id?, answer_id }` |
| `MESSAGE_POLL_VOTE_REMOVE` | 〃 |

- 폴 결과 **집계**는 `MESSAGE_UPDATE`(폴 종료 시 `poll.results.is_finalized`) 와 REST 로 조회. ⚠️
- 폴 질문/답변 본문의 노출은 🔒`MESSAGE_CONTENT` 영향 가능성 ⚠️
