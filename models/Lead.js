const mongoose = require('mongoose');

const LeadSchema = new mongoose.Schema({
  bot:          { type: mongoose.Schema.Types.ObjectId, ref: 'Bot', required: true },
  user:         { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  conversation: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation' },

  // ── Contact info ──────────────────────────────────────────────────────────
  name:    { type: String, trim: true },
  email:   { type: String, trim: true, lowercase: true },
  phone:   { type: String, trim: true },
  company: { type: String, trim: true },

  // ── Context ───────────────────────────────────────────────────────────────
  source:   { type: String }, // page URL where lead came from
  topic:    { type: String }, // what they asked about
  summary:  { type: String }, // AI-generated conversation summary
  notes:    { type: String }, // manual notes from owner

  // ── Status ────────────────────────────────────────────────────────────────
  status:      { type: String, enum: ['new', 'contacted', 'qualified', 'converted', 'lost'], default: 'new' },
  isArchived:  { type: Boolean, default: false },

}, { timestamps: true });

LeadSchema.index({ user: 1, createdAt: -1 });
LeadSchema.index({ bot: 1, createdAt: -1 });
LeadSchema.index({ email: 1 });
LeadSchema.index({ status: 1 });

module.exports = mongoose.model('Lead', LeadSchema);
