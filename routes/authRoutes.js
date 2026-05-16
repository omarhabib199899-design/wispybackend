// routes/authRoutes.js
const express = require('express');
const router  = express.Router();
const {
  register, login, logout, getMe, refreshToken,
  verifyEmail, resendOtp,
  updateProfile, changePassword,
  forgotPassword, resetPassword,
} = require('../controllers/authController');
const { protect }            = require('../middleware/auth');
const { authLimit, forgotPasswordLimit } = require('../middleware/rateLimiter');

router.post('/register',       authLimit, register);
router.post('/login',          authLimit, login);
router.post('/logout',         logout);
router.post('/refresh',        refreshToken);
router.post('/forgot-password', forgotPasswordLimit, forgotPassword);
router.put('/reset-password/:token', resetPassword);

// Protected
router.use(protect);
router.get('/me',                getMe);
router.put('/update-profile',    updateProfile);
router.put('/change-password',   changePassword);
router.post('/verify-email',     verifyEmail);
router.post('/resend-otp',       resendOtp);

module.exports = router;
