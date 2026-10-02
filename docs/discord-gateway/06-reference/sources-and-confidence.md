# 출처 · 신뢰도 · 한계

## 조사 상황 (솔직한 기록)

이 조사를 수행한 세션의 네트워크 정책이 `discord.com` 과 `docs.discord.com` 을 **차단**하여 Discord 공식 개발자 문서를 직접 열람하지 못했다. 정책을 우회하지 않고, 허용된 패키지 레지스트리에서 받은 **공식 문서 기반 자동 생성 타입**과 **널리 쓰이는 오픈소스 라이브러리 소스**로 대체 확인했다.

## 사용한 1차 소스

| 소스 | 버전 | 활용 |
|---|---|---|
| [`discord-api-types`](https://www.npmjs.com/package/discord-api-types) | 0.38.56 | Opcode · Close Code · 인텐트 비트 · 79개 Dispatch 이벤트 이름 · 모든 페이로드 필드 · 송신 명령 · Voice Gateway v8 |
| [`discord.py`](https://pypi.org/project/discord.py/) | 2.7.1 | **인텐트별 이벤트 목록**, 특권 인텐트 규칙, 송신 한도 110/60s, DAVE |
| [`@discordjs/ws`](https://www.npmjs.com/package/@discordjs/ws) | 2.0.4 | 하트비트 지터, 송신 한도(115), `max_concurrency` 버킷, Close Code 처리, `resume_gateway_url` |

## 표기

- ✅ 위 소스의 **코드/주석에서 직접 확인**한 사항
- ⚠️ 위 소스에서 직접 확인되지 않아 **기존 지식**에 기반한 사항 — 아래 목록은 특히 재확인 필요

## 재확인이 필요한 항목 (우선순위순)

| # | 항목 | 이유 |
|--:|---|---|
| 1 | `VOICE_CHANNEL_STATUS_UPDATE`, `VOICE_CHANNEL_START_TIME_UPDATE`, `CHANNEL_INFO`, Op 43 의 필요 인텐트·권한 | 신규 항목. 타입 정의에는 있으나 요건 미확인 |
| 2 | `RATE_LIMITED` 가 적용되는 opcode 범위 | 타입상 현재 Op 8 만 매핑 |
| 3 | 송신 한도 120/60s, Identify 1000/24h, 샤딩 2,500 기준 | 기존 지식 (라이브러리는 안전 마진 110/115 사용 확인) |
| 4 | 특권 인텐트 승인 임계치(100 서버)와 신청 절차 | discord.py 문서로 "100 길드" 확인, 세부 절차는 미확인 |
| 5 | `MESSAGE_CONTENT` 대상 필드에 `poll` 포함 여부 | discord.py 는 4개 필드만 명시 |
| 6 | `INTERACTION_CREATE` 의 인텐트 불필요 · 3초 제한 · 컨텍스트 필드 | 기존 지식 |
| 7 | `INVITE_*`, 감사 로그, AutoMod 이벤트의 필요 **권한** | 기존 지식 |
| 8 | DAVE(E2EE) 의무화 시점·범위 | Close Code 4017 존재만 확인 |
| 9 | `MESSAGE_UPDATE` 가 전체/부분 중 무엇을 보내는지 | 타입 정의는 전체 메시지 기준 |

## 공식 문서 직접 확인용 위치

- Gateway: `https://docs.discord.com/developers/events/gateway`
- Gateway Events: `https://docs.discord.com/developers/events/gateway-events`
- Opcodes & Status Codes: `https://docs.discord.com/developers/topics/opcodes-and-status-codes`
- Change Log: `https://docs.discord.com/developers/change-log`
- 원본 저장소: `discord/discord-api-docs`

## 갱신 방법 (재현)

```bash
npm pack discord-api-types && tar xzf discord-api-types-*.tgz
# 이벤트/인텐트/opcode 열거형
sed -n 1,260p package/gateway/v10.d.ts
# Voice
sed -n 1,200p package/voice/v8.d.ts

pip download discord.py --no-deps && unzip discord_py-*.whl
sed -n 840,1400p discord/flags.py     # 인텐트별 이벤트 목록
```
버전이 오르면 `GatewayDispatchEvents`, `GatewayOpcodes`, `GatewayIntentBits` 의 diff 로 신규 기능을 가장 빠르게 파악할 수 있다.
