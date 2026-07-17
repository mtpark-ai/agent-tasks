import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const migrations = await readD1Migrations("./migrations");
  return {
    test: {
      include: ["test/index.test.ts", "test/persistence.test.ts", "test/github-webhook.test.ts"],
      fileParallelism: false,
    },
    plugins: [
      cloudflareTest({
        wrangler: {
          configPath: "./wrangler.jsonc",
        },
        miniflare: {
          bindings: {
            ADMIN_TOKEN: "admin-secret",
            GITHUB_TOKEN: "github-secret",
            GITHUB_WEBHOOK_SECRET: "github-webhook-secret",
            OUTBOUND_WEBHOOK_URL: "https://bot.example/hooks/agent-tasks",
            OUTBOUND_WEBHOOK_KIND: "generic",
            OUTBOUND_WEBHOOK_AUTHORIZATION: "Bearer bot-secret",
            SHORTCUT_URL: "",
            TEST_MIGRATIONS: migrations,
          },
        },
      }),
    ],
  };
});
