# 전송 제한 · Identify 제한 · 샤딩 · 압축

## 1. 전송(Send) Rate Limit

| 항목 | 값 |
|---|---|
| 연결당 송신 한도 | **60초에 120개** 명령 ⚠️ (하트비트 포함) |
| 초과 시 | Close Code **4008** 로 연결 종료 |
| 라이브러리 안전 마진 | discord.py: 110/60s ✅ · `@discordjs/ws`: 115 도달 시 sleep ✅ |

> 하트비트 + Presence Update + Voice State Update + Request Guild Members 를 합쳐서 센다. 하트비트용 몫을 항상 남겨둘 것.

### `RATE_LIMITED` 이벤트 (신규) ✅
일부 opcode(현재 **Request Guild Members** 만)는 연결을 끊지 않고 **`RATE_LIMITED` Dispatch 로 개별 거부**한다.

```ts
{ opcode: 8, retry_after: number /* 초 */, meta: { guild_id, nonce? } }
```
→ [`03-events/connection.md`](../03-events/connection.md)

## 2. Identify(세션 시작) 제한

| 제한 | 값 |
|---|---|
| 24시간당 Identify | `session_start_limit.total` (일반 **1000**) ⚠️ |
| 동시 Identify | **5초당 `max_concurrency` 개** (기본 1) |
| 버킷 규칙 | `rate_limit_key = shard_id % max_concurrency` ✅ (`@discordjs/ws` 구현) |
| 초과 시 | Op 9 Invalid Session (`d:false`) 또는 연결 거부 |

> Resume 은 Identify 한도를 소모하지 않는다. ⚠️ → 가능하면 Resume 을 우선한다.

## 3. 샤딩

| 항목 | 규칙 |
|---|---|
| 길드 → 샤드 | `shard_id = (guild_id >> 22) % num_shards` ⚠️ |
| DM | **샤드 0** 으로만 전달 ⚠️ |
| 필수 시점 | 길드 **2,500개** 이상 (4011 `ShardingRequired`) ⚠️ |
| 샤드당 권장 | 약 1,000 길드 이하 (`GET /gateway/bot` 의 `shards` 값 사용) ⚠️ |
| 지정 방법 | Identify `shard: [shard_id, num_shards]` ✅ |
| 잘못된 값 | Close 4010 |
| READY | 사용한 `shard` 값이 되돌아옴 ✅ |

## 4. `large_threshold`

Identify 의 `large_threshold` (50~250, 기본 50): 길드 멤버 수가 이 값을 넘으면 `GUILD_CREATE` 에서 **오프라인 멤버를 생략**하고 `large: true` 로 표시. 이후 `Request Guild Members` 로 보충. ✅

## 5. 압축

| 방식 | 설정 | 비고 |
|---|---|---|
| 스트림 `zlib-stream` | URL `compress=zlib-stream` | 가장 일반적. `Z_SYNC_FLUSH` 단위로 메시지 경계 ✅ |
| 스트림 `zstd-stream` | URL `compress=zstd-stream` | zstd — 대역폭·CPU 효율 ✅ (타입에 포함) |
| 패킷 `compress: true` | Identify 필드 | 개별 패킷 zlib. 구형, 스트림 압축과 병용 불가 ⚠️ |
| 인코딩 | `json` / `etf` | ETF 는 더 작지만 구현 복잡 |

## 6. 큰 봇을 위한 팁 ⚠️

- 메모리: GUILD_CREATE 에 길드 전체 채널/스레드/역할/(조건부)멤버가 오므로 불필요한 인텐트는 끈다 → 대역폭·메모리 절감
- `GUILD_PRESENCES` 는 가장 트래픽이 큰 인텐트
- 샤드 수 변경(리샤딩) 시 전체 재-Identify 필요 → Identify 한도 계획
