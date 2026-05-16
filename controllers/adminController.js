const asyncHandler  = require('../utils/asyncHandler');
const ErrorResponse = require('../utils/ErrorResponse');
const User          = require('../models/User');
const Bot           = require('../models/Bot');
const Conversation  = require('../models/Conversation');
const Lead          = require('../models/Lead');
const PLANS         = require('../config/plans');

// @route  GET /api/admin/stats
// Platform-wide overview for admin dashboard
exports.getPlatformStats = asyncHandler(async (req, res) => {
  const [
    totalUsers,
    activeUsers,
    totalBots,
    totalConversations,
    totalLeads,
    todaySignups,
    todayConversations,
    planBreakdown,
  ] = await Promise.all([
    User.countDocuments(),
    User.countDocuments({ isActive: true }),
    Bot.countDocuments({ isDeleted: false }),
    Conversation.countDocuments(),
    Lead.countDocuments(),
    User.countDocuments({ createdAt: { $gte: getToday() } }),
    Conversation.countDocuments({ createdAt: { $gte: getToday() } }),
    User.aggregate([
      { $group: { _id: '$plan', count: { $sum: 1 } } },
    ]),
  ]);

  // Monthly Recurring Revenue estimate
  const paidUsers = await User.find({
    plan:       { $in: ['starter', 'business', 'premium'] },
    planStatus: 'active',
  }).select('plan');

  const mrr = paidUsers.reduce((sum, u) => sum + (PLANS[u.plan]?.price || 0), 0);

  res.json({
    success: true,
    stats: {
      totalUsers,
      activeUsers,
      totalBots,
      totalConversations,
      totalLeads,
      todaySignups,
      todayConversations,
      mrr,
      planBreakdown: Object.fromEntries(planBreakdown.map(p => [p._id, p.count])),
    },
  });
});

// @route  GET /api/admin/users
// Paginated user list with search + plan filter
exports.getUsers = asyncHandler(async (req, res) => {
  const { page = 1, limit = 25, search, plan, status } = req.query;

  const filter = {};
  if (plan)   filter.plan     = plan;
  if (status === 'active')    filter.isActive = true;
  if (status === 'suspended') filter.isActive = false;

  if (search) {
    filter.$or = [
      { name:  { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
      { company: { $regex: search, $options: 'i' } },
    ];
  }

  const skip = (parseInt(page) - 1) * parseInt(limit);
  const [users, total] = await Promise.all([
    User.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .select('-password -refreshTokens -emailOtp -resetPasswordToken'),
    User.countDocuments(filter),
  ]);

  res.json({
    success: true,
    total,
    page:  parseInt(page),
    pages: Math.ceil(total / parseInt(limit)),
    users,
  });
});

// @route  GET /api/admin/users/:id
exports.getUser = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.params.id)
    .select('-password -refreshTokens -emailOtp -resetPasswordToken');
  if (!user) return next(new ErrorResponse('User not found', 404));

  const [bots, conversations, leads] = await Promise.all([
    Bot.countDocuments({ user: user._id, isDeleted: false }),
    Conversation.countDocuments({ user: user._id }),
    Lead.countDocuments({ user: user._id }),
  ]);

  res.json({ success: true, user, stats: { bots, conversations, leads } });
});

// @route  PUT /api/admin/users/:id
// Admin: change plan, suspend/activate, update role
exports.updateUser = asyncHandler(async (req, res, next) => {
  const { plan, planStatus, isActive, role } = req.body;

  const user = await User.findById(req.params.id);
  if (!user) return next(new ErrorResponse('User not found', 404));

  // Guard: prevent demoting yourself
  if (req.user._id.equals(user._id) && role && role !== 'admin') {
    return next(new ErrorResponse('Cannot change your own role', 400));
  }

  if (plan       !== undefined) user.plan       = plan;
  if (planStatus !== undefined) user.planStatus = planStatus;
  if (isActive   !== undefined) user.isActive   = isActive;
  if (role       !== undefined) user.role       = role;

  await user.save({ validateBeforeSave: false });

  res.json({ success: true, user });
});

// @route  DELETE /api/admin/users/:id
// Hard delete — use with caution (also deletes their bots/data)
exports.deleteUser = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.params.id);
  if (!user) return next(new ErrorResponse('User not found', 404));

  if (req.user._id.equals(user._id)) {
    return next(new ErrorResponse('Cannot delete your own account via admin', 400));
  }

  // Cascade soft-delete bots
  await Bot.updateMany({ user: user._id }, { isDeleted: true, isActive: false });
  await user.deleteOne();

  res.json({ success: true, message: 'User and associated bots deleted' });
});

// @route  GET /api/admin/bots
exports.getAllBots = asyncHandler(async (req, res) => {
  const { page = 1, limit = 25, search } = req.query;
  const filter = { isDeleted: false };

  if (search) {
    filter.$or = [
      { name:        { $regex: search, $options: 'i' } },
      { businessName: { $regex: search, $options: 'i' } },
    ];
  }

  const skip = (parseInt(page) - 1) * parseInt(limit);
  const [bots, total] = await Promise.all([
    Bot.find(filter)
      .populate('user', 'name email plan')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit)),
    Bot.countDocuments(filter),
  ]);

  res.json({
    success: true,
    total,
    page: parseInt(page),
    pages: Math.ceil(total / parseInt(limit)),
    bots,
  });
});

// @route  GET /api/admin/revenue
// Monthly revenue breakdown for the last 12 months
exports.getRevenue = asyncHandler(async (req, res) => {
  // Paid users grouped by plan with signup month
  const paidUsers = await User.find({
    plan:       { $in: ['starter', 'business', 'premium'] },
    planStatus: 'active',
  }).select('plan createdAt');

  const mrr = paidUsers.reduce((sum, u) => sum + (PLANS[u.plan]?.price || 0), 0);

  // MRR by plan
  const mrrByPlan = {
    starter:  0,
    business: 0,
    premium:  0,
  };
  paidUsers.forEach(u => { mrrByPlan[u.plan] = (mrrByPlan[u.plan] || 0) + PLANS[u.plan].price; });

  // New paid users per month (last 12 months)
  const twelveMonthsAgo = new Date();
  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

  const newPaidByMonth = await User.aggregate([
    {
      $match: {
        plan:       { $in: ['starter', 'business', 'premium'] },
        createdAt:  { $gte: twelveMonthsAgo },
      },
    },
    {
      $group: {
        _id:   { $dateToString: { format: '%Y-%m', date: '$createdAt' } },
        count: { $sum: 1 },
        revenue: {
          $sum: {
            $switch: {
              branches: [
                { case: { $eq: ['$plan', 'starter']  }, then: PLANS.starter.price  },
                { case: { $eq: ['$plan', 'business'] }, then: PLANS.business.price },
                { case: { $eq: ['$plan', 'premium']  }, then: PLANS.premium.price  },
              ],
              default: 0,
            },
          },
        },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  res.json({
    success: true,
    mrr,
    mrrByPlan,
    monthlyBreakdown: newPaidByMonth,
  });
});

// ── Helpers ───────────────────────────────────────────────────────────────────
const getToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};
