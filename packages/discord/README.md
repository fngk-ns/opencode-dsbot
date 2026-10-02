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

요청 맨 앞에 붙이는 명령어: `/project <이름>` · `/self` · `/model <이름 일부 또는 provider/model>` · `/models` · `/agent <이름>` · `/new` · `/stop` · `/status` · `/cache` · `/restart` · `/help`  
예: `@봇 /new /project blog 다크모드 추가해줘`

## 모델 선택과 Claude 연결

- **Claude**: 호스트의 `.env` 에 `ANTHROPIC_API_KEY` 를 넣으면 opencode 가 `anthropic` 제공자를 자동으로 인식합니다. OpenAI·Google 등 다른 제공자도 같은 방식(환경변수 또는 `opencode auth login`)입니다.
- **채팅으로 모델 바꾸기**: `@봇 claude sonnet 모델로 바꿔줘` 처럼 말하면 에이전트가 `discord_settings` 도구로 연결된 모델 중 가장 알맞은(= 같은 제작사 제공자 우선, 최신 릴리스) 모델을 고릅니다. **이 스레드만** 바뀌고, 다음 메시지부터 적용됩니다. 소유자는 "앞으로 새 대화는 sonnet 으로" 처럼 **기본 모델**도 바꿀 수 있습니다.
- **명령어로 바꾸기** (모델 호출 없이 즉시): `/models` 로 목록, `/model sonnet` 또는 `/model anthropic/claude-sonnet-4-6`. 이름 일부만 써도 같은 규칙으로 매칭하고, 못 찾으면 알려줍니다.
- 우선순위: 스레드 지정 → 소유자가 정한 기본값 → `OPENCODE_MODEL` → opencode 기본값.

> 구독형 OAuth 토큰(Claude Pro/Max 로그인)을 Claude Code 로 위장해 API 처럼 쓰는 프록시(auth2api 등)는 지원하지 않습니다. Anthropic 이 구독 토큰을 Claude Code/claude.ai 전용으로 제한한 장치를 우회하는 방식이라 계정 정지 위험이 있습니다. 봇에는 공식 API 키를 쓰세요.

## 공통 메모리 · 작업 기억 · 컨텍스트 압축

봇은 **대화가 아니라 데이터베이스**에 기억합니다. 그래서 스레드가 아카이브되거나, 컨텍스트가 압축되거나, 봇이 재시작되어도 잊지 않습니다.

| 층 | 저장 | 수명 |
|---|---|---|
| **공통 메모리** | SQLite `memory` — 사실·선호·결정·**작업(task)**. 범위: `global`(모든 곳) / `guild`(서버) / `project` / `thread` | 영구, 모든 스레드가 공유 |
| **스레드 장부** | SQLite `threads` — 지금까지 만든 모든 스레드: 제목, 부모, 브랜치, 마지막 요청, **요약**, 턴 수 | 영구 |
| **포트 장부** | SQLite `services` — 포트 ↔ 서비스 | 영구 |
| 대화 내용 | opencode 세션 | 압축됨 |

- **호출될 때마다 공통 메모리가 따라옵니다.** 대화의 첫 프롬프트(그리고 메모리가 바뀌거나 압축된 뒤의 프롬프트)에 `# Shared memory` 브리핑이 붙습니다: 고정/선호 → 열린 작업 → 서비스·포트 → 결정/사실 → 다른 스레드. 글자 예산(`MEMORY_BUDGET_CHARS`)을 넘으면 중요도가 낮은 줄부터 빠집니다.
- 에이전트는 `discord_memory` 로 저장/수정/검색합니다 ("이거 기억해", "그 배포 스레드 어디였지?"). **global/서버 범위 쓰기는 소유자만** 가능합니다 — 메모리는 이후 프롬프트에 다시 들어가므로, 채널의 누군가가 지시를 영구 저장시키는 것을 막기 위해서입니다. 항목은 삭제가 아니라 보관(archive)됩니다.
- 명령어: `/tasks` 열린 작업 · `/memory` 공통 메모리 · `/threads` 지난 스레드 · `/services` 포트 현황.
- **압축**: opencode 는 창이 거의 찼을 때 스스로 요약(목표/중요사항/작업상태/다음 단계/관련 파일, 이전 요약에 누적)합니다. 봇은 거기에 더해 ① 컨텍스트가 창의 `COMPACT_RATIO`(기본 70%)를 넘으면 **작업이 끝나 조용한 시점(idle)에 선제 압축**하고 ② 요약을 스레드 장부에 저장하며 ③ 압축 직후 다음 프롬프트에 **공통 메모리를 다시 붙입니다**. 요약에서 무엇이 빠지든 메모리와 작업 목록은 영향받지 않습니다.

## 스레드 = 브랜치

- 채널에서 `@봇 …` 으로 만든 스레드는 모두 같은 공통 메모리를 봅니다.
- **`/fork 제목`** (또는 "이 작업 따로 분기해줘" → `discord_thread`): 지금 대화를 같은 채널의 **새 스레드로 갈라냅니다.** 대화 기록을 그대로 이어받고, 원본에는 영향이 없습니다.
- **git 프로젝트**(루트에 커밋이 하나 이상 있는 저장소)에서는 새 스레드마다 **전용 git 브랜치 + worktree**(`WORKSPACE_DIR/.worktrees/<프로젝트>/<이름>`, 브랜치 `thread/<이름>-<id>`)가 생깁니다. 분기한 스레드는 분기 시점 커밋에서 갈라지고, 병렬 스레드끼리 파일이 충돌하지 않습니다. 병합은 에이전트가 메인 체크아웃에서 `git merge` 로 합니다("이 브랜치 머지해줘"). 끄려면 `BRANCH_PER_THREAD=false`.
- worktree 를 못 만들면 조용히 공유 폴더를 쓰지 않고 스레드에 이유를 알립니다.
- 새 주제는 `discord_thread` 의 `new` (대화는 비어 있고 공통 메모리만 공유).

## 배포 (공인 IP 서버)

에이전트가 `discord_service` 로 프로젝트를 빌드한 뒤 **포트를 할당해 서비스로 띄웁니다.** ("블로그 배포해줘" → 빌드 → `deploy` → `http://공인IP:24001`)

- **포트 장부는 영구입니다.** `PORT_RANGE`(기본 20000-29999) 안에서 비어 있는 포트를 골라 서비스 이름에 묶고 DB 에 저장합니다. 서비스를 멈추거나 재배포해도 **같은 포트를 유지**하고, `remove` 해야 반환됩니다. 포트 충돌(다른 서비스·호스트의 다른 프로세스·봇 자신의 포트)과 1024 미만 포트는 거부합니다.
- 서비스는 봇과 **분리된 프로세스**로 실행되어 봇이 재시작돼도 계속 돕니다. 봇이 켜질 때 살아있는 서비스는 **PID+시작시각**으로 확인해 되찾고(PID 재사용 방지), 죽은 서비스는 `desired=running` 이면 다시 띄웁니다. 호스트가 재부팅돼도 마찬가지입니다. 비정상 종료는 지수 백오프로 재시작하고, 30초 안에 5번 넘게 죽으면 포기하고 스레드에 로그와 함께 알립니다.
- 명령은 `$PORT`(와 `HOST=0.0.0.0`)를 받습니다. 봇의 토큰·API 키·`DISCORD_*`·`OPENCODE_*` 는 서비스 환경에서 **제거**됩니다.
- 공개 주소는 `PUBLIC_HOST` 또는 시작 시 한 번 자동 감지합니다. **방화벽은 자동으로 열지 않습니다**: `FIREWALL_OPEN_CMD`(예: `sudo -n ufw allow {port}/tcp`)를 설정하면 배포/삭제 때 실행합니다. 클라우드라면 보안 그룹에서도 포트를 열어야 합니다.
- 서비스 변경(배포·중지·삭제 등)은 **소유자만** 가능하고, 조회·로그는 누구나 됩니다. `PERMISSION_MODE=ask`(기본)에서는 **배포와 삭제가 확인 버튼**을 거칩니다 — 에이전트가 채널에서 읽은 글에 심어진 지시로 프로세스가 실행되는 것을 막기 위해서입니다. HTTPS/도메인 연결(리버스 프록시)은 포함하지 않았습니다.

## 서버 관리 ("타임아웃해줘", "메시지 지워줘", "채널 만들어줘")

`discord_admin` 도구가 말로 시킨 서버 관리를 실행합니다: 타임아웃/해제, 추방, 차단/해제, **메시지 삭제**, 채널·**카테고리**·**스레드**·역할 생성, 채널 이름변경/이동/삭제/주제/슬로우모드, 역할 부여/회수, 닉네임, 메시지 전송, 고정, 감사 기록 조회. 내용 검색은 `discord_lookup`.

- **요청한 사람의 Discord 권한**을 검사합니다(예: 타임아웃은 `ModerateMembers`). 봇 소유자와 서버 소유자는 통과합니다. 부족하면 실행하지 않고 감사 기록에 남깁니다.
- **대상은 하나로 특정될 때만** 실행합니다. 이름이 모호하거나 부분일치뿐이면("ali" → alice/alicia) 후보를 보여 주고 되묻습니다. 봇 자신·서버 소유자·(소유자가 아닌 요청자가 노릴 때) 봇 소유자, 요청자와 같거나 높은 역할의 사람, 요청자보다 높은 역할 부여는 거부합니다.
- **되돌리기 어려운 작업은 확인 버튼**을 거칩니다: 추방, 차단, 채널/카테고리 삭제, 10개 넘는 메시지 삭제. 버튼은 요청자 또는 소유자만 5분 안에 누를 수 있고 한 번만 실행됩니다.
- **메시지 삭제는 캐시에서 대상을 고릅니다**("최근 5개", "alice 의 메시지", "'스팸' 이 들어간 것"). 14일 지난 메시지는 하나씩(최대 20개) 지우고, 캐시에 없는 오래된 메시지는 링크/ID 가 필요합니다.
- 역할은 **권한 없는 일반 역할**만 만듭니다. 모든 시도는 `audit` 테이블에 기록되고 Discord 감사 로그 사유에 "누가 요청했는지"가 남습니다.
- 봇 역할에 필요한 권한(Manage Channels/Roles/Messages, Moderate/Kick/Ban Members 등)을 서버에서 부여해야 합니다. 초대 권한값을 늘리려면 Developer Portal 에서 권한을 직접 선택하세요.

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
   서버 관리(타임아웃·메시지 삭제·채널/역할 생성 등)까지 쓰려면 `permissions=1495051381846` (채널 관리, 역할 관리, 메시지 관리, 멤버 추방/차단/타임아웃, 닉네임 관리, 비공개 스레드, 스레드 관리 추가). 관리자(Administrator) 권한은 필요 없습니다.

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
| `ANTHROPIC_API_KEY` | | Claude 사용 (공식 API 키) |
| `OPENCODE_MODEL` | | 기본 `provider/model` |
| `MESSAGE_RETENTION_DAYS` | `0` | 0 = 메시지 캐시 영구 보관 |

## 개발

```bash
cd packages/discord
bun test            # 테스트 (캐시/조회 규칙, 분할, 첨부, API, 롤백, 실행 관리 …)
bun run typecheck
bun run check       # 번들 가능 여부 (자기 수정 검증과 동일)
```

구조: `src/cache` (조회 규칙) · `src/store` (SQLite) · `src/discord` (Discord 입출력) · `src/bridge` (opencode 연동) · `src/api` (도구용 loopback API) · `src/self` (검증·스냅샷) · `opencode/tool` (에이전트에게 주는 도구) · `deploy` (설치·감독·롤백).

> 모노레포에 새 워크스페이스 패키지가 추가되었으므로, 의존성을 설치할 수 있는 환경에서 저장소 루트에 `bun install` 을 한 번 실행해 `bun.lock` 을 갱신해 커밋해야 합니다.
