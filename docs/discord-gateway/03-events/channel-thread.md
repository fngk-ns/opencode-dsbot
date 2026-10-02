# 채널 · 스레드 이벤트

## 채널 (`GUILDS`) ✅

| 이벤트 | `d` | 비고 |
|---|---|---|
| `CHANNEL_CREATE` | Channel (+`guild_id`) | 스레드 제외한 길드 채널 |
| `CHANNEL_UPDATE` | Channel | 이름·권한 덮어쓰기·토픽 등 |
| `CHANNEL_DELETE` | Channel | |
| `CHANNEL_PINS_UPDATE` | `{ guild_id?, channel_id, last_pin_timestamp? }` | 핀 추가/삭제. 서버=`GUILDS`, DM=`DIRECT_MESSAGES` ⚠️ |

> 타입 정의상 `CHANNEL_*` 의 `type` 은 `Exclude<GuildChannelType, ThreadChannelType>` — 텍스트/음성/카테고리/공지/스테이지/포럼/미디어 등. ✅

## 채널 임시 정보 (신규) ✅

### `CHANNEL_INFO`
**Op 43 `Request Channel Info`** 의 응답.

| 필드 | 설명 |
|---|---|
| `guild_id` | 길드 |
| `channels[]` | `{ id, status?, voice_start_time? }` |
| `channels[].status` | 음성 채널 상태 텍스트 |
| `channels[].voice_start_time` | 음성 세션 시작 Unix 초 |

→ [`04-send-commands/request-channel-info.md`](../04-send-commands/request-channel-info.md). 변경 알림은 [`voice-stage.md`](voice-stage.md) 의 `VOICE_CHANNEL_STATUS_UPDATE` / `VOICE_CHANNEL_START_TIME_UPDATE`.

### 채널 난독화(obfuscation) ✅ `@unstable`
Identify `capabilities` 에 `ChannelObfuscation (1<<15)` 를 주면 봇이 **볼 수 없는 채널**의 난독화된 메타데이터를 받는다. 테스트용 옵트인이며 추후 모든 봇에 자동 적용될 예정이라고 타입 주석에 명시.

## 스레드 (`GUILDS`) ✅

| 이벤트 | `d` | 비고 |
|---|---|---|
| `THREAD_CREATE` | Thread (+`newly_created?: true`) | 새로 생성됐거나 **봇이 스레드에 추가**됐을 때. `newly_created` 로 구분 |
| `THREAD_UPDATE` | Thread | 이름·보관(archive)·잠금 등 |
| `THREAD_DELETE` | `{ id, guild_id, parent_id, type }` | 최소 정보만 |
| `THREAD_LIST_SYNC` | `{ guild_id, channel_ids?, threads[], members[] }` | 봇이 **채널 접근 권한을 얻을 때** 활성 스레드 일괄 동기화. `channel_ids` 없으면 길드 전체 |
| `THREAD_MEMBER_UPDATE` | ThreadMember + `guild_id` | **봇 자신**의 스레드 멤버 정보 변경 |
| `THREAD_MEMBERS_UPDATE` | `{ id, guild_id, member_count, added_members?, removed_member_ids? }` | `member_count` 는 50 초과를 세지 않음. 다른 멤버 변경까지 받으려면 🔒`GUILD_MEMBERS` |

### 스레드 관련 실무 포인트 ⚠️
- 보관된(archived) 스레드는 이벤트가 오지 않는다. 필요하면 REST 로 조회 후 join.
- 봇이 스레드 메시지를 받으려면 스레드에 **참가(join)** 되어 있거나 해당 스레드가 보이는 상태여야 함.
- 포럼/미디어 채널의 포스트는 스레드로 취급되어 `THREAD_CREATE` 로 온다.
