const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema({
  role:      { type: String, enum: ['user', 'assistant', 'system'], required: true },
  content:   { type: String, required: true, maxlength: 5000 },
  timestamp: { type: Date, default: Date.now },
  tokens:    { type: Number, default: 0 },
  model:     { type: String }, // which model was used
  latency:   { type: Number }, // ms to respond
}, { _id: true });

const ConversationSchema = new mongoose.Schema({
  bot:      { type: mongoose.Schema.Types.ObjectId, ref: 'Bot', required: true },
  user:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  botId:    { type: String, required: true }, // denormalized for widget queries
  sessionId: { type: String, required: true, unique: true },

  // ── Visitor info ──────────────────────────────────────────────────────────
  visitor: {
    ip:        { type: String },
    userAgent: { type: String },
    country:   { type: String },
    city:      { type: String },
    page:      { type: String }, // URL where chat started
    referrer:  { type: String },
  },

  // ── Lead data (captured mid-conversation) ─────────────────────────────────
  lead: {
    captured:  { type: Boolean, default: false },
    name:      { type: String },
    email:     { type: String },
    phone:     { type: String },
    capturedAt: { type: Date },
  },

  // ── Messages ──────────────────────────────────────────────────────────────
  messages: [MessageSchema],

  // ── Metadata ──────────────────────────────────────────────────────────────
  status:    { type: String, enum: ['active', 'ended', 'handed_off'], default: 'active' },
  rating:    { type: Number, min: 1, max: 5 }, // visitor satisfaction rating
  duration:  { type: Number, default: 0 }, // seconds
  totalTokens: { type: Number, default: 0 },
  endedAt:   { type: Date },

}, { timestamps: true });

ConversationSchema.index({ bot: 1, createdAt: -1 });
ConversationSchema.index({ user: 1, createdAt: -1 });
ConversationSchema.index({ botId: 1, createdAt: -1 });
ConversationSchema.index({ sessionId: 1 });
ConversationSchema.index({ 'lead.email': 1 });
ConversationSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Conversation', ConversationSchema);
