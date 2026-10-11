import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand
} from '@aws-sdk/client-s3';

import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuidv4 } from 'uuid';

const {
  AWS_REGION,
  AWS_ACCESS_KEY_ID,
  AWS_SECRET_ACCESS_KEY,
  S3_BUCKET_NAME
} = process.env;

if (
  !AWS_REGION ||
  !AWS_ACCESS_KEY_ID ||
  !AWS_SECRET_ACCESS_KEY ||
  !S3_BUCKET_NAME
) {
  throw new Error('AWS configuration is incomplete');
}

export const s3 = new S3Client({
  region: AWS_REGION,
  credentials: {
    accessKeyId: AWS_ACCESS_KEY_ID,
    secretAccessKey: AWS_SECRET_ACCESS_KEY
  }
});

const MAX_IMAGE_SIZE =
  Number(process.env.MAX_IMAGE_SIZE_MB || 5) *
  1024 *
  1024;

const allowedTypes = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp'
};

const extensionToContentType = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp'
};

/**
 * Generate a unique S3 key.
 */
export function generateImageKey(contentType) {
  const extension = allowedTypes[contentType];

  if (!extension) {
    const error = new Error('Unsupported image type');
    error.status = 400;
    throw error;
  }

  return `${uuidv4()}.${extension}`;
}

/**
 * Generate a presigned PUT URL.
 */
export async function createUploadUrl(contentType) {
  const key = generateImageKey(contentType);

  const command = new PutObjectCommand({
    Bucket: S3_BUCKET_NAME,
    Key: key,
    ContentType: contentType
  });

  const url = await getSignedUrl(s3, command, {
    expiresIn: 300
  });

  return {
    url,
    key
  };
}

/**
 * Verify that the image exists in S3.
 */
export async function verifyImage(key) {
  const extension = key.split('.').pop();

  const expectedContentType =
    extensionToContentType[extension];

  if (!expectedContentType) {
    const error = new Error('Invalid image key');
    error.status = 400;
    throw error;
  }

  let result;

  try {
    result = await s3.send(
      new HeadObjectCommand({
        Bucket: S3_BUCKET_NAME,
        Key: key
      })
    );
  } catch (err) {
    if (
      err.name === 'NotFound' ||
      err.name === 'NoSuchKey' ||
      err.$metadata?.httpStatusCode === 404
    ) {
      const error = new Error('Uploaded image not found');
      error.status = 400;
      throw error;
    }

    throw err;
  }

  if (result.ContentType !== expectedContentType) {
    const error = new Error('Image content type mismatch');
    error.status = 400;
    throw error;
  }

  if (
    !Number.isFinite(result.ContentLength) ||
    result.ContentLength <= 0 ||
    result.ContentLength > MAX_IMAGE_SIZE
  ) {
    const error = new Error(
      'Image must be non-empty and within the configured size limit'
    );

    error.status = 400;
    throw error;
  }

  return result;
}

/**
 * Delete an S3 object.
 */
export async function deleteImage(key) {
  await s3.send(
    new DeleteObjectCommand({
      Bucket: S3_BUCKET_NAME,
      Key: key
    })
  );
}