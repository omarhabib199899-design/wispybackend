const express = require("express");
const router = express.Router();
const {
  getPlans,
  dodoCreateSession,
  dodoPortal,
  getSubscription,
  cancelSubscription,
} = require("../controllers/billingController");
const { protect } = require("../middleware/auth");
const { apiLimit } = require("../middleware/rateLimiter");

// ── Public ────────────────────────────────────────────────────────────────────
router.get("/plans", getPlans);

// ── Protected ─────────────────────────────────────────────────────────────────
router.use(protect, apiLimit);

router.post("/dodo/create-session", dodoCreateSession);
router.post("/dodo/portal", dodoPortal);
router.get("/subscription", getSubscription);
router.post("/cancel", cancelSubscription);

module.exports = router;
