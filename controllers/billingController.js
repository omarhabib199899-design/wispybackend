const asyncHandler = require("../utils/asyncHandler");
const ErrorResponse = require("../utils/ErrorResponse");
const User = require("../models/User");
const PLANS = require("../config/plans");
const { sendSubscriptionEmail } = require("../services/emailService");
const crypto = require("crypto");
const DodoPayments = require("dodopayments").default;

// ── Dodo client ───────────────────────────────────────────────────────────────
const dodo = new DodoPayments({
  bearerToken: process.env.DODO_PAYMENTS_API_KEY,
  environment:
    process.env.DODO_PAYMENTS_ENV === "live_mode" ? "live_mode" : "test_mode",
});

// ── Dodo product ID map ───────────────────────────────────────────────────────
const DODO_PRODUCTS = {
  starter: process.env.DODO_PRODUCT_STARTER,
  business: process.env.DODO_PRODUCT_BUSINESS,
  premium: process.env.DODO_PRODUCT_PREMIUM,
};

// @route  GET /api/billing/plans
exports.getPlans = asyncHandler(async (req, res) => {
  res.json({ success: true, plans: PLANS });
});

// @route  POST /api/billing/dodo/create-session
exports.dodoCreateSession = asyncHandler(async (req, res, next) => {
  const { plan } = req.body;
  if (!PLANS[plan]) return next(new ErrorResponse("Invalid plan", 400));

  const productId = DODO_PRODUCTS[plan];
  if (!productId)
    return next(new ErrorResponse("Dodo product not configured for this plan", 500));

  const session = await dodo.checkoutSessions.create({
    product_cart: [{ product_id: productId, quantity: 1 }],
    customer: {
      email: req.user.email,
      name: req.user.name,
    },
    metadata: {
      userId: req.user._id.toString(),
      plan,
    },
    return_url: `${process.env.CLIENT_URL}/pricing?payment=success&plan=${plan}`,
  });

  res.json({ success: true, checkoutUrl: session.checkout_url });
});

// @route  POST /api/billing/dodo/portal
exports.dodoPortal = asyncHandler(async (req, res, next) => {
  if (!req.user.dodoCustomerId)
    return next(new ErrorResponse("No Dodo customer found", 400));

  const portal = await dodo.customers.customerPortal(req.user.dodoCustomerId);
  res.json({ success: true, url: portal.url });
});

// @route  POST /api/billing/dodo/webhook
exports.dodoWebhook = async (req, res) => {
  const webhookSecret = process.env.DODO_WEBHOOK_SECRET;

  if (webhookSecret) {
    try {
      // Dodo uses svix — headers are webhook-id, webhook-timestamp, webhook-signature
      const msgId        = req.headers["webhook-id"];
      const msgTimestamp = req.headers["webhook-timestamp"];
      const msgSignature = req.headers["webhook-signature"];

      if (!msgId || !msgTimestamp || !msgSignature) {
        console.warn("[Wispy] Missing Dodo webhook headers");
        return res.status(400).json({ error: "Missing webhook headers" });
      }

      // Verify timestamp is within 5 minutes to prevent replay attacks
      const ts = parseInt(msgTimestamp, 10);
      const now = Math.floor(Date.now() / 1000);
      if (Math.abs(now - ts) > 300) {
        console.warn("[Wispy] Dodo webhook timestamp too old");
        return res.status(400).json({ error: "Webhook timestamp expired" });
      }

      // Build the signed content: msgId + "." + msgTimestamp + "." + rawBody
      const rawBody = req.body instanceof Buffer
        ? req.body.toString("utf8")
        : typeof req.body === "string"
          ? req.body
          : JSON.stringify(req.body);

      const toSign = `${msgId}.${msgTimestamp}.${rawBody}`;

      // The secret comes as "whsec_<base64>" — strip the prefix and decode
      const secretBase64 = webhookSecret.startsWith("whsec_")
        ? webhookSecret.slice(6)
        : webhookSecret;
      const secretBytes = Buffer.from(secretBase64, "base64");

      const computed = crypto
        .createHmac("sha256", secretBytes)
        .update(toSign)
        .digest("base64");

      // msgSignature may be "v1,<sig1> v1,<sig2>" — check all
      const signatures = msgSignature.split(" ").map((s) => s.replace(/^v1,/, ""));
      const valid = signatures.some((sig) =>
        crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(computed))
      );

      if (!valid) {
        console.warn("[Wispy] Dodo webhook signature mismatch");
        return res.status(400).json({ error: "Invalid webhook signature" });
      }

    } catch (err) {
      console.error("[Wispy] Dodo webhook verify error:", err.message);
      return res.status(400).json({ error: "Webhook verification error" });
    }
  } else {
    console.warn("[Wispy] DODO_WEBHOOK_SECRET not set — skipping signature check");
  }

  try {
    const rawBody = req.body instanceof Buffer
      ? req.body.toString("utf8")
      : typeof req.body === "string"
        ? req.body
        : JSON.stringify(req.body);

    const event = JSON.parse(rawBody);
    const { type, data } = event;

    console.log("[Wispy] Dodo webhook received:", type);

    switch (type) {
      case "subscription.active": {
        const meta = data.metadata || {};
        const userId = meta.userId;
        const plan = meta.plan;

        if (!userId || !plan) {
          console.warn("[Wispy] subscription.active missing metadata:", meta);
          break;
        }

        const user = await User.findByIdAndUpdate(
          userId,
          {
            plan,
            planStatus: "active",
            dodoSubscriptionId: data.subscription_id,
            dodoCustomerId: data.customer_id,
            planExpiresAt: null,
          },
          { new: true }
        );

        if (user && PLANS[plan]) {
          sendSubscriptionEmail(user, PLANS[plan].name, PLANS[plan].price).catch(console.error);
        }

        console.log(`✅ Dodo: User ${userId} activated plan ${plan}`);
        break;
      }

      case "subscription.updated": {
        const subId = data.subscription_id;
        if (!subId) break;
        const user = await User.findOne({ dodoSubscriptionId: subId });
        if (user) {
          await User.findByIdAndUpdate(user._id, {
            planStatus: data.status === "active" ? "active" : data.status,
          });
        }
        break;
      }

      case "subscription.on_hold": {
        const subId = data.subscription_id;
        if (!subId) break;
        const user = await User.findOne({ dodoSubscriptionId: subId });
        if (user) {
          await User.findByIdAndUpdate(user._id, { planStatus: "past_due" });
        }
        break;
      }

      case "subscription.failed": {
        const meta = data.metadata || {};
        const userId = meta.userId;
        if (userId) {
          await User.findByIdAndUpdate(userId, { planStatus: "cancelled" });
        }
        break;
      }

      default:
        console.log(`[Wispy] Unhandled Dodo event: ${type}`);
    }
  } catch (err) {
    console.error("[Wispy] Dodo webhook handler error:", err.message);
  }

  res.status(200).json({ received: true });
};

// @route  GET /api/billing/subscription
exports.getSubscription = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);

  let dodoDetails = null;
  if (user.dodoSubscriptionId && process.env.DODO_PAYMENTS_API_KEY) {
    try {
      const sub = await dodo.subscriptions.retrieve(user.dodoSubscriptionId);
      dodoDetails = {
        status: sub.status,
        nextBillingDate: sub.next_billing_date,
        cancelAtPeriodEnd: sub.cancel_at_period_end || false,
      };
    } catch (_) {}
  }

  res.json({
    success: true,
    plan: user.plan,
    planStatus: user.planStatus,
    trialEndsAt: user.trialEndsAt,
    planConfig: PLANS[user.plan] || null,
    usage: user.usage,
    dodoDetails,
  });
});

// @route  POST /api/billing/cancel
exports.cancelSubscription = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.user._id);

  if (!user.dodoSubscriptionId) {
    return next(new ErrorResponse("No active subscription found", 400));
  }

  await dodo.subscriptions.update(user.dodoSubscriptionId, {
    status: "cancelled",
  });

  user.planStatus = "cancelled";
  await user.save({ validateBeforeSave: false });

  res.json({
    success: true,
    message: "Subscription will cancel at end of billing period",
  });
});
