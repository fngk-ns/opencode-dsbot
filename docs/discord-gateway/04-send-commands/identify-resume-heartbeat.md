# Identify · Resume · Heartbeat (Op 2 · 6 · 1)

## Identify (Op 2) ✅

```jsonc
{
  "op": 2,
  "d": {
    "token": "BOT_TOKEN",
    "properties": { "os": "linux", "browser": "mylib", "device": "mylib" },
    "compress": false,
    "large_threshold": 250,
    "shard": [0, 1],
    "presence": { "since": null, "activities": [], "status": "online", "afk": false },
    "intents": 53575421,
    "capabilities": 0
  }
}
```

| 필드 | 필수 | 설명 |
|---|:---:|---|
| `token` | ✔ | 봇 토큰 |
| `properties` | ✔ | `os` · `browser` · `device` (라이브러리명 권장) |
| `intents` | ✔ | [인텐트 비트](../02-intents/intent-bits.md) 합 |
| `compress` | | 패킷 단위 zlib 압축 (기본 `false`) |
| `large_threshold` | | 50~250 (기본 50) — 오프라인 멤버 생략 기준 |
| `shard` | | `[shard_id, shard_count]` |
| `presence` | | 초기 프레즌스 → [update-presence.md](update-presence.md) |
| `capabilities` | | 클라이언트 기능 비트필드(기본 0). 현재 `ChannelObfuscation = 1<<15` (불안정·테스트 전용) |

## Resume (Op 6) ✅

```jsonc
{ "op": 6, "d": { "token": "BOT_TOKEN", "session_id": "...", "seq": 1337 } }
```
- `resume_gateway_url` 로 접속한 뒤 Hello 직후 전송. → [lifecycle.md](../01-connection/lifecycle.md#4-resume-재개)

## Heartbeat (Op 1) ✅

```jsonc
{ "op": 1, "d": 251 }   // 마지막 시퀀스 s, 없으면 null
```
- 서버의 Hello 가 준 `heartbeat_interval` 마다 전송. 첫 번째는 `interval × 0~1` 지터.
- ACK(Op 11) 미수신 시 연결 종료·Resume.
