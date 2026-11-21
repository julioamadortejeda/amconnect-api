import { SupabaseClient } from "@supabase/supabase-js";
import { internalError } from "../../shared/errors.ts";

export interface IStorageRepository {
  createSignedUploadUrl(bucket: string, path: string): Promise<{ signedUrl: string; token: string }>;
  download(bucket: string, path: string): Promise<Blob>;
}

export class StorageRepository implements IStorageRepository {
  constructor(private supabase: SupabaseClient) {}

  async createSignedUploadUrl(bucket: string, path: string): Promise<{ signedUrl: string; token: string }> {
    const { data, error } = await this.supabase.storage.from(bucket).createSignedUploadUrl(path);
    if (error || !data) throw internalError("No se pudo generar la URL de carga.", `signed upload url failed: ${error?.message}`, 500, "UPLOAD_FAILED");
    return { signedUrl: data.signedUrl, token: data.token };
  }

  async download(bucket: string, path: string): Promise<Blob> {
    const { data, error } = await this.supabase.storage.from(bucket).download(path);
    if (error || !data) throw internalError("No se pudo descargar el archivo.", `storage download failed: ${error?.message}`);
    return data;
  }
}
