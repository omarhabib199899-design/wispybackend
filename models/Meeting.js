const mongoose = require('mongoose');

const MeetingSchema = new mongoose.Schema({
  user:         { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  bot:          { type: mongoose.Schema.Types.ObjectId, ref: 'Bot' },
  conversation: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation' },

  // Guest info
  guestName:  { type: String, required: true, trim: true },
  guestEmail: { type: String, required: true, trim: true, lowercase: true },
  guestPhone: { type: String, trim: true },

  // Meeting details
  title:       { type: String, default: 'Meeting via Wispy' },
  description: { type: String },
  startTime:   { type: Date, required: true },
  endTime:     { type: Date, required: true },
  duration:    { type: Number, default: 30 }, // minutes
  timezone:    { type: String, default: 'UTC' },

  // Google Calendar
  googleEventId:   { type: String },
  googleMeetLink:  { type: String },
  calendarLink:    { type: String },

  // Status
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'cancelled', 'completed'],
    default: 'confirmed',
  },

  notes: { type: String },
}, { timestamps: true });

MeetingSchema.index({ user: 1, startTime: -1 });
MeetingSchema.index({ guestEmail: 1 });

module.exports = mongoose.model('Meeting', MeetingSchema);
