const asyncHandler  = require('../utils/asyncHandler');
const ErrorResponse = require('../utils/ErrorResponse');
const { sendTokenResponse, verifyRefreshToken, signAccessToken } = require('../utils/jwt');
const { sendVerificationEmail, sendWelcomeEmail, sendPasswordResetEmail } = require('../services/emailService');
const User  = require('../models/User');
const crypto = require('crypto');

// @route  POST /api/auth/register
exports.register = asyncHandler(async (req, res, next) => {
  const { name, email, password, company } = req.body;
  if (!name || !email || !password) return next(new ErrorResponse('Name, email and password are required', 400));
  if (password.length < 8) return next(new ErrorResponse('Password must be at least 8 characters', 400));

  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) return next(new ErrorResponse('Email already registered', 400));

  const user = await User.create({ name, email, password, company });
  const otp  = user.generateOTP();
  await user.save({ validateBeforeSave: false });

  try { await sendVerificationEmail(user, otp); } catch (e) { console.error('Email error:', e.message); }

  sendTokenResponse(user, 201, res);
});

// @route  POST /api/auth/verify-email
exports.verifyEmail = asyncHandler(async (req, res, next) => {
  const { otp } = req.body;
  if (!otp) return next(new ErrorResponse('OTP is required', 400));

  const user = await User.findById(req.user._id).select('+emailOtp +emailOtpExpire');
  if (!user) return next(new ErrorResponse('User not found', 404));
  if (user.isEmailVerified) return res.json({ success: true, message: 'Email already verified' });
  if (user.emailOtp !== otp) return next(new ErrorResponse('Invalid OTP', 400));
  if (user.emailOtpExpire < Date.now()) return next(new ErrorResponse('OTP expired. Request a new one.', 400));

  user.isEmailVerified = true;
  user.emailOtp        = undefined;
  user.emailOtpExpire  = undefined;
  await user.save({ validateBeforeSave: false });

  try { await sendWelcomeEmail(user); } catch (_) {}
  res.json({ success: true, message: 'Email verified successfully' });
});

// @route  POST /api/auth/resend-otp
exports.resendOtp = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.user._id);
  if (user.isEmailVerified) return next(new ErrorResponse('Email already verified', 400));
  const otp = user.generateOTP();
  await user.save({ validateBeforeSave: false });
  await sendVerificationEmail(user, otp);
  res.json({ success: true, message: 'OTP sent' });
});

// @route  POST /api/auth/login
exports.login = asyncHandler(async (req, res, next) => {
  const { email, password } = req.body;
  if (!email || !password) return next(new ErrorResponse('Email and password are required', 400));

  const user = await User.findOne({ email: email.toLowerCase() }).select('+password');
  if (!user) return next(new ErrorResponse('Invalid credentials', 401));
  if (!user.isActive) return next(new ErrorResponse('Account suspended. Contact support.', 403));

  const isMatch = await user.matchPassword(password);
  if (!isMatch) return next(new ErrorResponse('Invalid credentials', 401));

  user.lastLoginAt = new Date();
  await user.save({ validateBeforeSave: false });

  sendTokenResponse(user, 200, res);
});

// @route  POST /api/auth/refresh
exports.refreshToken = asyncHandler(async (req, res, next) => {
  const token = req.cookies?.refreshToken || req.body?.refreshToken;
  if (!token) return next(new ErrorResponse('No refresh token', 401));

  let decoded;
  try { decoded = verifyRefreshToken(token); } catch (_) { return next(new ErrorResponse('Invalid refresh token', 401)); }

  const user = await User.findById(decoded.id);
  if (!user || !user.isActive) return next(new ErrorResponse('User not found', 401));

  const accessToken = signAccessToken(user._id);
  res.json({ success: true, accessToken });
});

// @route  POST /api/auth/logout
exports.logout = asyncHandler(async (req, res) => {
  res.cookie('refreshToken', 'none', { expires: new Date(Date.now() + 1000), httpOnly: true });
  res.json({ success: true, message: 'Logged out' });
});

// @route  GET /api/auth/me
exports.getMe = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);
  res.json({ success: true, user });
});

// @route  PUT /api/auth/update-profile
exports.updateProfile = asyncHandler(async (req, res, next) => {
  const { name, company, phone, website, timezone } = req.body;
  const user = await User.findByIdAndUpdate(
    req.user._id,
    { name, company, phone, website, timezone },
    { new: true, runValidators: true }
  );
  res.json({ success: true, user });
});

// @route  PUT /api/auth/change-password
exports.changePassword = asyncHandler(async (req, res, next) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return next(new ErrorResponse('Both passwords are required', 400));
  if (newPassword.length < 8) return next(new ErrorResponse('New password must be at least 8 characters', 400));

  const user = await User.findById(req.user._id).select('+password');
  const isMatch = await user.matchPassword(currentPassword);
  if (!isMatch) return next(new ErrorResponse('Current password is incorrect', 401));

  user.password = newPassword;
  await user.save();
  res.json({ success: true, message: 'Password changed' });
});

// @route  POST /api/auth/forgot-password
exports.forgotPassword = asyncHandler(async (req, res, next) => {
  const user = await User.findOne({ email: req.body.email?.toLowerCase() });
  if (!user) return res.json({ success: true, message: 'If that email exists, a reset link was sent.' });

  const token    = user.generateResetToken();
  await user.save({ validateBeforeSave: false });
  const resetUrl = `${process.env.CLIENT_URL}/reset-password/${token}`;

  try {
    await sendPasswordResetEmail(user, resetUrl);
    res.json({ success: true, message: 'Reset link sent to your email' });
  } catch (err) {
    user.resetPasswordToken  = undefined;
    user.resetPasswordExpire = undefined;
    await user.save({ validateBeforeSave: false });
    return next(new ErrorResponse('Email could not be sent', 500));
  }
});

// @route  PUT /api/auth/reset-password/:token
exports.resetPassword = asyncHandler(async (req, res, next) => {
  const hashed = crypto.createHash('sha256').update(req.params.token).digest('hex');
  const user   = await User.findOne({
    resetPasswordToken:  hashed,
    resetPasswordExpire: { $gt: Date.now() },
  }).select('+resetPasswordToken +resetPasswordExpire');

  if (!user) return next(new ErrorResponse('Invalid or expired reset token', 400));
  if (!req.body.password || req.body.password.length < 8) return next(new ErrorResponse('Password must be at least 8 characters', 400));

  user.password            = req.body.password;
  user.resetPasswordToken  = undefined;
  user.resetPasswordExpire = undefined;
  await user.save();

  sendTokenResponse(user, 200, res);
});
