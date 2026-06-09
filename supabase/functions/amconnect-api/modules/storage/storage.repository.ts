import { SupabaseClient } from "@supabase/supabase-js";
import { AppError } from "../../shared/errors.ts";

export interface IStorageRepository {
  upload(bucket: string, path: string, data: ArrayBuffer, contentType: string): Promise<void>;
  createSignedUploadUrl(bucket: string, path: string): Promise<{ signedUrl: string; token: string }>;
  download(bucket: string, path: string): Promise<Blob>;
}

export class StorageRepository implements IStorageRepository {
  constructor(private supabase: SupabaseClient) {}

  async upload(bucket: string, path: string, data: ArrayBuffer, contentType: string): Promise<void> {
    const { error } = await this.supabase.storage
      .from(bucket)
      .upload(path, data, { contentType, upsert: false });
    if (error) throw new AppError(`No se pudo subir el archivo: ${error.message}`, 500);
  }

  async createSignedUploadUrl(bucket: string, path: string): Promise<{ signedUrl: string; token: string }> {
    const { data, error } = await this.supabase.storage.from(bucket).createSignedUploadUrl(path);
    if (error || !data) throw new AppError(`No se pudo generar la URL de carga: ${error?.message}`, 500);
    return { signedUrl: data.signedUrl, token: data.token };
  }

  async download(bucket: string, path: string): Promise<Blob> {
    const { data, error } = await this.supabase.storage.from(bucket).download(path);
    if (error || !data) throw new AppError(`No se pudo descargar el archivo: ${error?.message}`, 500);
    return data;
  }
}
