# Gateway Close Codes ✅

출처: `discord-api-types` `GatewayCloseCodes`. 재접속 열은 `@discordjs/ws` 의 처리 방식 ✅ 및 공식 문서 표 ⚠️ 기준.

| 코드 | 이름 | 설명 | 재접속 |
|---:|---|---|---|
| 4000 | Unknown Error | 원인 불명 | ✅ Resume |
| 4001 | Unknown Opcode | 잘못된 opcode / 페이로드 | ✅ Resume |
| 4002 | Decode Error | 잘못된 페이로드 | ✅ Resume |
| 4003 | Not Authenticated | Identify 전에 페이로드 전송 | ✅ 새 세션 |
| 4004 | Authentication Failed | **토큰 오류** | ❌ |
| 4005 | Already Authenticated | Identify 중복 | ✅ |
| 4007 | Invalid Seq | Resume 의 시퀀스 번호가 잘못됨 | ✅ 새 세션 |
| 4008 | Rate Limited | 전송 제한 초과 (→ [rate-limits-sharding.md](rate-limits-sharding.md)) | ✅ |
| 4009 | Session Timed Out | 세션 만료 | ✅ 새 세션 |
| 4010 | Invalid Shard | 잘못된 `shard` 값 | ❌ |
| 4011 | Sharding Required | 길드 수가 많아 샤딩 필수 | ❌ (샤드 수 늘려야 함) |
| 4012 | Invalid API Version | 잘못된 Gateway 버전 | ❌ |
| 4013 | Invalid Intents | 인텐트 비트 계산 오류 | ❌ |
| 4014 | Disallowed Intents | **미승인/미활성 특권 인텐트** 요청 | ❌ |

## 실무 메모

- **4014** 가 가장 흔한 초기 오류: Developer Portal → Bot → *Privileged Gateway Intents* 에서 토글하지 않고 `GUILD_MEMBERS`/`GUILD_PRESENCES`/`MESSAGE_CONTENT` 를 요청했을 때. 100개 이상 서버에서는 Discord 승인까지 필요. → [privileged-intents.md](../02-intents/privileged-intents.md)
- **4011** 은 일반적으로 2,500 길드 이상에서 발생.
- **4004** 는 토큰 재발급(reset) 직후 구 토큰 사용 시에도 발생.
- 4000번대가 아닌 일반 WebSocket 코드(1000/1001 등)로 닫으면 **세션이 무효화**되어 Resume 불가. Resume 을 하려면 1000/1001 이외 코드로 닫는다. ⚠️
