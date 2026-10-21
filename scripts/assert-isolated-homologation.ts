import "dotenv/config";
import { checkCriticalConfiguration } from "@/lib/observability/health";

const configuration = checkCriticalConfiguration();
const issues = [...configuration.issues];

if (process.env.APP_ENV?.trim().toLowerCase() !== "homologation") {
  issues.push("application_environment");
}
if (process.env.HOMOLOGATION_TARGET_CONFIRMED !== "true") {
  issues.push("homologation_target_confirmation");
}

const uniqueIssues = [...new Set(issues)].sort();
if (uniqueIssues.length) {
  console.error(`HOMOLOGATION_GUARD_BLOCKED issues=${uniqueIssues.join(",")}`);
  process.exitCode = 1;
} else {
  console.log("HOMOLOGATION_GUARD_PASS");
}
