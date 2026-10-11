import mongoose from 'mongoose';

export function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export function validateBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: result.error.issues.map(issue => ({
          field: issue.path.join('.'),
          message: issue.message
        }))
      });
    }

    req.body = result.data;

    next();
  };
}

export function validateObjectId(req, res, next) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({
      error: 'Invalid product ID'
    });
  }

  next();
}

export function errorHandler(err, req, res, next) {
  if (res.headersSent) {
    return next(err);
  }

  console.error(err);

  if (err.name === 'ValidationError') {
    return res.status(400).json({
      error: 'Database validation failed'
    });
  }

  if (err.name === 'CastError') {
    return res.status(400).json({
      error: 'Invalid database value'
    });
  }

  if (err.code === 11000) {
    return res.status(409).json({
      error: 'Duplicate value'
    });
  }

  if (err.status && err.status < 500) {
    return res.status(err.status).json({
      error: err.message
    });
  }

  res.status(500).json({
    error: 'Internal server error'
  });
}