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

  async upload(
    agentId: string,
    file: File,
    bucket = "policies",
  ): Promise<{ storagePath: string; fileName: string; mimeType: string }> {
    const mimeType = file.type || "application/octet-stream";
    this.validateMimeType(mimeType);

    const storagePath = this.buildStoragePath(agentId, file.name);
    await this.repository.upload(bucket, storagePath, await file.arrayBuffer(), mimeType);
    return { storagePath, fileName: file.name, mimeType };
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

  async download(bucket: string, filePath: string): Promise<Uint8Array> {
    const blob = await this.repository.download(bucket, filePath);
    return new Uint8Array(await blob.arrayBuffer());
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

  getMimeType(filePath: string): string {
    const ext = filePath.split(".").pop()?.toLowerCase();
    switch (ext) {
      case "jpg":
      case "jpeg":
        return "image/jpeg";
      case "png":
        return "image/png";
      case "webp":
        return "image/webp";
      case "gif":
        return "image/gif";
      case "pdf":
      default:
        return "application/pdf";
    }
  }
}
