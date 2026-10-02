# Update Presence (Op 3) ✅

봇의 상태·활동 설정. Identify 의 `presence` 와 같은 구조.

```jsonc
{
  "op": 3,
  "d": {
    "since": null,              // idle 시작 시각 (Unix ms) 또는 null
    "activities": [{ "name": "명령어 대기", "type": 3 }],
    "status": "online",         // online | dnd | idle | invisible | offline
    "afk": false
  }
}
```

| 필드 | 설명 |
|---|---|
| `status` | `online`, `dnd`, `idle`, `invisible`(오프라인처럼 표시), `offline` |
| `since` | 클라이언트가 idle 이 된 시각(ms) |
| `afk` | AFK 여부 |
| `activities[]` | **봇은 `name`, `type`, `state`, `url` 4개 필드만 전송 가능** (타입 `Pick<GatewayActivity,'name'|'state'|'type'|'url'>`) ✅ |

## Activity 타입 ✅
| type | 표시 | 비고 |
|---:|---|---|
| 0 | Playing {name} | |
| 1 | Streaming {details} | `url` 필요 (트위치/유튜브) |
| 2 | Listening to {name} | |
| 3 | Watching {details} | |
| 4 | Custom ({emoji} {state}) | `state` 에 문구 |
| 5 | Competing in {name} | |

> Rich Presence 필드(`assets`, `party`, `secrets`, `buttons` …)는 수신(`PRESENCE_UPDATE`)에서는 보이지만 봇이 보낼 수는 없다. → [`06-reference/presence-activity.md`](../06-reference/presence-activity.md)

송신 제한(120/60s)에 포함. 특권 인텐트 불필요.
