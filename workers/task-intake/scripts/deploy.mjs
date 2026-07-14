#!/usr/bin/env node
import { access } from "node:fs/promises";
import { DEPLOY_CONFIG_PATH, runWrangler } from "./setup-lib.mjs";

async function main() {
  try {
    await access(DEPLOY_CONFIG_PATH);
  } catch {
    throw new Error(`缺少 ${DEPLOY_CONFIG_PATH}。请先运行 npm run setup 生成持久化部署配置。`);
  }

  const result = await runWrangler(["deploy", "--config", DEPLOY_CONFIG_PATH]);
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
