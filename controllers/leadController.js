const asyncHandler  = require('../utils/asyncHandler');
const ErrorResponse = require('../utils/ErrorResponse');
const Lead          = require('../models/Lead');

// @route  GET /api/leads
exports.getLeads = asyncHandler(async (req, res) => {
  const { botId, status, page = 1, limit = 20, search, isArchived } = req.query;
  const filter = { user: req.user._id };

  if (botId)  filter.bot = botId;
  if (status) filter.status = status;
  filter.isArchived = isArchived === 'true';

  if (search) {
    filter.$or = [
      { name:  { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
      { phone: { $regex: search, $options: 'i' } },
    ];
  }

  const skip = (parseInt(page) - 1) * parseInt(limit);
  const [leads, total] = await Promise.all([
    Lead.find(filter)
      .populate('bot', 'name avatarEmoji')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit)),
    Lead.countDocuments(filter),
  ]);

  res.json({
    success: true,
    total,
    page:  parseInt(page),
    pages: Math.ceil(total / parseInt(limit)),
    leads,
  });
});

// @route  GET /api/leads/:id
exports.getLead = asyncHandler(async (req, res, next) => {
  const lead = await Lead.findOne({ _id: req.params.id, user: req.user._id })
    .populate('bot', 'name')
    .populate('conversation', 'messages createdAt duration');
  if (!lead) return next(new ErrorResponse('Lead not found', 404));
  res.json({ success: true, lead });
});

// @route  PUT /api/leads/:id
exports.updateLead = asyncHandler(async (req, res, next) => {
  const { status, notes, name, email, phone, company } = req.body;
  const lead = await Lead.findOneAndUpdate(
    { _id: req.params.id, user: req.user._id },
    { status, notes, name, email, phone, company },
    { new: true, runValidators: false }
  );
  if (!lead) return next(new ErrorResponse('Lead not found', 404));
  res.json({ success: true, lead });
});

// @route  DELETE /api/leads/:id
exports.deleteLead = asyncHandler(async (req, res, next) => {
  const lead = await Lead.findOneAndDelete({ _id: req.params.id, user: req.user._id });
  if (!lead) return next(new ErrorResponse('Lead not found', 404));
  res.json({ success: true, message: 'Lead deleted' });
});

// @route  PUT /api/leads/:id/archive
exports.archiveLead = asyncHandler(async (req, res, next) => {
  const lead = await Lead.findOne({ _id: req.params.id, user: req.user._id });
  if (!lead) return next(new ErrorResponse('Lead not found', 404));
  lead.isArchived = !lead.isArchived;
  await lead.save();
  res.json({ success: true, lead });
});

// @route  GET /api/leads/export/csv
exports.exportLeads = asyncHandler(async (req, res) => {
  const { botId } = req.query;
  const filter = { user: req.user._id, isArchived: false };
  if (botId) filter.bot = botId;

  const leads = await Lead.find(filter).sort({ createdAt: -1 });

  const header = 'Name,Email,Phone,Company,Status,Topic,Date\n';
  const rows   = leads.map(l =>
    `"${l.name || ''}","${l.email || ''}","${l.phone || ''}","${l.company || ''}","${l.status}","${l.topic || ''}","${l.createdAt.toISOString()}"`
  ).join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=wispy-leads.csv');
  res.send(header + rows);
});
