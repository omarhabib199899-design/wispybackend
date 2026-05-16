const rateLimit = require('express-rate-limit');

const makeLimit = (windowMs, max, message) =>
  rateLimit({
    windowMs,
    max,
    message:           { success: false, error: message },
    standardHeaders:   true,
    legacyHeaders:     false,
    // Use IP + (user id if available) as key for authenticated routes
    keyGenerator: (req) => {
      const ip  = req.ip || req.connection.remoteAddress;
      const uid = req.user?._id?.toString() || '';
      return uid ? `${ip}_${uid}` : ip;
    },
  });

// ── Public / unauthenticated ──────────────────────────────────────────────────

/** Widget chat endpoint — keyed by IP + botId to protect each bot's quota separately */
exports.widgetLimit = rateLimit({
  windowMs:        60 * 1000,  // 1 minute
  max:             30,          // 30 messages per minute per IP+bot
  message:         { success: false, error: 'Too many messages. Please slow down.' },
  standardHeaders: true,
  legacyHeaders:   false,
  keyGenerator: (req) => {
    const ip    = req.ip || req.connection.remoteAddress;
    const botId = req.body?.botId || 'unknown';
    return `${ip}_${botId}`;
  },
});

/** Auth endpoints — tight to prevent brute-force / OTP hammering */
exports.authLimit = makeLimit(
  15 * 60 * 1000, // 15 minutes
  20,             // 20 attempts per 15 min
  'Too many auth attempts. Please try again in 15 minutes.'
);

/** Forgot-password — extra tight */
exports.forgotPasswordLimit = makeLimit(
  60 * 60 * 1000, // 1 hour
  5,
  'Too many password reset requests. Please try again in an hour.'
);

// ── Authenticated ─────────────────────────────────────────────────────────────

/** General API — authenticated users */
exports.apiLimit = makeLimit(
  60 * 1000,  // 1 minute
  120,        // 120 req/min
  'Too many requests. Please slow down.'
);

/** URL scraping — expensive operation */
exports.scrapeLimit = makeLimit(
  60 * 60 * 1000, // 1 hour
  20,
  'URL scraping limit reached for this hour.'
);
