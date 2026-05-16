const asyncHandler  = require('../utils/asyncHandler');
const ErrorResponse = require('../utils/ErrorResponse');
const Bot           = require('../models/Bot');
const Conversation  = require('../models/Conversation');
const Lead          = require('../models/Lead');
const User          = require('../models/User');
const { generateResponse, detectLeadInfo, summarizeConversation } = require('../services/aiService');
const { sendLeadNotification } = require('../services/emailService');
const { v4: uuidv4 } = require('uuid');

// ── Helper: find or create session ───────────────────────────────────────────
const getOrCreateSession = async (botId, sessionId, visitorInfo) => {
  let session = await Conversation.findOne({ sessionId });
  if (!session) {
    const bot = await Bot.findOne({ botId, isActive: true, isDeleted: false });
    if (!bot) throw new ErrorResponse('Bot not found or inactive', 404);

    const owner = await User.findById(bot.user);
    if (!owner || !owner.isActive) throw new ErrorResponse('Service unavailable', 503);

    // Check domain restriction
    if (bot.allowedDomains.length > 0 && visitorInfo.origin) {
      const origin = visitorInfo.origin.replace(/^https?:\/\//, '').replace(/\/$/, '').split('/')[0];
      const allowed = bot.allowedDomains.some(d => origin === d || origin.endsWith(`.${d}`));
      if (!allowed) throw new ErrorResponse('Domain not allowed', 403);
    }

    // Check plan limits
    const canChat = await owner.canConverse();
    if (!canChat) throw new ErrorResponse('Monthly conversation limit reached for this bot', 429);

    session = await Conversation.create({
      bot:      bot._id,
      user:     bot.user,
      botId,
      sessionId: sessionId || uuidv4(),
      visitor:  visitorInfo,
      messages: [],
    });
  }
  return session;
};

// @route  POST /api/widget/init  (public)
// Called when widget loads on a page — returns welcome message + session.
// Persists the session so history survives page reloads.
exports.initWidget = asyncHandler(async (req, res, next) => {
  const { botId, sessionId, visitorInfo = {} } = req.body;
  if (!botId) return next(new ErrorResponse('botId is required', 400));

  const bot = await Bot.findOne({ botId, isActive: true, isDeleted: false });
  if (!bot) return next(new ErrorResponse('Bot not found', 404));

  const owner = await User.findById(bot.user);
  if (!owner || !owner.isActive) return next(new ErrorResponse('Service unavailable', 503));

  // ── Domain restriction check (mirrors the check in sendMessage) ────────────
  if (bot.allowedDomains.length > 0 && visitorInfo.page) {
    try {
      const pageHostname = new URL(visitorInfo.page).hostname.replace(/^www\./, '');
      const allowed = bot.allowedDomains.some(d => {
        const clean = d.replace(/^www\./, '');
        return pageHostname === clean || pageHostname.endsWith('.' + clean);
      });
      if (!allowed) return next(new ErrorResponse('Domain not allowed', 403));
    } catch (_) { /* invalid URL — allow through */ }
  }

  // Reuse existing session or create a new one
  let session = sessionId ? await Conversation.findOne({ sessionId }) : null;

  if (!session) {
    const canChat = await owner.canConverse();
    if (!canChat) return next(new ErrorResponse('Conversation limit reached for this bot', 429));

    session = await Conversation.create({
      bot:       bot._id,
      user:      bot.user,
      botId,
      sessionId: uuidv4(),
      visitor:   visitorInfo,
      messages:  [],
    });

    owner.usage.conversationsThisMonth += 1;
    bot.stats.totalConversations       += 1;
    await Promise.all([
      owner.save({ validateBeforeSave: false }),
      bot.save({ validateBeforeSave: false }),
    ]);
  }

  res.json({
    success: true,
    sessionId: session.sessionId,
    bot: {
      name:           bot.name,
      avatarEmoji:    bot.avatarEmoji,
      welcomeMessage: bot.welcomeMessage,
      theme:          bot.theme,
      leadCapture:    bot.leadCapture,
    },
  });
});

// @route  POST /api/widget/message  (public)
// Core chat endpoint — processes user message and returns AI response
exports.sendMessage = asyncHandler(async (req, res, next) => {
  const { botId, sessionId, message, visitorInfo = {} } = req.body;
  if (!botId)    return next(new ErrorResponse('botId is required', 400));
  if (!message?.trim()) return next(new ErrorResponse('message is required', 400));
  if (!sessionId) return next(new ErrorResponse('sessionId is required', 400));
  if (message.length > 2000) return next(new ErrorResponse('Message too long', 400));
  // Sanitize: strip HTML/script tags to prevent XSS in dashboard rendering
  const sanitizedMessage = message.replace(/<[^>]*>/g, '').trim();

  const bot = await Bot.findOne({ botId, isActive: true, isDeleted: false });
  if (!bot) return next(new ErrorResponse('Bot not found', 404));

  const owner = await User.findById(bot.user);
  if (!owner) return next(new ErrorResponse('Service unavailable', 503));

  // Domain restriction check — widget sends visitorInfo.page (full URL)
  if (bot.allowedDomains.length > 0 && visitorInfo.page) {
    try {
      const pageHostname = new URL(visitorInfo.page).hostname.replace(/^www\./, '');
      const allowed = bot.allowedDomains.some(d => {
        const clean = d.replace(/^www\./, '');
        return pageHostname === clean || pageHostname.endsWith('.' + clean);
      });
      if (!allowed) return next(new ErrorResponse('Domain not allowed', 403));
    } catch (_) { /* invalid URL — allow through */ }
  }

  // Rate limit per botId to protect quota across IPs
  // (IP-level rate limiting already applied by widgetLimit middleware)

  // Check / create session — normally already created by /init, but handle direct calls too
  let session = await Conversation.findOne({ sessionId });
  if (!session) {
    const canChat = await owner.canConverse();
    if (!canChat) return next(new ErrorResponse('Conversation limit reached', 429));

    session = await Conversation.create({
      bot:      bot._id,
      user:     bot.user,
      botId,
      sessionId,
      visitor:  visitorInfo,
      messages: [],
    });

    // Only increment counters here if session wasn't created by /init
    owner.usage.conversationsThisMonth += 1;
    bot.stats.totalConversations       += 1;
    await Promise.all([
      owner.save({ validateBeforeSave: false }),
      bot.save({ validateBeforeSave: false }),
    ]);
  }

  // Add user message to session (use sanitized content)
  session.messages.push({ role: 'user', content: sanitizedMessage });
  bot.stats.totalMessages += 1;

  // ── Generate AI response ────────────────────────────────────────────────────
  const systemPrompt = bot.buildSystemPrompt();
  const history      = session.messages.slice(-20); // last 20 messages for context

  let aiResult;
  try {
    aiResult = await generateResponse(history, systemPrompt, {
      temperature: bot.temperature,
      maxTokens:   bot.maxTokens,
    });
  } catch (err) {
    console.error('AI error:', err.message);
    aiResult = {
      content: bot.fallbackMessage,
      model:   'fallback',
      tokens:  0,
      latency: 0,
    };
  }

  // Add assistant message
  session.messages.push({
    role:    'assistant',
    content: aiResult.content,
    tokens:  aiResult.tokens,
    model:   aiResult.model,
    latency: aiResult.latency,
  });

  session.totalTokens += aiResult.tokens;

  // ── Lead detection ──────────────────────────────────────────────────────────
  // Check after every 2nd user message if lead info was shared
  const userMessages = session.messages.filter(m => m.role === 'user');
  if (!session.lead.captured && userMessages.length % 2 === 0) {
    try {
      const convoText = session.messages.slice(-8)
        .map(m => `${m.role === 'user' ? 'User' : 'Bot'}: ${m.content}`)
        .join('\n');

      const leadInfo = await detectLeadInfo(convoText);

      if (leadInfo.hasLead && (leadInfo.email || leadInfo.phone)) {
        session.lead = {
          captured:  true,
          name:      leadInfo.name,
          email:     leadInfo.email,
          phone:     leadInfo.phone,
          capturedAt: new Date(),
        };

        // Save to Leads collection
        const lead = await Lead.create({
          bot:          bot._id,
          user:         bot.user,
          conversation: session._id,
          name:         leadInfo.name,
          email:        leadInfo.email,
          phone:        leadInfo.phone,
          topic:        leadInfo.topic,
          source:       visitorInfo.page,
        });

        // Update stats
        bot.stats.totalLeads    += 1;
        owner.usage.leadsThisMonth += 1;

        // Send email notification to bot owner (async, don't await)
        sendLeadNotification(owner.email, lead, bot.name).catch(console.error);

        // Generate summary async
        summarizeConversation(session.messages).then(summary => {
          if (summary) Lead.findByIdAndUpdate(lead._id, { summary }).exec();
        }).catch(() => {});
      }
    } catch (e) {
      console.error('Lead detection error:', e.message);
    }
  }

  await session.save();
  await bot.save({ validateBeforeSave: false });
  await owner.save({ validateBeforeSave: false });

  res.json({
    success: true,
    message: aiResult.content,
    sessionId,
    leadCaptured: session.lead.captured,
  });
});

// @route  POST /api/widget/end  (public)
// Called when visitor closes chat
exports.endSession = asyncHandler(async (req, res, next) => {
  const { sessionId, rating } = req.body;
  if (!sessionId) return next(new ErrorResponse('sessionId is required', 400));

  const session = await Conversation.findOne({ sessionId });
  if (!session) return res.json({ success: true });

  session.status  = 'ended';
  session.endedAt = new Date();
  session.duration = Math.round((new Date() - session.createdAt) / 1000);
  if (rating && rating >= 1 && rating <= 5) session.rating = rating;

  await session.save();
  res.json({ success: true });
});

// ── Authenticated conversation endpoints (for dashboard) ──────────────────────

// @route  GET /api/conversations
exports.getConversations = asyncHandler(async (req, res) => {
  const { botId, page = 1, limit = 20, status, hasLead } = req.query;
  const filter = { user: req.user._id };
  if (botId)   filter.bot = botId;
  if (status)  filter.status = status;
  if (hasLead === 'true') filter['lead.captured'] = true;

  const skip = (parseInt(page) - 1) * parseInt(limit);
  const [conversations, total] = await Promise.all([
    Conversation.find(filter)
      .populate('bot', 'name avatarEmoji')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .select('-messages'), // exclude message content in list view
    Conversation.countDocuments(filter),
  ]);

  res.json({
    success: true,
    total,
    page:  parseInt(page),
    pages: Math.ceil(total / parseInt(limit)),
    conversations,
  });
});

// @route  GET /api/conversations/:id
exports.getConversation = asyncHandler(async (req, res, next) => {
  const conv = await Conversation.findOne({ _id: req.params.id, user: req.user._id })
    .populate('bot', 'name avatarEmoji');
  if (!conv) return next(new ErrorResponse('Conversation not found', 404));
  res.json({ success: true, conversation: conv });
});

// @route  DELETE /api/conversations/:id
exports.deleteConversation = asyncHandler(async (req, res, next) => {
  const conv = await Conversation.findOne({ _id: req.params.id, user: req.user._id });
  if (!conv) return next(new ErrorResponse('Conversation not found', 404));
  await conv.deleteOne();
  res.json({ success: true, message: 'Conversation deleted' });
});

// @route  POST /api/widget/lead  (public)
// Structured lead capture — called by the widget lead form directly.
// Accepts { sessionId, name, email, phone } and saves without AI detection,
// eliminating false positives from natural conversation messages.
exports.captureLead = asyncHandler(async (req, res, next) => {
  const { sessionId, name, email, phone } = req.body;
  if (!sessionId)       return next(new ErrorResponse('sessionId is required', 400));
  if (!email && !phone) return next(new ErrorResponse('email or phone is required', 400));

  // Basic email format check
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return next(new ErrorResponse('Invalid email address', 400));
  }

  const session = await Conversation.findOne({ sessionId });
  if (!session) return next(new ErrorResponse('Session not found', 404));

  // Don't double-capture
  if (session.lead?.captured) {
    return res.json({ success: true, message: 'Lead already captured' });
  }

  const bot   = await Bot.findById(session.bot);
  const owner = await User.findById(session.user);
  if (!bot || !owner) return next(new ErrorResponse('Service unavailable', 503));

  session.lead = { captured: true, name, email, phone, capturedAt: new Date() };

  const lead = await Lead.create({
    bot:          bot._id,
    user:         bot.user,
    conversation: session._id,
    name,
    email,
    phone,
    source:       session.visitor?.page,
  });

  bot.stats.totalLeads    += 1;
  owner.usage.leadsThisMonth += 1;

  await Promise.all([
    session.save(),
    bot.save({ validateBeforeSave: false }),
    owner.save({ validateBeforeSave: false }),
  ]);

  // Async: notify + summarize
  sendLeadNotification(owner.email, lead, bot.name).catch(console.error);
  summarizeConversation(session.messages).then(summary => {
    if (summary) Lead.findByIdAndUpdate(lead._id, { summary }).exec();
  }).catch(() => {});

  res.json({ success: true, message: 'Lead captured successfully' });
});
