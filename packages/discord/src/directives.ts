export type Directive =
  | { kind: "self" }
  | { kind: "project"; name: string }
  | { kind: "model"; model: string }
  | { kind: "agent"; name: string }
  | { kind: "new" }
  | { kind: "stop" }
  | { kind: "status" }
  | { kind: "help" }
  | { kind: "models" }
  | { kind: "cache" }
  | { kind: "restart" }

const FLAGS = new Set(["self", "new", "stop", "status", "help", "models", "cache", "restart"])
const WITH_ARGUMENT = new Set(["project", "model", "agent"])

/**
 * Reads leading `/command` tokens from a prompt, for example `/new /project blog build a landing page`.
 * Anything that is not a known command stays in the prompt, so opencode slash text is not swallowed.
 */
export function parseDirectives(text: string) {
  const directives: Directive[] = []
  let rest = text.trim()
  while (rest.startsWith("/")) {
    const match = rest.match(/^\/([a-z]+)(?:\s+|$)/i)
    if (!match) break
    const name = match[1].toLowerCase()
    if (FLAGS.has(name)) {
      directives.push({ kind: name } as Directive)
      rest = rest.slice(match[0].length)
      continue
    }
    if (!WITH_ARGUMENT.has(name)) break
    const argument = rest.slice(match[0].length).match(/^(\S+)\s*/)
    if (!argument) break
    directives.push(argumentDirective(name, argument[1]))
    rest = rest.slice(match[0].length + argument[0].length)
  }
  return { directives, rest: rest.trim() }
}

function argumentDirective(name: string, value: string): Directive {
  if (name === "project") return { kind: "project", name: value }
  if (name === "model") return { kind: "model", model: value }
  return { kind: "agent", name: value }
}

export const HELP_TEXT = [
  "**사용법**",
  "• 채널에서 `@봇 요청 내용` → 해당 메시지에 스레드가 만들어지고 거기서 작업합니다. 이후 스레드 안에서는 멘션 없이 이어서 말하면 됩니다.",
  "• 파일을 첨부하면 작업 폴더에 저장되어 에이전트가 읽습니다. 만들어진 파일/긴 코드는 첨부파일로 돌려줍니다.",
  "",
  "**명령어** (요청 맨 앞에 붙임)",
  "• `/project <이름>` 작업 프로젝트 선택 (스레드 시작 또는 `/new` 와 함께)",
  "• `/self` 봇 자신의 코드를 수정하는 세션 (소유자 전용)",
  "• `/model <provider/model>` 또는 `/model sonnet` 처럼 이름 일부로 모델 변경 · `/models` 쓸 수 있는 모델 목록 · `/agent <이름>`",
  "• 말로 해도 됩니다: `@봇 claude sonnet 모델로 바꿔줘`",
  "• `/new` 새 세션으로 시작 · `/stop` 진행 중인 작업 중단",
  "• `/status` 상태 · `/cache` 캐시 현황 · `/restart` 봇 재시작 (소유자 전용)",
].join("\n")
