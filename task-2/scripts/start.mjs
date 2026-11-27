import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

if (!existsSync("node_modules")) {
  run("npm", ["install"]);
}

// `next dev` also creates .next, but only a production build writes BUILD_ID.
if (!existsSync(".next/BUILD_ID")) {
  run("npm", ["run", "build"]);
}

const port = process.env.PORT || "3000";
run("npx", ["next", "start", "-p", port]);
