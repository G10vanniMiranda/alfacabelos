import path from "node:path";

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

type AllowedFormat = {
  extension: string;
  extensions: readonly string[];
  mediaType: "IMAGE" | "VIDEO";
  mime: string;
};

const FORMATS = {
  avif: { extension: "avif", extensions: ["avif"], mediaType: "IMAGE", mime: "image/avif" },
  jpeg: { extension: "jpg", extensions: ["jpg", "jpeg"], mediaType: "IMAGE", mime: "image/jpeg" },
  mp4: { extension: "mp4", extensions: ["mp4"], mediaType: "VIDEO", mime: "video/mp4" },
  png: { extension: "png", extensions: ["png"], mediaType: "IMAGE", mime: "image/png" },
  quicktime: { extension: "mov", extensions: ["mov"], mediaType: "VIDEO", mime: "video/quicktime" },
  webm: { extension: "webm", extensions: ["webm"], mediaType: "VIDEO", mime: "video/webm" },
  webp: { extension: "webp", extensions: ["webp"], mediaType: "IMAGE", mime: "image/webp" },
} as const satisfies Record<string, AllowedFormat>;

const ALLOWED_MIMES = new Set<string>(Object.values(FORMATS).map((format) => format.mime));
const SAFE_STORED_FILENAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

export type UploadCandidate = {
  name: string;
  size: number;
  type: string;
  slice(start?: number, end?: number): Blob;
};

export type ValidatedUpload = AllowedFormat & { originalExtension: string };

function hasBytes(bytes: Uint8Array, expected: readonly number[], offset = 0): boolean {
  return expected.every((value, index) => bytes[offset + index] === value);
}

function ascii(bytes: Uint8Array, start = 0, end = bytes.length): string {
  return String.fromCharCode(...bytes.subarray(start, end));
}

function detectFormat(header: Uint8Array, tail: Uint8Array, size: number): keyof typeof FORMATS | null {
  if (hasBytes(header, [0xff, 0xd8, 0xff]) && hasBytes(tail, [0xff, 0xd9], tail.length - 2)) return "jpeg";
  if (
    hasBytes(header, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) &&
    tail.length >= 12 &&
    ascii(tail, tail.length - 8, tail.length - 4) === "IEND"
  ) return "png";
  if (
    header.length >= 12 &&
    ascii(header, 0, 4) === "RIFF" &&
    ascii(header, 8, 12) === "WEBP" &&
    new DataView(header.buffer, header.byteOffset, header.byteLength).getUint32(4, true) + 8 === size
  ) return "webp";
  if (header.length >= 16 && ascii(header, 4, 8) === "ftyp") {
    const brands = ascii(header, 8, Math.min(header.length, 64));
    if (brands.includes("avif") || brands.includes("avis")) return "avif";
    if (brands.includes("qt  ")) return "quicktime";
    if (/(isom|iso[2-9]|mp4[12]|avc1|M4V )/.test(brands)) return "mp4";
  }
  if (hasBytes(header, [0x1a, 0x45, 0xdf, 0xa3]) && ascii(header).toLowerCase().includes("webm")) {
    return "webm";
  }
  return null;
}

function getSingleExtension(filename: string): string | null {
  if (filename.includes("/") || filename.includes("\\") || filename.includes("\0") || filename.startsWith(".")) {
    return null;
  }
  const parts = filename.split(".");
  return parts.length === 2 && parts[0] && parts[1] ? parts[1].toLowerCase() : null;
}

export async function validateGalleryUpload(file: UploadCandidate): Promise<ValidatedUpload> {
  const mime = file.type.trim().toLowerCase();
  if (!ALLOWED_MIMES.has(mime)) {
    throw new Error("Formato inválido. Use JPG, PNG, WEBP, AVIF, MP4, WEBM ou MOV");
  }
  if (!Number.isSafeInteger(file.size) || file.size <= 0) {
    throw new Error("Arquivo vazio ou inválido");
  }
  const declaredIsVideo = mime.startsWith("video/");
  if (file.size > (declaredIsVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES)) {
    throw new Error(declaredIsVideo ? "Vídeo deve ter até 50 MB" : "Imagem deve ter até 5 MB");
  }
  const originalExtension = getSingleExtension(file.name);
  if (!originalExtension) {
    throw new Error("Nome de arquivo inválido ou com extensão dupla");
  }

  const header = new Uint8Array(await file.slice(0, Math.min(file.size, 4096)).arrayBuffer());
  const tail = new Uint8Array(await file.slice(Math.max(0, file.size - 16), file.size).arrayBuffer());
  const detectedKey = detectFormat(header, tail, file.size);
  if (!detectedKey) {
    throw new Error("Arquivo corrompido ou conteúdo não reconhecido");
  }
  const detected = FORMATS[detectedKey];
  if (detected.mime !== mime || !(detected.extensions as readonly string[]).includes(originalExtension)) {
    throw new Error("O conteúdo, o MIME type e a extensão do arquivo não correspondem");
  }
  return { ...detected, originalExtension };
}

function validateStoredFilename(filename: string): void {
  if (!SAFE_STORED_FILENAME.test(filename) || filename.includes("..") || filename.includes("%") || filename.includes("\\")) {
    throw new Error("Caminho de mídia persistido inválido");
  }
}

export function resolveLocalGalleryPath(storedUrl: string, publicRoot = path.resolve(process.cwd(), "public")): string {
  const prefix = "/uploads/galeria/";
  if (
    !storedUrl.startsWith(prefix) ||
    storedUrl.includes("?") ||
    storedUrl.includes("#") ||
    storedUrl.includes("%") ||
    storedUrl.includes("\\")
  ) {
    throw new Error("Caminho de mídia persistido inválido");
  }
  const filename = storedUrl.slice(prefix.length);
  validateStoredFilename(filename);
  const galleryRoot = path.resolve(publicRoot, "uploads", "galeria");
  const resolved = path.resolve(galleryRoot, filename);
  if (!resolved.startsWith(`${galleryRoot}${path.sep}`)) {
    throw new Error("Caminho de mídia fora do diretório permitido");
  }
  return resolved;
}

export function extractSafeSupabaseObjectPath(input: {
  bucket: string;
  publicUrl: string;
  supabaseUrl: string;
}): string {
  if (input.publicUrl.includes("%") || input.publicUrl.includes("\\")) {
    throw new Error("URL de mídia persistida inválida");
  }
  let parsed: URL;
  let base: URL;
  try {
    parsed = new URL(input.publicUrl);
    base = new URL(input.supabaseUrl);
  } catch {
    throw new Error("URL de mídia persistida inválida");
  }
  const prefix = `/storage/v1/object/public/${input.bucket}/galeria/`;
  if (
    parsed.origin !== base.origin ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    !parsed.pathname.startsWith(prefix)
  ) {
    throw new Error("URL de mídia persistida fora do storage permitido");
  }
  const filename = parsed.pathname.slice(prefix.length);
  validateStoredFilename(filename);
  return `galeria/${filename}`;
}

export async function deleteLocalGalleryFile(
  storedUrl: string,
  options: { publicRoot?: string; unlinkFile: (absolutePath: string) => Promise<void> },
): Promise<"deleted" | "missing"> {
  const absolutePath = resolveLocalGalleryPath(storedUrl, options.publicRoot);
  try {
    await options.unlinkFile(absolutePath);
    return "deleted";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing";
    throw error;
  }
}
