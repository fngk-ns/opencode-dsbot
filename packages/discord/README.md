# @opencode-ai/discord

Discord 봇으로 쓰는 opencode. 채널에서 봇을 멘션하면 그 메시지에 스레드가 만들어지고, 스레드 하나가 opencode 세션 하나가 됩니다. 프로젝트를 만들고, 컴퓨터를 관리하고, **봇 자신의 코드를 고치고 재시작**까지 합니다.

```
 Discord ──gateway──▶  bot (이 패키지, bun)  ──HTTP──▶  opencode serve (자식 프로세스)
   ▲  스레드/첨부파일        │  메시지·멤버 캐시 (SQLite / 메모리)         │  bash · edit · read …
   └───── 답변·진행 상황 ◀───┘  ◀── loopback API ◀── discord_* 커스텀 도구 ┘
```

## 사용법

| 하고 싶은 것 | 방법 |
|---|---|
| 작업 시키기 | 채널에서 `@봇 블로그 랜딩페이지 만들어줘` → 그 메시지에 스레드가 생기고 거기서 진행 |
| 이어서 말하기 | 스레드 안에서는 멘션 없이 그냥 말하면 됩니다 (`// ` 로 시작하면 봇이 무시) |
| 작업 중 추가 메시지 | 대기열에 쌓였다가(📥) 현재 작업이 끝나면 한 번에 전달 |
| 파일 주기 | 메시지에 파일 첨부 → 프로젝트의 `.discord/uploads/` 에 저장되고 에이전트가 읽음. 이미지·PDF·텍스트는 모델에도 직접 전달 |
| 파일 받기 | 에이전트가 `discord_send_file` 로 첨부. 1500자를 넘는 코드 블록은 자동으로 파일 첨부, 6000자 넘는 답변은 `response.md` |
| 답장/링크 참조 | 메시지에 답장하거나 메시지 링크를 붙이면 그 내용이 컨텍스트로 들어감 |
| 봇 코드 고치기 | `@봇 /self 로그 포맷 바꿔줘` (소유자 전용) |

요청 맨 앞에 붙이는 명령어: `/project <이름>` · `/self` · `/model provider/model` · `/agent <이름>` · `/new` · `/stop` · `/status` · `/cache` · `/restart` · `/help`  
예: `@봇 /new /project blog 다크모드 추가해줘`

## 캐시 규칙 (rate limit 회피)

Discord 데이터 조회는 **캐시만** 사용합니다. 예외는 하나뿐입니다.

| 데이터 | 출처 |
|---|---|
| 멤버 | 봇이 켜질 때 서버별로 한 번 전부 가져와 캐시 (`GUILD_MEMBERS` 인텐트). 이후 입장/퇴장/변경은 gateway 이벤트로 갱신. **조회는 캐시만**, REST 호출 없음 |
| 채널·스레드·역할·서버 | `GUILD_CREATE` 로 받은 캐시 |
| 메시지 | 봇이 켜진 뒤 보이는 **모든 메시지**를 SQLite(`data/bot.sqlite`)에 저장 (수정/삭제도 반영, 재시작해도 유지). 조회는 캐시만 |
| **메시지 ID/링크로 직접 지정** | 캐시에 있으면 캐시. **없을 때만** REST로 1건 조회 후 캐시에 저장 |

REST 조회는 추가로 보호됩니다: 분당 상한(`REST_LOOKUPS_PER_MINUTE`, 기본 20), 같은 메시지 동시 요청 합치기, 실패한 메시지는 60초간 재조회 안 함. 에이전트에게는 `discord_lookup` 도구만 열려 있고, 이 도구는 위 규칙을 지키는 봇 내부 API만 호출합니다. 스레드는 **자기 서버**의 데이터만 읽을 수 있습니다.

> 캐시는 봇이 켜진 시점부터 쌓입니다. 그 이전 대화는 링크를 주면 그 1건만 가져옵니다.

## 설치 (Linux)

### 1. Discord 앱
1. [Developer Portal](https://discord.com/developers/applications) → New Application → **Bot** 탭
2. **Privileged Gateway Intents** 에서 켜기: `SERVER MEMBERS INTENT`, `MESSAGE CONTENT INTENT` (안 켜면 Close Code 4014 로 로그인 실패. 서버 100개 이상이면 Discord 승인 필요)
3. 초대 URL (권한: 채널 보기, 메시지 보내기, 스레드 만들기, 스레드에서 메시지 보내기, 파일 첨부, 메시지 기록 보기, 반응 추가)  
   `https://discord.com/oauth2/authorize?client_id=<CLIENT_ID>&scope=bot&permissions=309237746752`

### 2. 봇 설치
필요한 것: `git`, [`bun`](https://bun.sh), [`opencode`](https://opencode.ai) CLI (모델 제공자 로그인 포함), systemd.

```bash
git clone https://github.com/fngk-ns/opencode-dsbot.git && cd opencode-dsbot/packages/discord
./deploy/install.sh            # 시스템 서비스 (sudo)   |   ./deploy/install.sh --user  (sudo 불필요)
$EDITOR .env                   # DISCORD_TOKEN, DISCORD_OWNER_IDS 채우기
sudo systemctl start opencode-discord      # --user 설치면: systemctl --user start opencode-discord
journalctl -u opencode-discord -f
```

소스에서 opencode 를 직접 쓰려면 `.env` 에 `OPENCODE_CMD="bun run --cwd /path/to/opencode-dsbot/packages/opencode src/index.ts"`.  
설치 스크립트 없이 실행: `bun install` (저장소 루트) 후 `bun run start`.

## 보안 모델

이 봇은 **호스트에서 명령을 실행**하고 자기 코드를 수정할 수 있습니다. 그래서:

- `DISCORD_OWNER_IDS` 가 비어 있으면 시작하지 않습니다. 허용 목록에 없는 사용자는 무시됩니다(🔒 반응).
- `PERMISSION_MODE=ask`(기본)에서는 파일 수정·셸 실행마다 **소유자만 누를 수 있는 버튼**이 나옵니다. `auto` 는 묻지 않고 실행합니다.
- opencode 서버는 `127.0.0.1` 임의 포트 + 임의 비밀번호로만 열립니다. 도구용 내부 API 도 loopback + 임의 토큰입니다.
- `discord_send_file` 은 프로젝트/워크스페이스 밖 파일, `.env`·SSH 키·인증서·봇 DB 를 거부합니다.
- 모델이 만든 텍스트는 `@everyone`/역할/유저 멘션을 발생시키지 않습니다(allowedMentions 비활성).
- systemd 유닛은 일부러 샌드박스하지 않습니다. 내 파일을 건드리면 안 된다면 **전용 사용자**로 설치하세요.

## 자기 수정 (`/self`)

1. `/self` 세션은 작업 폴더가 봇 소스(`SELF_DIR`)입니다. 에이전트는 수정 후 `bun run check` · `bun test` 를 돌립니다.
2. 에이전트가 `discord_restart` 를 부르면 봇이 **직접 다시 검증**(번들 확인 → 테스트 → 타입체크)합니다. 실패하면 출력이 에이전트에게 돌아가 고치게 합니다.
3. 통과하면 소유자에게 **재시작 버튼**이 나옵니다(`SELF_RESTART=auto` 면 바로 재시작). 재시작 후 같은 스레드에 "재시작 완료"가 올라오고 대화가 이어집니다.
4. 봇은 기동 30초 뒤 정상이라고 판단해 작업 트리를 git ref `refs/opencode-discord/last-good` 로 스냅샷합니다(브랜치·인덱스는 건드리지 않음).
5. 새 버전이 켜지자마자 연속으로 크래시하면 `deploy/run.sh` 가 그 스냅샷으로 **자동 복구**합니다. 로그인 실패(종료코드 3: 토큰·인텐트·네트워크)는 코드 탓이 아니므로 복구하지 않습니다.

## 설정

전체 목록과 설명은 [`.env.example`](.env.example). 주요 항목:

| 변수 | 기본값 | 설명 |
|---|---|---|
| `DISCORD_TOKEN` | — | 봇 토큰 (필수) |
| `DISCORD_OWNER_IDS` | — | 소유자 사용자 ID, 쉼표 구분 (필수) |
| `DISCORD_USER_IDS` | | 소유자 외에 사용할 수 있는 사용자 |
| `PERMISSION_MODE` | `ask` | `ask` / `auto` |
| `SELF_RESTART` | `confirm` | `confirm` / `auto` |
| `WORKSPACE_DIR` | `~/opencode-workspace` | 프로젝트 폴더들의 상위 (`/project 이름` → `WORKSPACE_DIR/이름`) |
| `OPENCODE_CMD` | `opencode` | opencode 실행 명령 |
| `OPENCODE_MODEL` | | `provider/model` |
| `MESSAGE_RETENTION_DAYS` | `0` | 0 = 메시지 캐시 영구 보관 |

## 개발

```bash
cd packages/discord
bun test            # 92개 테스트 (캐시/조회 규칙, 분할, 첨부, API, 롤백, 실행 관리 …)
bun run typecheck
bun run check       # 번들 가능 여부 (자기 수정 검증과 동일)
```

구조: `src/cache` (조회 규칙) · `src/store` (SQLite) · `src/discord` (Discord 입출력) · `src/bridge` (opencode 연동) · `src/api` (도구용 loopback API) · `src/self` (검증·스냅샷) · `opencode/tool` (에이전트에게 주는 도구) · `deploy` (설치·감독·롤백).

> 모노레포에 새 워크스페이스 패키지가 추가되었으므로, 의존성을 설치할 수 있는 환경에서 저장소 루트에 `bun install` 을 한 번 실행해 `bun.lock` 을 갱신해 커밋해야 합니다.
