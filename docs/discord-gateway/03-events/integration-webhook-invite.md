# 통합 · 웹훅 · 초대 이벤트

## 통합 (`GUILD_INTEGRATIONS` 1<<4) ✅

| 이벤트 | `d` |
|---|---|
| `GUILD_INTEGRATIONS_UPDATE` | `{ guild_id }` — 통합 변경 알림만 (상세는 REST) |
| `INTEGRATION_CREATE` | Integration + `guild_id` |
| `INTEGRATION_UPDATE` | Integration + `guild_id` |
| `INTEGRATION_DELETE` | `{ id, guild_id, application_id? }` |

## 웹훅 (`GUILD_WEBHOOKS` 1<<5) ✅

| 이벤트 | `d` |
|---|---|
| `WEBHOOKS_UPDATE` | `{ guild_id, channel_id }` — 웹훅 생성/수정/삭제 시. **어떤 웹훅인지는 담기지 않음** → REST `GET /channels/{id}/webhooks` 로 조회 |

## 초대 (`GUILD_INVITES` 1<<6) ✅

| 이벤트 | `d` |
|---|---|
| `INVITE_CREATE` | `{ channel_id, code, created_at, guild_id?, inviter?, max_age, max_uses, target_type?, target_user?, target_application?, temporary, uses(항상 0), expires_at, role_ids? }` |
| `INVITE_DELETE` | `{ channel_id, guild_id?, code }` |

- 해당 채널의 `MANAGE_CHANNELS` 권한이 필요 ⚠️
- `target_type`: 음성 채널 스트림 초대 / 임베디드 앱 초대 구분
- `role_ids`: 초대를 수락한 유저에게 부여될 역할 ✅ (신규 필드)
- **초대 사용 추적**(누가 어떤 초대로 들어왔나)은 이벤트가 없다 → `INVITE_CREATE` 로 캐시 후 `GUILD_MEMBER_ADD`(🔒) 시점에 REST 로 `uses` 비교
