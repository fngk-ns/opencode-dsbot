import { tool } from "@opencode-ai/plugin"
import { call } from "../lib/bridge"

export default tool({
  description: `Send a local file to the Discord thread as an attachment. Use this to deliver code, documents, logs, archives or any generated artifact instead of pasting it into chat.

The file must be inside the project directory (or the bot workspace). Credentials such as .env files and SSH keys are refused. Files above the upload limit (about 10 MB) are refused: split or compress them first.`,
  args: {
    path: tool.schema.string().describe("File path, absolute or relative to the project directory"),
    caption: tool.schema.string().optional().describe("Short message posted together with the file"),
  },
  async execute(args, context) {
    return call("/send-file", { session_id: context.sessionID, ...args })
  },
})
