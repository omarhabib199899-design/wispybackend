require("dotenv").config();

// ── Startup environment check ─────────────────────────────────────────────────
const REQUIRED_ENV = ["MONGO_URI", "JWT_SECRET", "JWT_REFRESH_SECRET"];
const WARNED_ENV = [
  ["OPENAI_API_KEY", "AI responses will use Groq only"],
  [
    "GROQ_API_KEY",
    "AI will have no fallback — chats will fail if OpenAI is down",
  ],
  ["EMAIL_USER", "Verification and lead notification emails will not send"],
  ["DODO_PAYMENTS_API_KEY", "Dodo Payments billing will not work"],
  ["DODO_WEBHOOK_SECRET", "Dodo webhooks cannot be verified — spoofing risk"],
];

const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missing.length) {
  console.error("\n❌  Missing required environment variables:");
  missing.forEach((k) => console.error("   •", k));
  console.error("   Set these in your .env file and restart.\n");
  process.exit(1);
}
WARNED_ENV.forEach(([k, msg]) => {
  if (!process.env[k]) console.warn("⚠️  " + k + " not set — " + msg);
});

const express = require("express");
const mongoose = require("mongoose");
const helmet = require("helmet");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const morgan = require("morgan");
const errorHandler = require("./middleware/errorHandler");

const app = express();

// ── Security headers ──────────────────────────────────────────────────────────
app.use(helmet());

// ── CORS ──────────────────────────────────────────────────────────────────────
const allowedOrigins = (
  process.env.CORS_ORIGINS ||
  process.env.CLIENT_URL ||
  "http://localhost:3000"
)
  .split(",")
  .map((o) => o.trim());

// Widget endpoints are embedded on third-party sites — must allow any origin.
// All other API routes are restricted to known origins.
const widgetCors = cors({
  origin: "*",
  methods: ["POST", "OPTIONS"],
  allowedHeaders: ["Content-Type"],
});
const dashboardCors = cors({
  origin: (origin, cb) => {
    if (
      !origin ||
      allowedOrigins.includes(origin) ||
      process.env.NODE_ENV !== "production"
    ) {
      return cb(null, true);
    }
    cb(new Error(`CORS: origin '${origin}' not allowed`));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
});

// Apply open CORS only to public widget routes, then restricted CORS everywhere else
app.use("/api/widget", widgetCors);
app.use(dashboardCors);

// ── Serve widget.js publicly (any site can load it) ───────────────────────────
const path = require("path");
const fs = require("fs");
const _widgetPath = fs.existsSync(path.join(__dirname, "public", "widget.js"))
  ? path.join(__dirname, "public", "widget.js")
  : path.join(__dirname, "widget.js");
app.get("/widget.js", widgetCors, (req, res) => {
  res.setHeader("Content-Type", "application/javascript");
  res.setHeader("Cache-Control", "public, max-age=300");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.sendFile(_widgetPath);
});

// ── Dodo webhook needs raw body — mount BEFORE express.json() ────────────────
app.post(
  "/api/billing/dodo/webhook",
  express.raw({ type: "application/json" }),
  require("./controllers/billingController").dodoWebhook,
);

// ── Body parsers ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true, limit: "5mb" }));
app.use(cookieParser());

// ── HTTP request logging ──────────────────────────────────────────────────────
if (process.env.NODE_ENV !== "test") {
  app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));
}

// ── Health check ──────────────────────────────────────────────────────────────
app.get("/health", (req, res) =>
  res.json({
    status: "ok",
    env: process.env.NODE_ENV,
    ts: new Date().toISOString(),
  }),
);

// ── API routes ────────────────────────────────────────────────────────────────
app.use("/api/auth", require("./routes/authRoutes"));
app.use("/api/bots", require("./routes/botRoutes"));
app.use("/api/widget", require("./routes/widgetRoutes"));
app.use("/api/conversations", require("./routes/conversationRoutes"));
app.use("/api/leads", require("./routes/leadRoutes"));
app.use("/api/analytics", require("./routes/analyticsRoutes"));
app.use("/api/admin", require("./routes/adminRoutes"));
app.use("/api/billing", require("./routes/billingRoutes"));
app.use("/api/meetings", require("./routes/meetingRoutes"));

// ── 404 handler ───────────────────────────────────────────────────────────────
app.use((req, res) =>
  res.status(404).json({ success: false, error: "Route not found" }),
);

// ── Global error handler ──────────────────────────────────────────────────────
app.use(errorHandler);

// ── Database + server boot ────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;

mongoose
  .connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => {
    console.log("✅ MongoDB connected");
    const server = app.listen(PORT, () =>
      console.log(
        `🚀 Server running on port ${PORT} [${process.env.NODE_ENV || "development"}]`,
      ),
    );

    const shutdown = (signal) => {
      console.log(`\n${signal} received — shutting down gracefully`);
      server.close(() => {
        mongoose.connection.close(false, () => {
          console.log("MongoDB connection closed");
          process.exit(0);
        });
      });
    };
    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
  })
  .catch((err) => {
    console.error("❌ MongoDB connection error:", err.message);
    process.exit(1);
  });

module.exports = app;
