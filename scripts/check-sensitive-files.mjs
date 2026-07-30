import { readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const listed = spawnSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { encoding: "utf8" },
);
if (listed.status !== 0) {
  process.stderr.write(listed.stderr || "Não foi possível listar os arquivos versionados.\n");
  process.exit(1);
}

const files = listed.stdout.split("\0").filter(Boolean);
const forbiddenNames = /(^|\/)(\.env($|\.)|[^/]+\.(pem|key|p12|pfx))$/i;
const allowedEnvExamples = new Set([".env.example"]);
const findings = [];

for (const file of files) {
  const normalized = file.replaceAll("\\", "/");
  if (forbiddenNames.test(normalized) && !allowedEnvExamples.has(normalized)) {
    findings.push(`${file}: nome de arquivo sensível`);
    continue;
  }

  const absolute = path.resolve(file);
  if (statSync(absolute).size > 1024 * 1024) continue;
  let content;
  try {
    content = readFileSync(absolute, "utf8");
  } catch {
    continue;
  }
  if (/NEXT_PUBLIC_[A-Z0-9_]*(SERVICE_ROLE|SECRET|PRIVATE_KEY|DATABASE_URL)/.test(content)) {
    findings.push(`${file}: segredo privilegiado exposto como NEXT_PUBLIC_*`);
  }
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(content)) {
    findings.push(`${file}: chave privada versionada`);
  }
  if (/(?:^|[^A-Za-z0-9_-])sk_(?:live|test)_[A-Za-z0-9]{20,}/.test(content)) {
    findings.push(`${file}: chave secreta com formato conhecido`);
  }
}

if (findings.length) {
  console.error("Arquivos ou padrões sensíveis encontrados:\n" + findings.map((item) => `- ${item}`).join("\n"));
  process.exit(1);
}
console.log(`${files.length} arquivos do repositório verificados; nenhum segredo evidente encontrado.`);
