# Request Guild Members (Op 8) ✅

대형 길드에서 오프라인 멤버 등 캐시에 없는 멤버를 요청. 응답은 하나 이상의 `GUILD_MEMBERS_CHUNK`.

**필요 인텐트**: 🔒`GUILD_MEMBERS` (`presences:true` 는 추가로 🔒`GUILD_PRESENCES`) ⚠️

## 요청 형태 2가지

### A. query 방식
```jsonc
{ "op": 8, "d": { "guild_id": "…", "query": "ab", "limit": 25, "presences": false, "nonce": "req-1" } }
```
| 필드 | 설명 |
|---|---|
| `query` | 유저명이 이 문자열로 **시작**하는 멤버. `""` 이면 전체 |
| `limit` | 최대 개수. `query:""` 와 `limit:0` 이면 **전체 멤버** |

### B. user_ids 방식
```jsonc
{ "op": 8, "d": { "guild_id": "…", "user_ids": ["1", "2"], "nonce": "req-2" } }
```
`user_ids` 는 단일 Snowflake 또는 배열.

## 공통 필드
| 필드 | 설명 |
|---|---|
| `guild_id` | 대상 길드 |
| `presences?` | 프레즌스 포함 여부 |
| `nonce?` | 응답 매칭용. **최대 32바이트**, 초과 시 무시되어 응답에 안 붙음 |

## 응답: `GUILD_MEMBERS_CHUNK`
`members[]`, `chunk_index/chunk_count`, `not_found?`, `presences?`, `nonce?` → [`03-events/user-member-presence.md`](../03-events/user-member-presence.md)

## 제한
- 연결당 송신 120/60s 에 포함.
- 과도한 요청은 연결 종료 대신 **`RATE_LIMITED`**(opcode 8, `retry_after`, `meta.guild_id/nonce`) 로 거부될 수 있음 ✅ → [`03-events/connection.md`](../03-events/connection.md)
- 일반적으로 REST `List Guild Members` / `Search Guild Members` 가 더 간단 — 둘 다 🔒GUILD_MEMBERS 필요. ⚠️
