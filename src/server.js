import 'dotenv/config';

import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

import { connectToDB } from './db.js';
import { ProductModel } from './product-model.js';

import {
  createUploadUrl,
  verifyImage,
  deleteImage
} from './s3.js';

import {
  imageSchema,
  productSchema,
  updateProductSchema,
  productQuerySchema
} from './validation.js';

import {
  asyncHandler,
  validateBody,
  validateObjectId,
  errorHandler
} from './middleware.js';

const app = express();

const port = Number(process.env.PORT || 3200);

const CLOUDFRONT_URL =
  process.env.CLOUDFRONT_URL?.replace(/\/+$/, '');

if (!CLOUDFRONT_URL) {
  throw new Error('CLOUDFRONT_URL is not configured');
}

/**
 * Convert an S3 key into a CloudFront delivery URL.
 */
function addImageUrl(product) {
  return {
    ...product,
    imageUrl: `${CLOUDFRONT_URL}/${product.imageKey}`
  };
}

/**
 * Middleware.
 */
app.disable('x-powered-by');

app.use(helmet());

app.use(express.json({
  limit: '20kb'
}));

app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 200,
  standardHeaders: true,
  legacyHeaders: false
}));

/**
 * GET /
 */
app.get('/', (req, res) => {
  res.json({
    message: 'Product API is running'
  });
});

/**
 * POST /api/get-presigned-url
 *
 * Generate an upload URL for a new product image.
 */
app.post(
  '/api/get-presigned-url',
  validateBody(imageSchema),
  asyncHandler(async (req, res) => {
    const { contentType } = req.body;

    const { url, key } = await createUploadUrl(
      contentType
    );

    res.json({
      url,
      key,
      expiresIn: 300
    });
  })
);

/**
 * POST /api/products
 *
 * Create a product after the image has been uploaded.
 */
app.post(
  '/api/products',
  validateBody(productSchema),
  asyncHandler(async (req, res) => {
    const {
      name,
      description,
      price,
      imageKey
    } = req.body;

    await verifyImage(imageKey);

    const existingProduct = await ProductModel.exists({
      imageKey
    });

    if (existingProduct) {
      return res.status(409).json({
        error: 'Image is already assigned to a product'
      });
    }

    const product = await ProductModel.create({
      name,
      description,
      price,
      imageKey
    });

    res.status(201).json({
      message: 'Product created',
      product: addImageUrl(product.toObject())
    });
  })
);

/**
 * GET /api/products
 *
 * Search, sort, and paginate products.
 */
app.get(
  '/api/products',
  asyncHandler(async (req, res) => {
    const parsed = productQuerySchema.safeParse(
      req.query
    );

    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid query parameters',
        details: parsed.error.issues
      });
    }

    const {
      search,
      page,
      limit,
      sort
    } = parsed.data;

    const filter = {};

    if (search) {
      const escaped = search.replace(
        /[.*+?^${}()|[\]\\]/g,
        '\\$&'
      );

      filter.name = {
        $regex: escaped,
        $options: 'i'
      };
    }

    const sortOptions = {
      newest: { createdAt: -1 },
      oldest: { createdAt: 1 },
      price_asc: { price: 1 },
      price_desc: { price: -1 }
    };

    const skip = (page - 1) * limit;

    const [products, total] = await Promise.all([
      ProductModel.find(filter)
        .sort(sortOptions[sort])
        .skip(skip)
        .limit(limit)
        .lean(),

      ProductModel.countDocuments(filter)
    ]);

    res.json({
      products: products.map(addImageUrl),

      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  })
);

/**
 * GET /api/products/:id
 *
 * Get one product.
 */
app.get(
  '/api/products/:id',
  validateObjectId,
  asyncHandler(async (req, res) => {
    const product = await ProductModel.findById(
      req.params.id
    ).lean();

    if (!product) {
      return res.status(404).json({
        error: 'Product not found'
      });
    }

    res.json({
      product: addImageUrl(product)
    });
  })
);

/**
 * POST /api/products/:id/image-upload-url
 *
 * Generate an upload URL for a replacement image.
 */
app.post(
  '/api/products/:id/image-upload-url',
  validateObjectId,
  validateBody(imageSchema),
  asyncHandler(async (req, res) => {
    const exists = await ProductModel.exists({
      _id: req.params.id
    });

    if (!exists) {
      return res.status(404).json({
        error: 'Product not found'
      });
    }

    const { url, key } = await createUploadUrl(
      req.body.contentType
    );

    res.json({
      url,
      key,
      expiresIn: 300
    });
  })
);

/**
 * PATCH /api/products/:id
 *
 * Update product details and optionally replace the image.
 */
app.patch(
  '/api/products/:id',
  validateObjectId,
  validateBody(updateProductSchema),
  asyncHandler(async (req, res) => {
    const updates = req.body;

    const product = await ProductModel.findById(
      req.params.id
    );

    if (!product) {
      return res.status(404).json({
        error: 'Product not found'
      });
    }

    const oldImageKey = product.imageKey;

    if (
      updates.imageKey &&
      updates.imageKey !== oldImageKey
    ) {
      await verifyImage(updates.imageKey);

      const existingProduct = await ProductModel.exists({
        imageKey: updates.imageKey,
        _id: { $ne: product._id }
      });

      if (existingProduct) {
        return res.status(409).json({
          error: 'Image is already assigned to another product'
        });
      }
    }

    Object.assign(product, updates);

    await product.save();

    // Delete the old image only after the database update.
    if (
      updates.imageKey &&
      updates.imageKey !== oldImageKey
    ) {
      try {
        await deleteImage(oldImageKey);
      } catch (err) {
        console.error(
          'Old image cleanup failed:',
          oldImageKey,
          err
        );
      }
    }

    res.json({
      message: 'Product updated',
      product: addImageUrl(product.toObject())
    });
  })
);

/**
 * DELETE /api/products/:id
 *
 * Delete the S3 image and MongoDB product.
 *
 * No separate image-deletion endpoint is required.
 */
app.delete(
  '/api/products/:id',
  validateObjectId,
  asyncHandler(async (req, res) => {
    const product = await ProductModel.findById(
      req.params.id
    );

    if (!product) {
      return res.status(404).json({
        error: 'Product not found'
      });
    }

    await deleteImage(product.imageKey);

    await ProductModel.deleteOne({
      _id: product._id
    });

    res.json({
      message: 'Product and image deleted'
    });
  })
);

/**
 * Centralized error handling.
 */
app.use(errorHandler);

/**
 * Start the application after MongoDB connects.
 */
await connectToDB();

const server = app.listen(port, () => {
  console.log(`Product API running on port ${port}`);
});

/**
 * Graceful shutdown.
 */
async function shutdown() {
  server.close(async () => {
    const mongoose = await import('mongoose');

    await mongoose.default.disconnect();

    process.exit(0);
  });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
