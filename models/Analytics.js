const mongoose = require('mongoose');

// Daily snapshot per bot — aggregated by cron job each night
const AnalyticsSchema = new mongoose.Schema({
  bot:  { type: mongoose.Schema.Types.ObjectId, ref: 'Bot', required: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  date: { type: Date, required: true }, // midnight UTC for this day

  conversations:   { type: Number, default: 0 },
  messages:        { type: Number, default: 0 },
  leads:           { type: Number, default: 0 },
  uniqueVisitors:  { type: Number, default: 0 },
  avgResponseTime: { type: Number, default: 0 }, // ms
  avgDuration:     { type: Number, default: 0 },  // seconds
  satisfactionAvg: { type: Number, default: 0 },  // 1-5
  tokensUsed:      { type: Number, default: 0 },

  // Top questions asked
  topQuestions: [{
    question: String,
    count:    Number,
  }],

}, { timestamps: true });

AnalyticsSchema.index({ bot: 1, date: -1 });
AnalyticsSchema.index({ user: 1, date: -1 });
AnalyticsSchema.index({ date: -1 });

module.exports = mongoose.model('Analytics', AnalyticsSchema);
