import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';
import type { Readable } from 'stream';

const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

export interface UploadedImage {
  key: string;
  url: string;
}

export interface StoredObject {
  body: Readable;
  contentType: string;
}

@Injectable()
export class UploadsService {
  private client: S3Client | null = null;
  private bucket: string | null = null;

  constructor(private readonly config: ConfigService) {}

  /**
   * Uploads product image bytes to Railway's (Tigris-backed) S3-compatible bucket. Bytes
   * are proxied through this server — Railway buckets are private with no public bucket URLs,
   * so `UploadsController` proxies reads back out under `${API_PUBLIC_URL}/uploads/:key`.
   */
  async uploadProductImage(file: {
    buffer: Buffer;
    mimetype: string;
  }): Promise<UploadedImage> {
    const ext = ALLOWED_IMAGE_TYPES[file.mimetype];
    if (!ext) {
      throw new BadRequestException(
        `Unsupported image type "${file.mimetype}" — allowed: ${Object.keys(ALLOWED_IMAGE_TYPES).join(', ')}`,
      );
    }

    const key = `products/${randomUUID()}.${ext}`;
    await this.getClient().send(
      new PutObjectCommand({
        Bucket: this.getBucket(),
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
      }),
    );

    return { key, url: `${this.getPublicBaseUrl()}/uploads/${key}` };
  }

  async getObject(key: string): Promise<StoredObject> {
    try {
      const result = await this.getClient().send(
        new GetObjectCommand({ Bucket: this.getBucket(), Key: key }),
      );
      return {
        body: result.Body as Readable,
        contentType: result.ContentType ?? 'application/octet-stream',
      };
    } catch (err) {
      const name = (err as { name?: string })?.name;
      if (name === 'NoSuchKey' || name === 'NotFound') {
        throw new NotFoundException('Image not found');
      }
      throw err;
    }
  }

  private getClient(): S3Client {
    if (this.client) return this.client;

    const endpoint = this.config.get<string>('STORAGE_ENDPOINT');
    const region = this.config.get<string>('STORAGE_REGION') || 'auto';
    const accessKeyId = this.config.get<string>('STORAGE_ACCESS_KEY_ID');
    const secretAccessKey = this.config.get<string>(
      'STORAGE_SECRET_ACCESS_KEY',
    );
    if (!endpoint || !accessKeyId || !secretAccessKey) {
      throw new InternalServerErrorException(
        'Object storage is not configured — set STORAGE_ENDPOINT, STORAGE_ACCESS_KEY_ID, STORAGE_SECRET_ACCESS_KEY',
      );
    }

    this.client = new S3Client({
      endpoint,
      region,
      credentials: { accessKeyId, secretAccessKey },
    });
    return this.client;
  }

  private getBucket(): string {
    if (this.bucket) return this.bucket;
    const bucket = this.config.get<string>('STORAGE_BUCKET');
    if (!bucket) {
      throw new InternalServerErrorException(
        'Object storage is not configured — set STORAGE_BUCKET',
      );
    }
    this.bucket = bucket;
    return bucket;
  }

  private getPublicBaseUrl(): string {
    const explicit = this.config.get<string>('API_PUBLIC_URL')?.trim();
    if (explicit) return explicit.replace(/\/+$/, '');
    const railwayDomain = process.env.RAILWAY_PUBLIC_DOMAIN;
    if (railwayDomain) return `https://${railwayDomain}`;
    return `http://localhost:${this.config.get<number>('PORT') || 3000}`;
  }
}
