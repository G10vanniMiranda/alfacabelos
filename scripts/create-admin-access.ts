import { createAdminAccess, listAdminAccesses } from "@/lib/auth/admin-access-store";

async function main() {
  const email = process.argv[2]?.trim();
  const password = process.argv[3]?.trim();

  if (!email || !password) {
    console.error("Uso: npm run admin:create -- <email> <senha>");
    process.exit(1);
  }

  if (password.length < 8) {
    console.error("A senha deve ter pelo menos 8 caracteres.");
    process.exit(1);
  }

  try {
    await createAdminAccess({ email, password });
    const all = await listAdminAccesses();
    console.log(`Acesso admin criado para ${email}. Total de acessos ativos: ${all.length}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Falha ao criar acesso admin");
    process.exit(1);
  }
}

main();
