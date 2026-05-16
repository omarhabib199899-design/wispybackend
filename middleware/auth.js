const { verifyAccessToken } = require('../utils/jwt');
const ErrorResponse          = require('../utils/ErrorResponse');
const asyncHandler           = require('../utils/asyncHandler');
const User                   = require('../models/User');

/**
 * protect — verifies JWT access token (Bearer header or cookie).
 * Attaches req.user (full document) for downstream use.
 */
exports.protect = asyncHandler(async (req, res, next) => {
  let token;

  if (req.headers.authorization?.startsWith('Bearer ')) {
    token = req.headers.authorization.split(' ')[1];
  } else if (req.cookies?.accessToken) {
    token = req.cookies.accessToken;
  }

  if (!token) return next(new ErrorResponse('Not authorised — no token', 401));

  let decoded;
  try {
    decoded = verifyAccessToken(token);
  } catch (err) {
    return next(new ErrorResponse('Not authorised — invalid token', 401));
  }

  const user = await User.findById(decoded.id);
  if (!user)          return next(new ErrorResponse('User no longer exists', 401));
  if (!user.isActive) return next(new ErrorResponse('Account suspended', 403));

  req.user = user;
  next();
});

/**
 * authorize(...roles) — must come after protect.
 * Usage: router.delete('/users/:id', protect, authorize('admin'), handler)
 */
exports.authorize = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) {
    return next(new ErrorResponse(`Role '${req.user.role}' is not allowed here`, 403));
  }
  next();
};

/**
 * requireVerified — blocks unverified email users from sensitive actions.
 * Must come after protect.
 */
exports.requireVerified = (req, res, next) => {
  if (!req.user.isEmailVerified) {
    return next(new ErrorResponse('Please verify your email address first', 403));
  }
  next();
};

/**
 * requireActivePlan — blocks users whose plan/trial has expired.
 * Must come after protect.
 */
exports.requireActivePlan = (req, res, next) => {
  const { plan, planStatus, trialEndsAt } = req.user;

  if (plan === 'trial') {
    if (new Date() > new Date(trialEndsAt)) {
      return next(new ErrorResponse('Your free trial has expired. Please upgrade to continue.', 402));
    }
    return next();
  }

  if (planStatus === 'active') return next();

  return next(new ErrorResponse('Your subscription is inactive. Please update your billing.', 402));
};
