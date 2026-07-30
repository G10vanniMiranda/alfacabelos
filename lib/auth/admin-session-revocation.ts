export type AdminSessionDeleteStore = {
  deleteMany(input: { where: { adminAccessId: string } }): Promise<{ count: number }>;
};

export async function revokeAllAdminSessions(
  store: AdminSessionDeleteStore,
  adminAccessId: string,
): Promise<number> {
  const result = await store.deleteMany({ where: { adminAccessId } });
  return result.count;
}
