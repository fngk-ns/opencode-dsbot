# 연결 이벤트 (인텐트 불필요)

## `READY` ✅
세션이 성립했을 때 1회. `d` 필드:

| 필드 | 타입 | 설명 |
|---|---|---|
| `v` | number | API 버전 (10) ⚠️ |
| `user` | User | 봇 유저 |
| `guilds` | UnavailableGuild[] | 봇이 속한 길드(아직 `unavailable`). 이후 `GUILD_CREATE` 로 채워짐 |
| `session_id` | string | Resume 용 |
| `resume_gateway_url` | string | **Resume 시 접속할 URL** |
| `shard?` | [id, count] | Identify 에서 보낸 경우 |
| `application` | `{ id, flags, flags_new }` | 앱 ID · 플래그 (`GatewayApplicationFlags` 등) |

## `RESUMED` ✅
`d` 없음. 놓친 이벤트 재전송이 끝났음을 의미.

## `RATE_LIMITED` ✅ (신규)
전송 제한에 걸린 요청을 연결 종료 없이 알려주는 이벤트. 현재 **Request Guild Members(Op 8)** 만 해당.

| 필드 | 설명 |
|---|---|
| `opcode` | 제한된 요청의 opcode |
| `retry_after` | 다시 보낼 때까지 대기할 **초** |
| `meta` | opcode 별 메타. Op 8 → `{ guild_id, nonce? }` — 응답 `GUILD_MEMBERS_CHUNK` 의 `nonce` 와 매칭 |

> 이 이벤트로 알려지는 요청은 **처리되지 않았다**. `retry_after` 후 재전송. `meta.nonce` 로 어떤 요청이었는지 식별한다.
