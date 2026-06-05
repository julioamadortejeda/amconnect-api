import { SupabaseClient } from "@supabase/supabase-js";
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
  constructor(private supabase: SupabaseClient) {}

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

    const { error } = await this.supabase.storage
      .from(bucket)
      .upload(storagePath, await file.arrayBuffer(), {
        contentType: mimeType,
        upsert: false,
      });

    if (error) throw new AppError(`No se pudo subir el archivo: ${error.message}`, 500);

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

    const { data, error } = await this.supabase.storage
      .from(bucket)
      .createSignedUploadUrl(storagePath);

    if (error || !data) {
      throw new AppError(`No se pudo generar la URL de carga: ${error?.message}`, 500);
    }

    return { uploadUrl: data.signedUrl, storagePath, token: data.token, mimeType };
  }

  async download(bucket: string, filePath: string): Promise<Uint8Array> {
    const { data, error } = await this.supabase.storage.from(bucket).download(filePath);

    if (error || !data) {
      throw new AppError(`No se pudo descargar el archivo: ${error?.message}`, 500);
    }

    return new Uint8Array(await data.arrayBuffer());
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
