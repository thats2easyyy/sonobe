/** @sonobe/cli: the `sonobe` command (see main.ts) and its stdio relay, exported for tests and embedding. */

export { HELP, runCli, VERSION, type CliIo } from "./cli.ts";
export {
  checkHealth,
  encodeHeaderValue,
  NOT_RUNNING_HELP,
  readConnectionFile,
  runRelay,
  sonobeHome,
  sseMessages,
  type ConnectionFile,
  type RelayOptions,
  type TextSink,
} from "./relay.ts";
