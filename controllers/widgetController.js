const asyncHandler  = require('../utils/asyncHandler');
const ErrorResponse = require('../utils/ErrorResponse');
const Bot           = require('../models/Bot');
const Conversation  = require('../models/Conversation');
const Lead          = require('../models/Lead');
const Meeting       = require('../models/Meeting');
const User          = require('../models/User');
const { generateResponse, detectLeadInfo, detectMeetingIntent, summarizeConversation } = require('../services/aiService');
const calendarSvc   = require('../services/googleCalendarService');
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
exports.initWidget = asyncHandler(async (req, res, next) => {
  const { botId, sessionId, visitorInfo = {} } = req.body;
  if (!botId) return next(new ErrorResponse('botId is required', 400));

  const bot = await Bot.findOne({ botId, isActive: true, isDeleted: false });
  if (!bot) return next(new ErrorResponse('Bot not found', 404));

  const owner = await User.findById(bot.user);
  if (!owner || !owner.isActive) return next(new ErrorResponse('Service unavailable', 503));

  if (bot.allowedDomains.length > 0 && visitorInfo.page) {
    try {
      const pageHostname = new URL(visitorInfo.page).hostname.replace(/^www\./, '');
      const allowed = bot.allowedDomains.some(d => {
        const clean = d.replace(/^www\./, '');
        return pageHostname === clean || pageHostname.endsWith('.' + clean);
      });
      if (!allowed) return next(new ErrorResponse('Domain not allowed', 403));
    } catch (_) {}
  }

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
      meetingBooking: bot.meetingBooking,
    },
  });
});

// @route  POST /api/widget/message  (public)
exports.sendMessage = asyncHandler(async (req, res, next) => {
  const { botId, sessionId, message, visitorInfo = {} } = req.body;
  if (!botId)           return next(new ErrorResponse('botId is required', 400));
  if (!message?.trim()) return next(new ErrorResponse('message is required', 400));
  if (!sessionId)       return next(new ErrorResponse('sessionId is required', 400));
  if (message.length > 2000) return next(new ErrorResponse('Message too long', 400));

  const sanitizedMessage = message.replace(/<[^>]*>/g, '').trim();

  const bot = await Bot.findOne({ botId, isActive: true, isDeleted: false });
  if (!bot) return next(new ErrorResponse('Bot not found', 404));

  const owner = await User.findById(bot.user);
  if (!owner) return next(new ErrorResponse('Service unavailable', 503));

  if (bot.allowedDomains.length > 0 && visitorInfo.page) {
    try {
      const pageHostname = new URL(visitorInfo.page).hostname.replace(/^www\./, '');
      const allowed = bot.allowedDomains.some(d => {
        const clean = d.replace(/^www\./, '');
        return pageHostname === clean || pageHostname.endsWith('.' + clean);
      });
      if (!allowed) return next(new ErrorResponse('Domain not allowed', 403));
    } catch (_) {}
  }

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

    owner.usage.conversationsThisMonth += 1;
    bot.stats.totalConversations       += 1;
    await Promise.all([
      owner.save({ validateBeforeSave: false }),
      bot.save({ validateBeforeSave: false }),
    ]);
  }

  session.messages.push({ role: 'user', content: sanitizedMessage });
  bot.stats.totalMessages += 1;

  // ── Meeting booking intent detection ────────────────────────────────────────
  let meetingBooked    = false;
  let meetingDetails   = null;

  if (bot.meetingBooking?.enabled && !session.meetingBooked) {
    try {
      const recentText = session.messages.slice(-10)
        .map(m => `${m.role === 'user' ? 'User' : 'Bot'}: ${m.content}`)
        .join('\n');

      const intent = await detectMeetingIntent(recentText);

      if (intent.wantsBooking) {
        // Check if we have enough info to book
        const hasName      = intent.name  || session.collectedInfo?.name;
        const hasEmail     = intent.email || session.collectedInfo?.email;
        const hasDateOrTime = intent.preferredDate || intent.preferredTime;

        // Store partial info in session for multi-turn collection
        if (!session.collectedInfo) session.collectedInfo = {};
        if (intent.name)          session.collectedInfo.name          = intent.name;
        if (intent.email)         session.collectedInfo.email         = intent.email;
        if (intent.preferredDate) session.collectedInfo.preferredDate = intent.preferredDate;
        if (intent.preferredTime) session.collectedInfo.preferredTime = intent.preferredTime;
        if (intent.topic)         session.collectedInfo.topic         = intent.topic;

        const info = session.collectedInfo;

        if (info.name && info.email && (info.preferredDate || info.preferredTime)) {
          // We have enough — book the meeting
          try {
            // Parse a rough start time from natural language
            const startTime = parseMeetingTime(info.preferredDate, info.preferredTime);
            const duration  = bot.meetingBooking.duration || 30;
            const endTime   = new Date(startTime.getTime() + duration * 60000);

            const meeting = await Meeting.create({
              user:        bot.user,
              bot:         bot._id,
              conversation: session._id,
              guestName:   info.name,
              guestEmail:  info.email,
              title:       info.topic ? `Meeting: ${info.topic}` : `Meeting with ${info.name}`,
              description: info.topic || '',
              startTime,
              endTime,
              duration,
              timezone:    bot.meetingBooking.timezone || owner.timezone || 'UTC',
            });

            // Push to Google Calendar if connected
            const ownerWithTokens = await User.findById(bot.user).select('+googleCalendarTokens');
            if (ownerWithTokens.googleCalendarConnected && ownerWithTokens.googleCalendarTokens) {
              try {
                const event = await calendarSvc.createEvent(ownerWithTokens.googleCalendarTokens, {
                  title:       meeting.title,
                  description: meeting.description,
                  startTime:   meeting.startTime,
                  endTime:     meeting.endTime,
                  guestEmail:  meeting.guestEmail,
                  guestName:   meeting.guestName,
                  timezone:    meeting.timezone,
                });
                meeting.googleEventId  = event.eventId;
                meeting.googleMeetLink = event.meetLink;
                meeting.calendarLink   = event.htmlLink;
                await meeting.save();
              } catch (err) {
                console.error('Google Calendar booking failed:', err.message);
              }
            }

            session.meetingBooked   = true;
            meetingBooked           = true;
            meetingDetails          = meeting;

          } catch (err) {
            console.error('Meeting creation error:', err.message);
          }
        }
      }
    } catch (err) {
      console.error('Meeting intent detection error:', err.message);
    }
  }

  // ── Build system prompt — inject meeting instructions if enabled ────────────
  let systemPrompt = bot.buildSystemPrompt();

  if (bot.meetingBooking?.enabled && !session.meetingBooked) {
    systemPrompt += `\n\nMEETING BOOKING: You can schedule meetings for this business.
Available hours: ${bot.meetingBooking.availableHours || '9am - 5pm'}
Available days: ${bot.meetingBooking.availableDays || 'Monday - Friday'}
Duration: ${bot.meetingBooking.duration || 30} minutes

If the user wants to book a meeting/call/appointment/demo:
1. Ask for their name (if not given)
2. Ask for their email (if not given)
3. Ask for their preferred date and time
4. Once you have all three, confirm the booking details back to them naturally.
Do NOT say "I'll book it now" — just collect the info naturally in conversation.`;
  }

  if (meetingBooked && meetingDetails) {
    // Override AI response with confirmation
    const confirmMsg = bot.meetingBooking?.confirmationMsg ||
      "Your meeting has been booked! You'll receive a confirmation shortly.";

    const startFormatted = meetingDetails.startTime.toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });
    const timeFormatted = meetingDetails.startTime.toLocaleTimeString('en-US', {
      hour: '2-digit', minute: '2-digit',
    });

    const aiContent = `${confirmMsg}\n\n📅 **${meetingDetails.title}**\n📆 ${startFormatted} at ${timeFormatted}\n⏱ ${meetingDetails.duration} minutes${meetingDetails.googleMeetLink ? `\n🎥 [Join Google Meet](${meetingDetails.googleMeetLink})` : ''}`;

    session.messages.push({
      role:    'assistant',
      content: aiContent,
      model:   'system',
      tokens:  0,
      latency: 0,
    });

    await session.save();
    await bot.save({ validateBeforeSave: false });

    return res.json({
      success:       true,
      message:       aiContent,
      sessionId,
      leadCaptured:  session.lead?.captured || false,
      meetingBooked: true,
      meeting: {
        title:         meetingDetails.title,
        startTime:     meetingDetails.startTime,
        duration:      meetingDetails.duration,
        googleMeetLink: meetingDetails.googleMeetLink,
      },
    });
  }

  // ── Generate AI response ────────────────────────────────────────────────────
  const history = session.messages.slice(-20);

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

  session.messages.push({
    role:    'assistant',
    content: aiResult.content,
    tokens:  aiResult.tokens,
    model:   aiResult.model,
    latency: aiResult.latency,
  });

  session.totalTokens = (session.totalTokens || 0) + aiResult.tokens;

  // ── Lead detection ──────────────────────────────────────────────────────────
  const userMessages = session.messages.filter(m => m.role === 'user');
  if (!session.lead?.captured && userMessages.length % 2 === 0) {
    try {
      const convoText = session.messages.slice(-8)
        .map(m => `${m.role === 'user' ? 'User' : 'Bot'}: ${m.content}`)
        .join('\n');

      const leadInfo = await detectLeadInfo(convoText);

      if (leadInfo.hasLead && (leadInfo.email || leadInfo.phone)) {
        session.lead = {
          captured:   true,
          name:       leadInfo.name,
          email:      leadInfo.email,
          phone:      leadInfo.phone,
          capturedAt: new Date(),
        };

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

        bot.stats.totalLeads       += 1;
        owner.usage.leadsThisMonth += 1;

        sendLeadNotification(owner.email, lead, bot.name).catch(console.error);

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
    success:      true,
    message:      aiResult.content,
    sessionId,
    leadCaptured: session.lead?.captured || false,
    meetingBooked: false,
  });
});

// ── Helper: parse natural language date/time into a Date object ──────────────
function parseMeetingTime(preferredDate, preferredTime) {
  const now  = new Date();
  let date   = new Date(now);

  if (preferredDate) {
    const d = preferredDate.toLowerCase();
    if (d.includes('tomorrow')) {
      date.setDate(date.getDate() + 1);
    } else if (d.includes('monday'))    { date = nextWeekday(0, 1); }
    else if (d.includes('tuesday'))     { date = nextWeekday(0, 2); }
    else if (d.includes('wednesday'))   { date = nextWeekday(0, 3); }
    else if (d.includes('thursday'))    { date = nextWeekday(0, 4); }
    else if (d.includes('friday'))      { date = nextWeekday(0, 5); }
    else if (d.includes('saturday'))    { date = nextWeekday(0, 6); }
    else if (d.includes('sunday'))      { date = nextWeekday(0, 0); }
    else {
      // Try native Date parsing
      const parsed = new Date(preferredDate);
      if (!isNaN(parsed)) date = parsed;
      else date.setDate(date.getDate() + 1); // fallback: tomorrow
    }
  } else {
    date.setDate(date.getDate() + 1); // fallback: tomorrow
  }

  // Set time
  if (preferredTime) {
    const t = preferredTime.toLowerCase();
    if (t.includes('morning'))              { date.setHours(9, 0, 0, 0); }
    else if (t.includes('afternoon'))       { date.setHours(14, 0, 0, 0); }
    else if (t.includes('evening'))         { date.setHours(17, 0, 0, 0); }
    else {
      // Try to parse "3pm", "10am", "14:00" etc.
      const match = t.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
      if (match) {
        let hours   = parseInt(match[1]);
        const mins  = parseInt(match[2] || '0');
        const ampm  = match[3];
        if (ampm === 'pm' && hours < 12) hours += 12;
        if (ampm === 'am' && hours === 12) hours = 0;
        date.setHours(hours, mins, 0, 0);
      } else {
        date.setHours(10, 0, 0, 0); // fallback: 10am
      }
    }
  } else {
    date.setHours(10, 0, 0, 0); // fallback: 10am
  }

  return date;
}

function nextWeekday(fromOffset, targetDay) {
  const date = new Date();
  date.setDate(date.getDate() + fromOffset);
  const current = date.getDay();
  const diff    = (targetDay - current + 7) % 7 || 7;
  date.setDate(date.getDate() + diff);
  return date;
}

// @route  POST /api/widget/end  (public)
exports.endSession = asyncHandler(async (req, res, next) => {
  const { sessionId, rating } = req.body;
  if (!sessionId) return next(new ErrorResponse('sessionId is required', 400));

  const session = await Conversation.findOne({ sessionId });
  if (!session) return res.json({ success: true });

  session.status   = 'ended';
  session.endedAt  = new Date();
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
      .select('-messages'),
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
exports.captureLead = asyncHandler(async (req, res, next) => {
  const { sessionId, name, email, phone } = req.body;
  if (!sessionId)       return next(new ErrorResponse('sessionId is required', 400));
  if (!email && !phone) return next(new ErrorResponse('email or phone is required', 400));

  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return next(new ErrorResponse('Invalid email address', 400));
  }

  const session = await Conversation.findOne({ sessionId });
  if (!session) return next(new ErrorResponse('Session not found', 404));

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

  bot.stats.totalLeads       += 1;
  owner.usage.leadsThisMonth += 1;

  await Promise.all([
    session.save(),
    bot.save({ validateBeforeSave: false }),
    owner.save({ validateBeforeSave: false }),
  ]);

  sendLeadNotification(owner.email, lead, bot.name).catch(console.error);
  summarizeConversation(session.messages).then(summary => {
    if (summary) Lead.findByIdAndUpdate(lead._id, { summary }).exec();
  }).catch(() => {});

  res.json({ success: true, message: 'Lead captured successfully' });
});
