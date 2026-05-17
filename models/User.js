const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const PLANS = require("../config/plans");

const UserSchema = new mongoose.Schema(
  {
    // ── Identity ───────────────────────────────────────────────────────────────
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
      maxlength: 100,
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: 8,
      select: false,
    },

    // ── Email verification ─────────────────────────────────────────────────────
    isEmailVerified: { type: Boolean, default: false },
    emailOtp: { type: String, select: false },
    emailOtpExpire: { type: Date, select: false },

    // ── Password reset ─────────────────────────────────────────────────────────
    resetPasswordToken: { type: String, select: false },
    resetPasswordExpire: { type: Date, select: false },

    // ── Plan & billing ─────────────────────────────────────────────────────────
    plan: {
      type: String,
      enum: ["trial", "starter", "business", "premium"],
      default: "trial",
    },
    trialEndsAt: {
      type: Date,
      default: () => new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
    },
    planStatus: {
      type: String,
      enum: ["active", "cancelled", "past_due", "trialing"],
      default: "trialing",
    },
    planExpiresAt: { type: Date },

    // ── Stripe ────────────────────────────────────────────────────────────────
    stripeCustomerId: { type: String },
    stripeSubscriptionId: { type: String },

    // ── PayPal (legacy — kept so existing users aren't affected) ─────────────
    paypalSubscriptionId: { type: String },
    paypalOrderId: { type: String },

    // ── Dodo Payments ─────────────────────────────────────────────────────────
    dodoCustomerId: { type: String },
    dodoSubscriptionId: { type: String },

    // ── Google Calendar ────────────────────────────────────────────────────────
    googleCalendarConnected: { type: Boolean, default: false },
    googleCalendarTokens: { type: Object, select: false },

    // ── Usage this billing cycle ──────────────────────────────────────────────
    usage: {
      conversationsThisMonth: { type: Number, default: 0 },
      leadsThisMonth: { type: Number, default: 0 },
      cycleStart: { type: Date, default: Date.now },
    },

    // ── Account ───────────────────────────────────────────────────────────────
    role: { type: String, enum: ["user", "admin"], default: "user" },
    isActive: { type: Boolean, default: true },
    lastLoginAt: { type: Date },
    timezone: { type: String, default: "America/New_York" },
    company: { type: String, trim: true },
    website: { type: String, trim: true },
    phone: { type: String, trim: true },
    avatarUrl: { type: String },

    // ── Refresh tokens ─────────────────────────────────────────────────────────
    refreshTokens: [
      { token: String, createdAt: { type: Date, default: Date.now } },
    ],
  },
  { timestamps: true },
);

// ── Indexes ───────────────────────────────────────────────────────────────────
UserSchema.index({ email: 1 });
UserSchema.index({ stripeCustomerId: 1 });
UserSchema.index({ "usage.cycleStart": 1 });

// ── Hash password before save ─────────────────────────────────────────────────
UserSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

// ── Compare password ──────────────────────────────────────────────────────────
UserSchema.methods.matchPassword = async function (entered) {
  return bcrypt.compare(entered, this.password);
};

// ── Generate email OTP ────────────────────────────────────────────────────────
UserSchema.methods.generateOTP = function () {
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  this.emailOtp = otp;
  this.emailOtpExpire = Date.now() + 10 * 60 * 1000; // 10 minutes
  return otp;
};

// ── Generate password reset token ─────────────────────────────────────────────
UserSchema.methods.generateResetToken = function () {
  const token = crypto.randomBytes(32).toString("hex");
  this.resetPasswordToken = crypto
    .createHash("sha256")
    .update(token)
    .digest("hex");
  this.resetPasswordExpire = Date.now() + 30 * 60 * 1000; // 30 minutes
  return token;
};

// ── Plan helpers ──────────────────────────────────────────────────────────────
UserSchema.methods.getPlanConfig = function () {
  return PLANS[this.plan] || PLANS.starter;
};

UserSchema.methods.isTrialActive = function () {
  return this.plan === "trial" && this.trialEndsAt > new Date();
};

UserSchema.methods.hasFeature = function (feature) {
  if (this.plan === "trial") return true; // trial has all features
  const config = this.getPlanConfig();
  return config?.features?.[feature] === true;
};

UserSchema.methods.canCreateBot = async function () {
  const Bot = mongoose.model("Bot");
  const count = await Bot.countDocuments({ user: this._id, isDeleted: false });
  if (this.plan === "trial") return count < 1;
  return count < (this.getPlanConfig()?.maxBots || 1);
};

UserSchema.methods.resetUsageIfNewCycle = async function () {
  const now = new Date();
  const cycleStart = new Date(this.usage.cycleStart);
  const diff = (now - cycleStart) / (1000 * 60 * 60 * 24);
  if (diff >= 30) {
    this.usage.conversationsThisMonth = 0;
    this.usage.leadsThisMonth = 0;
    this.usage.cycleStart = now;
    await this.save({ validateBeforeSave: false });
  }
};

UserSchema.methods.canConverse = async function () {
  await this.resetUsageIfNewCycle();

  // Paid plan that is active or past_due (grace period) — use plan limits
  if (this.plan !== "trial") {
    if (
      this.planStatus === "cancelled" &&
      this.planExpiresAt &&
      this.planExpiresAt < new Date()
    ) {
      // Subscription fully expired — fall through to trial limits
    } else {
      const max = this.getPlanConfig()?.maxConversationsPerMonth;
      return (
        max === null ||
        max === Infinity ||
        this.usage.conversationsThisMonth < max
      );
    }
  }

  // Trial (or expired paid plan with no active subscription)
  if (this.plan === "trial" && this.trialEndsAt < new Date()) return false;
  return this.usage.conversationsThisMonth < 100;
};

module.exports = mongoose.model("User", UserSchema);
