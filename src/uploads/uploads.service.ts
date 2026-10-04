import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { Readable } from 'stream';

const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

const MIME_FROM_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
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
  private readonly logger = new Logger(UploadsService.name);
  private client: S3Client | null = null;
  private bucket: string | null = null;
  private readonly localUploadDir = path.resolve(process.cwd(), 'uploads_local');

  constructor(private readonly config: ConfigService) {}

  private isStorageConfigured(): boolean {
    const endpoint = this.config.get<string>('STORAGE_ENDPOINT');
    const accessKeyId = this.config.get<string>('STORAGE_ACCESS_KEY_ID');
    const secretAccessKey = this.config.get<string>('STORAGE_SECRET_ACCESS_KEY');
    const bucket = this.config.get<string>('STORAGE_BUCKET');
    return Boolean(endpoint && accessKeyId && secretAccessKey && bucket);
  }

  /**
   * Uploads product image bytes to object storage (or local storage fallback).
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

    if (this.isStorageConfigured()) {
      await this.getClient().send(
        new PutObjectCommand({
          Bucket: this.getBucket(),
          Key: key,
          Body: file.buffer,
          ContentType: file.mimetype,
        }),
      );
    } else {
      // Local disk fallback
      const fullPath = path.join(this.localUploadDir, key);
      await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.promises.writeFile(fullPath, file.buffer);
    }

    return { key, url: `${this.getPublicBaseUrl()}/uploads/${key}` };
  }

  async getObject(key: string): Promise<StoredObject> {
    if (this.isStorageConfigured()) {
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

    // Local disk fallback
    const fullPath = path.join(this.localUploadDir, key);
    if (!fs.existsSync(fullPath)) {
      throw new NotFoundException('Image not found');
    }
    const ext = path.extname(fullPath).replace('.', '').toLowerCase();
    const contentType = MIME_FROM_EXT[ext] || 'application/octet-stream';
    return {
      body: fs.createReadStream(fullPath) as Readable,
      contentType,
    };
  }

  private getClient(): S3Client {
    if (this.client) return this.client;

    const endpoint = this.config.get<string>('STORAGE_ENDPOINT');
    const region = this.config.get<string>('STORAGE_REGION') || 'auto';
    const accessKeyId = this.config.get<string>('STORAGE_ACCESS_KEY_ID');
    const secretAccessKey = this.config.get<string>('STORAGE_SECRET_ACCESS_KEY');

    this.client = new S3Client({
      endpoint,
      region,
      credentials: { accessKeyId: accessKeyId!, secretAccessKey: secretAccessKey! },
    });
    return this.client;
  }

  private getBucket(): string {
    if (this.bucket) return this.bucket;
    this.bucket = this.config.get<string>('STORAGE_BUCKET') || 'uploads';
    return this.bucket;
  }

  private getPublicBaseUrl(): string {
    const explicit = this.config.get<string>('API_PUBLIC_URL')?.trim();
    if (explicit) return explicit.replace(/\/+$/, '');
    const railwayDomain = process.env.RAILWAY_PUBLIC_DOMAIN;
    if (railwayDomain) return `https://${railwayDomain}`;
    return `http://localhost:${this.config.get<number>('PORT') || 3000}`;
  }
}
