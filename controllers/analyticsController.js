const asyncHandler  = require('../utils/asyncHandler');
const ErrorResponse = require('../utils/ErrorResponse');
const Conversation  = require('../models/Conversation');
const Lead          = require('../models/Lead');
const Bot           = require('../models/Bot');
const Analytics     = require('../models/Analytics');

// @route  GET /api/analytics/overview
exports.getOverview = asyncHandler(async (req, res) => {
  const userId = req.user._id;

  const [
    totalBots,
    totalConvs,
    totalLeads,
    todayConvs,
    todayLeads,
    newLeads,
    activeConvs,
  ] = await Promise.all([
    Bot.countDocuments({ user: userId, isDeleted: false }),
    Conversation.countDocuments({ user: userId }),
    Lead.countDocuments({ user: userId }),
    Conversation.countDocuments({ user: userId, createdAt: { $gte: getToday() } }),
    Lead.countDocuments({ user: userId, createdAt: { $gte: getToday() } }),
    Lead.countDocuments({ user: userId, status: 'new' }),
    Conversation.countDocuments({ user: userId, status: 'active' }),
  ]);

  res.json({
    success: true,
    overview: {
      totalBots,
      totalConversations: totalConvs,
      totalLeads,
      todayConversations: todayConvs,
      todayLeads,
      newLeads,
      activeConversations: activeConvs,
    },
  });
});

// @route  GET /api/analytics/chart
// Returns daily data for charting (last N days)
exports.getChart = asyncHandler(async (req, res) => {
  const { botId, days = 7 } = req.query;
  const filter = { user: req.user._id };
  if (botId) filter.bot = botId;

  const since = new Date();
  since.setDate(since.getDate() - parseInt(days));
  since.setHours(0, 0, 0, 0);

  // Aggregate conversations per day
  const convAgg = await Conversation.aggregate([
    { $match: { ...filter, createdAt: { $gte: since } } },
    { $group: {
      _id:   { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
      count: { $sum: 1 },
    }},
    { $sort: { _id: 1 } },
  ]);

  const leadAgg = await Lead.aggregate([
    { $match: { ...filter, createdAt: { $gte: since } } },
    { $group: {
      _id:   { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
      count: { $sum: 1 },
    }},
    { $sort: { _id: 1 } },
  ]);

  // Build full date range
  const dateRange = [];
  for (let i = parseInt(days) - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    dateRange.push(d.toISOString().split('T')[0]);
  }

  const convMap  = Object.fromEntries(convAgg.map(r => [r._id, r.count]));
  const leadMap  = Object.fromEntries(leadAgg.map(r => [r._id, r.count]));

  const chart = dateRange.map(date => ({
    date,
    conversations: convMap[date] || 0,
    leads:         leadMap[date] || 0,
  }));

  res.json({ success: true, chart });
});

// @route  GET /api/analytics/top-questions
exports.getTopQuestions = asyncHandler(async (req, res) => {
  const { botId, days = 30 } = req.query;
  const since  = new Date(Date.now() - parseInt(days) * 24 * 60 * 60 * 1000);
  const filter = { user: req.user._id, createdAt: { $gte: since } };
  if (botId) filter.bot = botId;

  const conversations = await Conversation.find(filter).select('messages').limit(500);

  // Extract all user messages
  const questions = [];
  conversations.forEach(c => {
    c.messages.filter(m => m.role === 'user').forEach(m => {
      if (m.content.length < 200) questions.push(m.content.trim().toLowerCase());
    });
  });

  // Simple frequency count
  const freq = {};
  questions.forEach(q => { freq[q] = (freq[q] || 0) + 1; });
  const top = Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([question, count]) => ({ question, count }));

  res.json({ success: true, topQuestions: top });
});

// ── Helpers ───────────────────────────────────────────────────────────────────
const getToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};
