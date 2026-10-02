# 모더레이션 이벤트

## 밴 · 감사 로그 (`GUILD_MODERATION` 1<<2) ✅
(구 이름 `GUILD_BANS`)

| 이벤트 | `d` | 비고 |
|---|---|---|
| `GUILD_BAN_ADD` | `{ guild_id, user }` | |
| `GUILD_BAN_REMOVE` | `{ guild_id, user }` | 밴 해제 |
| `GUILD_AUDIT_LOG_ENTRY_CREATE` | AuditLogEntry + `guild_id` | 감사 로그 항목 실시간 수신. 봇에 `VIEW_AUDIT_LOG` 권한 필요 ⚠️ |

추방(kick)/타임아웃/역할 변경 등은 별도 이벤트가 없다 → `GUILD_MEMBER_REMOVE`/`GUILD_MEMBER_UPDATE`(🔒) + **감사 로그 항목**의 `action_type` 으로 원인을 판별한다.

## AutoMod (자동 관리)

### 규칙 설정 변경 — `AUTO_MODERATION_CONFIGURATION` (1<<20) ✅
| 이벤트 | `d` |
|---|---|
| `AUTO_MODERATION_RULE_CREATE` | AutoModerationRule |
| `AUTO_MODERATION_RULE_UPDATE` | AutoModerationRule |
| `AUTO_MODERATION_RULE_DELETE` | AutoModerationRule |

> 봇에 `MANAGE_GUILD` 권한이 있을 때만 수신 ⚠️

### 규칙 실행 — `AUTO_MODERATION_EXECUTION` (1<<21) ✅
`AUTO_MODERATION_ACTION_EXECUTION`

| 필드 | 설명 |
|---|---|
| `guild_id` | 길드 |
| `action` | 실행된 동작(`block_message` / `send_alert_message` / `timeout` / `block_member_interaction`) ⚠️ |
| `rule_id` | 규칙 ID |
| `rule_trigger_type` | 규칙 트리거 종류(키워드·스팸·키워드 프리셋·멘션 스팸 등) |
| `user_id` | 내용을 만든 유저 |
| `channel_id?` | 채널 |
| `message_id?` | 메시지 — **AutoMod 가 차단한 메시지나 메시지가 아닌 콘텐츠는 없음** |
| `alert_system_message_id?` | `send_alert_message` 일 때 전송된 시스템 메시지 ID |
| `content` | 사용자 작성 텍스트 — 🔒`MESSAGE_CONTENT` 없으면 빈 값 |
| `matched_keyword` | 규칙에 설정된 단어/구문 |
| `matched_content` | 실제 일치한 부분 — 🔒`MESSAGE_CONTENT` 없으면 빈 값 |

> v10: `MESSAGE_CONTENT` 인텐트가 없으면 `content`/`matched_content` 가 비어 오는 것이 변경점. ✅ (타입 주석)
