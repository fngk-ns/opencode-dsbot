# 특권 인텐트 (Privileged Gateway Intents)

| 인텐트 | 비트 | 일반 용도 |
|---|---:|---|
| `GUILD_MEMBERS` | 1<<1 | 멤버 입퇴장·역할 변경 추적, 전체 멤버 조회 |
| `GUILD_PRESENCES` | 1<<8 | 온라인 상태·활동(게임/음악 등) 추적 |
| `MESSAGE_CONTENT` | 1<<15 | 다른 사용자 메시지의 본문 읽기 |

## 활성화·승인 규칙 ⚠️

| 봇 상태 | 필요 조치 |
|---|---|
| 서버 **100개 미만** | Developer Portal → *Bot* → *Privileged Gateway Intents* 토글만 켜면 사용 가능 |
| 서버 **100개 이상** (인증 필요 구간) | 봇 **인증(Verification)** + 인텐트별 **Discord 승인** 신청 필요. 승인 없이 요청하면 Close **4014** |
| 100개 도달 시 | 승인 전에는 토글이 잠기고 미승인 인텐트는 사용 불가 |

discord.py 도 동일하게 "개발자 포털에서 명시적으로 켜야 하고, 100 길드 이상은 Discord 인증이 필요"라고 명시. ✅

## 인텐트별 효과 상세

### 1) `GUILD_MEMBERS`
**받는 이벤트** ✅: `GUILD_MEMBER_ADD`, `GUILD_MEMBER_UPDATE`, `GUILD_MEMBER_REMOVE`, `THREAD_MEMBERS_UPDATE`(다른 멤버 포함)
**열리는 기능**
- Op 8 `Request Guild Members` (query 전체/`user_ids`) — 이 인텐트 없이는 사용 불가 ⚠️
- `GUILD_CREATE.members` 가 **봇 자신만이 아닌 멤버 목록**을 포함 (large_threshold 영향)
- 멤버 캐시(닉네임·역할·`premium_since`), `User.name/avatar/global_name` 최신화 ✅(discord.py)
- REST `List Guild Members`/`Search Guild Members` 도 이 인텐트 필요 ⚠️

### 2) `GUILD_PRESENCES`
**받는 이벤트** ✅: `PRESENCE_UPDATE`
**열리는 기능**
- `GUILD_CREATE.presences` 채워짐
- Op 8 에서 `presences: true` 사용
- `GUILD_MEMBERS_CHUNK.presences`
- `Member.status / activities / client_status` ✅(discord.py)
- ⚠️ 트래픽이 가장 큼. 필요 없다면 끌 것.

### 3) `MESSAGE_CONTENT`
인텐트 없이도 이벤트(`MESSAGE_CREATE/UPDATE/DELETE`)는 오지만 **내용 필드가 비어 있다**. ✅
비는 필드: `content`, `embeds`, `attachments`, `components` ✅(discord.py) — 공식 문서는 이에 더해 `poll` 도 언급하는 것으로 기억하나 ⚠️ 직접 확인 못 함.

**예외 — 인텐트 없이도 내용이 오는 경우** ✅(discord.py 문서 기준)
1. 봇 **자신이 보낸** 메시지
2. **DM** 메시지
3. 봇을 **멘션**한 메시지 (`@Bot` — 역할 멘션·@everyone 은 제외) ⚠️
4. 봇을 대상으로 한 **메시지 컨텍스트 메뉴** 커맨드의 대상 메시지 ⚠️

**추가로 영향받는 곳**
- `AUTO_MODERATION_ACTION_EXECUTION` 의 `content`, `matched_content` — 이 인텐트가 없으면 빈 값 ✅ (타입 주석: "`MESSAGE_CONTENT` (1<<15) gateway intent is required to receive non-empty values")

## 특권 인텐트 없이 대체하는 방법

| 하고 싶은 것 | 대안 |
|---|---|
| 명령어 처리 | **슬래시 커맨드 / 컨텍스트 메뉴 / 버튼 / 모달** (`INTERACTION_CREATE`, 인텐트 불필요) |
| 멘션 기반 호출 | 봇 멘션 메시지는 내용 수신 가능 (MESSAGE_CONTENT 없이) |
| 멤버 목록 | 필요한 순간 REST `GET /guilds/{id}/members/{user_id}` 로 개별 조회 |
| 입장 환영 | `GUILD_MEMBER_ADD` 는 `GUILD_MEMBERS` 필요 → 대안: 시스템 메시지(`GUILD_MESSAGES`로 type 확인) 또는 Welcome 화면 |
| 상태 조회 | 대안 없음 (PRESENCE 는 `GUILD_PRESENCES` 필수) |
