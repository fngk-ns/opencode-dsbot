# 메시지 이벤트

인텐트: 서버 `GUILD_MESSAGES`(1<<9), DM `DIRECT_MESSAGES`(1<<12). 본문 접근은 🔒`MESSAGE_CONTENT`(1<<15).

## `MESSAGE_CREATE` ✅
`Message` 객체 전체 + 아래 **이벤트 추가 필드**:

| 필드 | 설명 |
|---|---|
| `guild_id?` | 서버 메시지일 때 |
| `member?` | 작성자의 **부분 멤버**(user 없음). 서버 텍스트 채널 메시지일 때만 |
| `mentions[]` | 멘션된 유저. 각 항목에 `member?` 포함 가능 |
| `channel_type?` | 메시지가 온 채널 타입 |

## `MESSAGE_UPDATE` ✅
`MESSAGE_CREATE` 와 **같은 구조**(타입 정의 기준 동일한 `APIBaseMessage` + 추가 필드). 편집뿐 아니라 임베드 해석, 플래그 변경, 폴 종료 등으로도 발생한다. ⚠️ 이벤트가 어떤 필드를 포함하는지(전체/부분)는 공식 문서로 재확인 권장 — 방어적으로 필드 존재 여부를 확인하는 편이 안전하다.

## `MESSAGE_DELETE` ✅
`{ id, channel_id, guild_id? }` — 내용은 없다. 삭제 전 내용이 필요하면 **직접 캐시**해야 한다.

## `MESSAGE_DELETE_BULK` ✅
`{ ids[], channel_id, guild_id? }` — 봇/관리자의 일괄 삭제(`bulk-delete`) 시.

## 🔒 `MESSAGE_CONTENT` 로 좌우되는 필드

| 필드 | 인텐트 없을 때 |
|---|---|
| `content` | `""` |
| `embeds` | `[]` |
| `attachments` | `[]` |
| `components` | `[]` |
| (`poll` 도 해당될 수 있음 ⚠️) | |

**예외 (내용이 항상 옴)** — 봇 자신의 메시지, DM, 봇을 멘션한 메시지. → [privileged-intents.md](../02-intents/privileged-intents.md)

## 시스템 메시지
`Message.type` 이 0(Default)/19(Reply) 외인 경우 — 길드 입장, 부스트, 핀 알림, 스레드 생성, 인터랙션 응답 등. 서버 시스템 메시지도 `MESSAGE_CREATE` 로 온다. ⚠️

## 메시지 관련 REST 연계 ⚠️
- 이벤트에 없는 데이터(과거 메시지, 이전 내용)는 REST `GET /channels/{id}/messages` 로 보충
- 반응은 [reaction-poll.md](reaction-poll.md), 타이핑은 [user-member-presence.md](user-member-presence.md)
