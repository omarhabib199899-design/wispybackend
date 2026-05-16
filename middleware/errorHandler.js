const ErrorResponse = require('../utils/ErrorResponse');

const errorHandler = (err, req, res, next) => {
  let error = { ...err };
  error.message = err.message;

  // Log in dev
  if (process.env.NODE_ENV === 'development') {
    console.error('❌', err.stack || err);
  }

  // ── Mongoose: bad ObjectId ──────────────────────────────────────────────────
  if (err.name === 'CastError') {
    error = new ErrorResponse(`Resource not found`, 404);
  }

  // ── Mongoose: duplicate key ────────────────────────────────────────────────
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0] || 'field';
    error = new ErrorResponse(`${field} already exists`, 400);
  }

  // ── Mongoose: validation error ─────────────────────────────────────────────
  if (err.name === 'ValidationError') {
    const message = Object.values(err.errors).map(e => e.message).join(', ');
    error = new ErrorResponse(message, 400);
  }

  // ── JWT errors ─────────────────────────────────────────────────────────────
  if (err.name === 'JsonWebTokenError')  error = new ErrorResponse('Invalid token', 401);
  if (err.name === 'TokenExpiredError')  error = new ErrorResponse('Token expired', 401);

  // ── Stripe errors ──────────────────────────────────────────────────────────
  if (err.type === 'StripeCardError')        error = new ErrorResponse(err.message, 400);
  if (err.type === 'StripeInvalidRequestError') error = new ErrorResponse('Invalid payment request', 400);

  res.status(error.statusCode || 500).json({
    success: false,
    error:   error.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};

module.exports = errorHandler;
