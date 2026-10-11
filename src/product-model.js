import mongoose from 'mongoose';

const productSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 100
    },

    description: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2000
    },

    price: {
      type: Number,
      required: true,
      min: 0,
      max: 100000000
    },

    // Store the S3 key, not the complete image URL.
    imageKey: {
      type: String,
      required: true,
      unique: true
    }
  },
  {
    timestamps: true,
    versionKey: false
  }
);

productSchema.index({ name: 1 });

export const ProductModel = mongoose.model(
  'Product',
  productSchema
);