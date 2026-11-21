import type { IStorageRepository } from "./storage.repository.ts";
import { AppError } from "../../shared/errors.ts";

export const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "audio/mp4",
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
  "audio/webm",
];

export class StorageService {
  constructor(private repository: IStorageRepository) {}

  validateMimeType(mimeType: string): void {
    if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
      throw new AppError(
        `Tipo de archivo no soportado. Permitidos: ${ALLOWED_MIME_TYPES.join(", ")}`,
        400,
      );
    }
  }

  buildStoragePath(agentId: string, fileName: string): string {
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
    return `${agentId}/${Date.now()}-${safeName}`;
  }

  async getSignedUploadUrl(
    agentId: string,
    fileName: string,
    mimeType: string,
    bucket = "policies",
  ): Promise<{ uploadUrl: string; storagePath: string; token: string; mimeType: string }> {
    this.validateMimeType(mimeType);

    const storagePath = this.buildStoragePath(agentId, fileName);
    const { signedUrl, token } = await this.repository.createSignedUploadUrl(bucket, storagePath);
    return { uploadUrl: signedUrl, storagePath, token, mimeType };
  }

  async downloadAsBase64(bucket: string, filePath: string): Promise<string> {
    const blob = await this.repository.download(bucket, filePath);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i += 8192) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    }
    return btoa(binary);
  }
}
