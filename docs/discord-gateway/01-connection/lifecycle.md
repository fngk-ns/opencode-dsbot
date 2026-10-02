# 연결 수명주기

## 1. Gateway URL 얻기

| 방법 | 설명 |
|---|---|
| `GET /gateway` | URL만 반환 (`{ url }`) |
| `GET /gateway/bot` ✅ | URL + 권장 샤드 수 + `session_start_limit` (봇 토큰 필요, **권장**) |

`GET /gateway/bot` 응답 필드 ✅

| 필드 | 의미 |
|---|---|
| `url` | WSS 접속 URL (보통 `wss://gateway.discord.gg`) |
| `shards` | 권장 샤드 수 |
| `session_start_limit.total` | 24시간당 허용 세션 시작(Identify) 총량 |
| `session_start_limit.remaining` | 남은 횟수 |
| `session_start_limit.reset_after` | 리셋까지 ms |
| `session_start_limit.max_concurrency` | 5초당 동시 Identify 가능 수 (버킷 수) |

> URL은 캐시해도 되지만 변경될 수 있으므로 재접속 시 갱신 권장. ⚠️

## 2. 접속 쿼리 파라미터 ✅

`wss://gateway.discord.gg/?v=10&encoding=json&compress=zlib-stream`

| 파라미터 | 값 | 비고 |
|---|---|---|
| `v` | `10` | API 버전. 현재 `GatewayVersion = "10"` |
| `encoding` | `json` \| `etf` | JSON 또는 Erlang External Term Format |
| `compress` | `zlib-stream` \| `zstd-stream` (선택) | 전송 스트림 압축. 스트림 전체에 걸친 단일 컨텍스트 |

Identify 의 `compress: true` 는 **개별 패킷 zlib 압축**(구형)이며 스트림 압축과 별개. ✅

## 3. 흐름

```
Client                                   Gateway
  │ ── WebSocket 연결 (?v=10&encoding=…) ──▶│
  │ ◀──────────── Op 10 Hello ──────────────│   heartbeat_interval(ms)
  │ ── (jitter 만큼 대기) Op 1 Heartbeat ──▶│   첫 하트비트: interval × random(0~1)
  │ ◀──────────── Op 11 Heartbeat ACK ──────│
  │ ── Op 2 Identify ──────────────────────▶│   token · intents · shard · presence …
  │ ◀──────────── Op 0 READY ───────────────│   user · guilds(unavailable) · session_id · resume_gateway_url
  │ ◀──────── Op 0 GUILD_CREATE × N ────────│   READY 의 각 길드마다 채워서 전송
  │            …… 이후 Dispatch 이벤트 ……    │
```

### Hello (Op 10)
`{ heartbeat_interval }` — 이후 이 주기로 하트비트를 보낸다.

### Heartbeat (Op 1)
- 클라→서버: `d` = 마지막으로 받은 시퀀스 번호 `s` (없으면 `null`) ✅
- 서버가 Op 1 을 보내면 **즉시** 하트비트로 응답해야 한다.
- 다음 하트비트 시점까지 ACK(Op 11)가 없으면 연결이 "죽은 것(zombie)" — 1000/1001 이외의 코드로 닫고 **Resume** 시도. ⚠️
- 구현 예: `@discordjs/ws` 는 첫 하트비트에 `interval × Math.random()` jitter 적용 ✅

### Identify (Op 2)
→ [`04-send-commands/identify-resume-heartbeat.md`](../04-send-commands/identify-resume-heartbeat.md)

### Ready (Op 0, `READY`)
→ [`03-events/connection.md`](../03-events/connection.md). **`session_id`, `resume_gateway_url`, `application` 을 저장**한다.

### GUILD_CREATE 폭풍
READY 직후 `guilds` 에 있던 `unavailable` 길드마다 `GUILD_CREATE` 가 따로 도착한다. 모든 길드가 채워질 때까지 캐시는 불완전하다.

## 4. Resume (재개)

연결이 끊겼을 때 이벤트 유실 없이 이어붙이는 절차.

1. 마지막 `s`(시퀀스), `session_id`, `resume_gateway_url` 을 보관
2. **`resume_gateway_url`** 로 재접속 (`?v=10&encoding=…` 동일 적용) ✅ — 일반 Gateway URL 이 아님
3. Hello 수신 후 **Identify 대신 Resume (Op 6)** 전송: `{ token, session_id, seq }`
4. 서버가 놓친 이벤트를 재전송 → 끝나면 `RESUMED` 디스패치
5. Resume 불가 시 서버가 **Op 9 Invalid Session**

## 5. Reconnect / Invalid Session

| Op | 의미 | 대응 |
|---|---|---|
| 7 Reconnect | 서버가 재접속을 요청 (배포·마이그레이션 등) | 연결 닫고 **Resume** |
| 9 Invalid Session (`d: true`) | 세션이 아직 재개 가능 | 1~5초 대기 후 Resume |
| 9 Invalid Session (`d: false`) | 세션 무효 | 1~5초 랜덤 대기 후 **새 Identify** (`resume_gateway_url` 아닌 기본 URL) ⚠️ |

## 6. 이벤트 페이로드 공통 구조 ✅

```jsonc
{
  "op": 0,        // opcode
  "d": { … },     // 이벤트 데이터
  "s": 42,        // 시퀀스 (op 0 에서만 non-null) → Resume 용
  "t": "MESSAGE_CREATE" // 이벤트명 (op 0 에서만 non-null)
}
```
