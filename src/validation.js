import { z } from 'zod';

export const imageSchema = z.object({
  contentType: z.enum([
    'image/jpeg',
    'image/png',
    'image/webp'
  ])
});

export const productSchema = z.object({
  name: z.string()
    .trim()
    .min(2)
    .max(100),

  description: z.string()
    .trim()
    .min(1)
    .max(2000),

  price: z.number()
    .min(0)
    .max(100000000),

  imageKey: z.string()
    .regex(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp)$/i,
      'Invalid image key'
    )
});

export const updateProductSchema = productSchema
  .partial()
  .refine(
    data => Object.keys(data).length > 0,
    {
      message: 'At least one field is required'
    }
  );

export const productQuerySchema = z.object({
  search: z.string()
    .trim()
    .max(100)
    .optional(),

  page: z.coerce.number()
    .int()
    .min(1)
    .default(1),

  limit: z.coerce.number()
    .int()
    .min(1)
    .max(100)
    .default(10),

  sort: z.enum([
    'newest',
    'oldest',
    'price_asc',
    'price_desc'
  ]).default('newest')
});