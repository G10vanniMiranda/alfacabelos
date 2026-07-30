import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  deleteLocalGalleryFile,
  extractSafeSupabaseObjectPath,
  MAX_IMAGE_BYTES,
  resolveLocalGalleryPath,
  validateGalleryUpload,
  type UploadCandidate,
} from "@/lib/media-security";

function candidate(name: string, type: string, bytes: number[]): UploadCandidate {
  const blob = new Blob([new Uint8Array(bytes)], { type });
  return { name, type, size: blob.size, slice: blob.slice.bind(blob) };
}

const jpeg = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0xff, 0xd9];
const png = [
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0x00, 0x00, 0x00, 0x00,
];
const mp4 = [0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0];
const webm = [0x1a, 0x45, 0xdf, 0xa3, 0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d];

test("aceita imagens e vídeos cujo conteúdo corresponde ao MIME e à extensão", async () => {
  assert.equal((await validateGalleryUpload(candidate("foto.jpg", "image/jpeg", jpeg))).mediaType, "IMAGE");
  assert.equal((await validateGalleryUpload(candidate("foto.png", "image/png", png))).extension, "png");
  assert.equal((await validateGalleryUpload(candidate("video.mp4", "video/mp4", mp4))).mediaType, "VIDEO");
  assert.equal((await validateGalleryUpload(candidate("video.webm", "video/webm", webm))).extension, "webm");
});

test("rejeita MIME falso, extensão falsa, dupla extensão e tipo não permitido", async () => {
  await assert.rejects(validateGalleryUpload(candidate("foto.jpg", "image/jpeg", png)), /não correspondem/);
  await assert.rejects(validateGalleryUpload(candidate("foto.png", "image/jpeg", jpeg)), /não correspondem/);
  await assert.rejects(validateGalleryUpload(candidate("foto.php.jpg", "image/jpeg", jpeg)), /extensão dupla/);
  await assert.rejects(validateGalleryUpload(candidate("icone.svg", "image/svg+xml", [0x3c, 0x73, 0x76, 0x67])), /Formato inválido/);
});

test("rejeita arquivo vazio, corrompido e acima do limite antes de ler o corpo", async () => {
  await assert.rejects(validateGalleryUpload(candidate("vazio.jpg", "image/jpeg", [])), /vazio/);
  await assert.rejects(validateGalleryUpload(candidate("quebrado.jpg", "image/jpeg", [1, 2, 3])), /corrompido/);

  const oversized: UploadCandidate = {
    name: "grande.jpg",
    size: MAX_IMAGE_BYTES + 1,
    type: "image/jpeg",
    slice() {
      throw new Error("o corpo não deve ser lido");
    },
  };
  await assert.rejects(validateGalleryUpload(oversized), /5 MB/);
});

test("resolve somente arquivos locais contidos na raiz da galeria", () => {
  const publicRoot = path.resolve("virtual-public");
  const resolved = resolveLocalGalleryPath("/uploads/galeria/123-imagem.jpg", publicRoot);
  assert.equal(resolved, path.resolve(publicRoot, "uploads", "galeria", "123-imagem.jpg"));

  for (const malicious of [
    "/uploads/galeria/../segredo.txt",
    "/uploads/galeria/%2e%2e%2fsegredo.txt",
    "/uploads/galeria/..%5csegredo.txt",
    "C:\\Windows\\win.ini",
    "https://evil.example/arquivo.jpg",
    "/uploads/galeria/arquivo.jpg?x=1",
  ]) {
    assert.throws(() => resolveLocalGalleryPath(malicious, publicRoot));
  }
});

test("remoção local trata arquivo inexistente sem mascarar outros erros", async () => {
  const missing = await deleteLocalGalleryFile("/uploads/galeria/ausente.jpg", {
    publicRoot: path.resolve("virtual-public"),
    unlinkFile: async () => {
      const error = new Error("missing") as NodeJS.ErrnoException;
      error.code = "ENOENT";
      throw error;
    },
  });
  assert.equal(missing, "missing");

  await assert.rejects(
    deleteLocalGalleryFile("/uploads/galeria/existente.jpg", {
      unlinkFile: async () => {
        const error = new Error("denied") as NodeJS.ErrnoException;
        error.code = "EACCES";
        throw error;
      },
    }),
    /denied/,
  );
});

test("extrai somente objeto da origem, bucket e pasta configurados", () => {
  const input = {
    bucket: "galeria",
    publicUrl: "https://project.supabase.co/storage/v1/object/public/galeria/galeria/123-foto.jpg",
    supabaseUrl: "https://project.supabase.co",
  };
  assert.equal(extractSafeSupabaseObjectPath(input), "galeria/123-foto.jpg");
  assert.throws(() => extractSafeSupabaseObjectPath({ ...input, publicUrl: "https://evil.example/galeria/123-foto.jpg" }));
  assert.throws(() => extractSafeSupabaseObjectPath({ ...input, publicUrl: `${input.publicUrl}/%2e%2e/secret` }));
});
