const asyncHandler = require("../utils/asyncHandler");
const ErrorResponse = require("../utils/ErrorResponse");
const Bot = require("../models/Bot");
const Conversation = require("../models/Conversation");
const Lead = require("../models/Lead");
const Analytics = require("../models/Analytics");
const { uploadFile } = require("../services/s3Service");
const { summarizeUrlContent } = require("../services/aiService");
const axios = require("axios");
const cheerio = require("cheerio");

// ── Helper ────────────────────────────────────────────────────────────────────
const getBot = async (botId, userId) => {
  const bot = await Bot.findOne({ _id: botId, user: userId, isDeleted: false });
  if (!bot) throw new ErrorResponse("Bot not found", 404);
  return bot;
};

// @route  GET /api/bots
exports.getBots = asyncHandler(async (req, res) => {
  const bots = await Bot.find({ user: req.user._id, isDeleted: false }).sort({
    createdAt: -1,
  });
  res.json({ success: true, count: bots.length, bots });
});

// @route  POST /api/bots
exports.createBot = asyncHandler(async (req, res, next) => {
  const canCreate = await req.user.canCreateBot();
  if (!canCreate) {
    return next(
      new ErrorResponse(
        `Your ${req.user.plan} plan allows limited bots. Upgrade to create more.`,
        403,
      ),
    );
  }

  const {
    name,
    description,
    welcomeMessage,
    fallbackMessage,
    businessName,
    businessType,
    businessHours,
    businessPhone,
    businessEmail,
    businessAddress,
    systemPrompt,
    theme,
    leadCapture,
    allowedDomains,
    language,
  } = req.body;

  if (!name?.trim())
    return next(new ErrorResponse("Bot name is required", 400));

  const bot = await Bot.create({
    user: req.user._id,
    name,
    description,
    welcomeMessage,
    fallbackMessage,
    businessName,
    businessType,
    businessHours,
    businessPhone,
    businessEmail,
    businessAddress,
    systemPrompt,
    language,
    theme: theme || {},
    leadCapture: leadCapture || {},
    allowedDomains: allowedDomains || [],
  });

  res.status(201).json({ success: true, bot });
});

// @route  GET /api/bots/:id
exports.getBot = asyncHandler(async (req, res, next) => {
  const bot = await getBot(req.params.id, req.user._id);
  res.json({ success: true, bot });
});

// @route  PUT /api/bots/:id
exports.updateBot = asyncHandler(async (req, res, next) => {
  let bot = await getBot(req.params.id, req.user._id);

  const allowed = [
    "name",
    "description",
    "welcomeMessage",
    "fallbackMessage",
    "businessName",
    "businessType",
    "businessHours",
    "businessPhone",
    "businessEmail",
    "businessAddress",
    "systemPrompt",
    "theme",
    "leadCapture",
    "allowedDomains",
    "isActive",
    "language",
    "temperature",
    "maxTokens",
    "meetingBooking",
  ];
  allowed.forEach((field) => {
    if (req.body[field] !== undefined) bot[field] = req.body[field];
  });

  await bot.save();
  res.json({ success: true, bot });
});

// @route  DELETE /api/bots/:id
exports.deleteBot = asyncHandler(async (req, res, next) => {
  const bot = await getBot(req.params.id, req.user._id);
  bot.isDeleted = true;
  bot.deletedAt = new Date();
  bot.isActive = false;
  await bot.save();
  res.json({ success: true, message: "Bot deleted" });
});

// @route  GET /api/bots/:id/embed
exports.getEmbedCode = asyncHandler(async (req, res, next) => {
  const bot = await getBot(req.params.id, req.user._id);
  const widgetUrl =
    process.env.WIDGET_CDN_URL || process.env.RAILWAY_PUBLIC_DOMAIN
      ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
      : process.env.API_URL || "https://wispybackend-production.up.railway.app";

  const snippet = `<!-- Wispy Chatbot Widget -->
<script
  src="${widgetUrl}/widget.js"
  data-bot-id="${bot.botId}"
  data-color="${bot.theme.primaryColor}"
  data-position="${bot.theme.position}"
  async>
</script>`;

  res.json({ success: true, botId: bot.botId, snippet });
});

// ── Knowledge base ─────────────────────────────────────────────────────────────

// @route  POST /api/bots/:id/knowledge/qa
exports.addQA = asyncHandler(async (req, res, next) => {
  const bot = await getBot(req.params.id, req.user._id);
  const { question, answer } = req.body;
  if (!question?.trim() || !answer?.trim())
    return next(new ErrorResponse("Question and answer are required", 400));
  if (bot.knowledge.length >= 200)
    return next(
      new ErrorResponse("Maximum 200 knowledge entries reached", 400),
    );

  bot.knowledge.push({
    type: "qa",
    question: question.trim(),
    answer: answer.trim(),
  });
  bot.lastTrainedAt = new Date();
  await bot.save();
  res.status(201).json({ success: true, knowledge: bot.knowledge });
});

// @route  POST /api/bots/:id/knowledge/text
exports.addText = asyncHandler(async (req, res, next) => {
  const bot = await getBot(req.params.id, req.user._id);
  const { content } = req.body;
  if (!content?.trim())
    return next(new ErrorResponse("Content is required", 400));

  bot.knowledge.push({ type: "text", content: content.trim() });
  bot.lastTrainedAt = new Date();
  await bot.save();
  res.status(201).json({ success: true, knowledge: bot.knowledge });
});

// @route  POST /api/bots/:id/knowledge/url
// Scrapes a URL and adds it to knowledge base
exports.scrapeUrl = asyncHandler(async (req, res, next) => {
  if (!req.user.hasFeature("urlScraping")) {
    return next(
      new ErrorResponse("URL scraping requires Business plan or higher", 403),
    );
  }

  const bot = await getBot(req.params.id, req.user._id);
  const { url } = req.body;
  if (!url?.trim()) return next(new ErrorResponse("URL is required", 400));

  // Fetch & parse the URL
  let rawText = "";
  try {
    const response = await axios.get(url, {
      timeout: 10000,
      headers: { "User-Agent": "WispyBot/1.0 (AI training scraper)" },
    });
    const $ = cheerio.load(response.data);
    $(
      "script, style, nav, footer, header, .cookie-banner, #cookie-notice",
    ).remove();
    rawText = $("body").text().replace(/\s+/g, " ").trim();
  } catch (err) {
    return next(new ErrorResponse(`Could not fetch URL: ${err.message}`, 400));
  }

  if (!rawText)
    return next(new ErrorResponse("No content found at this URL", 400));

  // Summarize with AI
  const summary = await summarizeUrlContent(rawText, url);

  bot.knowledge.push({ type: "url", url, content: summary });
  bot.lastTrainedAt = new Date();
  await bot.save();
  res.status(201).json({ success: true, knowledge: bot.knowledge });
});

// @route  DELETE /api/bots/:id/knowledge/:knowledgeId
exports.deleteKnowledge = asyncHandler(async (req, res, next) => {
  const bot = await getBot(req.params.id, req.user._id);
  const entry = bot.knowledge.id(req.params.knowledgeId);
  if (!entry) return next(new ErrorResponse("Knowledge entry not found", 404));
  entry.deleteOne();
  await bot.save();
  res.json({ success: true, knowledge: bot.knowledge });
});

// @route  PUT /api/bots/:id/knowledge/:knowledgeId/toggle
exports.toggleKnowledge = asyncHandler(async (req, res, next) => {
  const bot = await getBot(req.params.id, req.user._id);
  const entry = bot.knowledge.id(req.params.knowledgeId);
  if (!entry) return next(new ErrorResponse("Knowledge entry not found", 404));
  entry.isActive = !entry.isActive;
  await bot.save();
  res.json({ success: true, entry });
});

// ── Bot stats ──────────────────────────────────────────────────────────────────

// @route  GET /api/bots/:id/stats
exports.getBotStats = asyncHandler(async (req, res, next) => {
  const bot = await getBot(req.params.id, req.user._id);

  const [totalConvs, totalLeads, last7Days] = await Promise.all([
    Conversation.countDocuments({ bot: bot._id }),
    Lead.countDocuments({ bot: bot._id }),
    Analytics.find({ bot: bot._id }).sort({ date: -1 }).limit(7),
  ]);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayConvs = await Conversation.countDocuments({
    bot: bot._id,
    createdAt: { $gte: today },
  });
  const todayLeads = await Lead.countDocuments({
    bot: bot._id,
    createdAt: { $gte: today },
  });

  res.json({
    success: true,
    stats: {
      totalConversations: totalConvs,
      totalLeads,
      todayConversations: todayConvs,
      todayLeads,
      last7Days,
      ...bot.stats,
    },
  });
});
