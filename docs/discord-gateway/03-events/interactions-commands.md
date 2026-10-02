# 인터랙션 · 커맨드 이벤트 (인텐트 불필요)

## `INTERACTION_CREATE` ✅
`d` = Interaction. 유형(`type`):

| 값 | 종류 |
|---:|---|
| 1 | PING (HTTP 인터랙션 엔드포인트 확인용 — Gateway 에선 보통 안 옴) |
| 2 | APPLICATION_COMMAND (슬래시 · 유저/메시지 컨텍스트 메뉴 · Entry Point) |
| 3 | MESSAGE_COMPONENT (버튼 · 셀렉트 메뉴) |
| 4 | APPLICATION_COMMAND_AUTOCOMPLETE |
| 5 | MODAL_SUBMIT |

⚠️ 값/종류는 공식 문서 지식 기반.

### 특징
- **인텐트 0 으로도 수신**, 즉 `MESSAGE_CONTENT` 같은 특권 인텐트 없이 사용자 입력을 받는 정석 경로.
- **3초 이내**에 응답(`POST /interactions/{id}/{token}/callback`)해야 하며, 이후 15분 동안 follow-up 가능. ⚠️
- 같은 인터랙션을 HTTP Webhook 으로도 받을 수 있으나 **Gateway 와 HTTP 를 동시에 쓸 수 없다**(HTTP 엔드포인트 설정 시 Gateway 로 안 옴). ⚠️
- 컨텍스트: `context` (길드 / 봇 DM / 비공개 채널), `authorizing_integration_owners`(서버 설치 vs 유저 설치) ⚠️
- 유저 설치 앱(User-installed app)은 길드에 봇이 없어도 인터랙션을 받는다 ⚠️

## `APPLICATION_COMMAND_PERMISSIONS_UPDATE` ✅
서버 관리자가 **커맨드 권한**(역할/유저/채널별 허용·거부)을 변경했을 때.

| 필드 | 설명 |
|---|---|
| `id` | 커맨드 ID **또는 앱 ID**(앱 전체 기본 권한) |
| `application_id` | 앱 ID |
| `guild_id` | 길드 |
| `permissions[]` | 최대 100개 |
