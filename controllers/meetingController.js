const asyncHandler  = require('../utils/asyncHandler');
const ErrorResponse = require('../utils/ErrorResponse');
const Meeting       = require('../models/Meeting');
const User          = require('../models/User');
const calendarSvc   = require('../services/googleCalendarService');

// ── Google OAuth ──────────────────────────────────────────────────────────────

// @route  GET /api/meetings/google/auth-url
// Returns the Google OAuth URL the user visits to connect their calendar
exports.getGoogleAuthUrl = asyncHandler(async (req, res) => {
  const url = calendarSvc.getAuthUrl();
  res.json({ success: true, url });
});

// @route  GET /api/meetings/google/callback?code=...
// Google redirects here after the user grants access
exports.googleCallback = asyncHandler(async (req, res, next) => {
  const { code } = req.query;
  if (!code) return next(new ErrorResponse('Missing auth code', 400));

  const tokens = await calendarSvc.exchangeCode(code);

  // Store tokens on the user
  await User.findByIdAndUpdate(req.user._id, {
    googleCalendarTokens: tokens,
    googleCalendarConnected: true,
  });

  // Redirect back to meetings page in the dashboard
  res.redirect(`${process.env.CLIENT_URL}/meetings?google=connected`);
});

// @route  DELETE /api/meetings/google/disconnect
exports.disconnectGoogle = asyncHandler(async (req, res) => {
  await User.findByIdAndUpdate(req.user._id, {
    googleCalendarTokens:    null,
    googleCalendarConnected: false,
  });
  res.json({ success: true, message: 'Google Calendar disconnected' });
});

// ── Meetings CRUD ─────────────────────────────────────────────────────────────

// @route  GET /api/meetings
exports.getMeetings = asyncHandler(async (req, res) => {
  const { status, page = 1, limit = 20 } = req.query;
  const filter = { user: req.user._id };
  if (status) filter.status = status;

  const skip = (parseInt(page) - 1) * parseInt(limit);
  const [meetings, total] = await Promise.all([
    Meeting.find(filter)
      .populate('bot', 'name avatarEmoji')
      .sort({ startTime: -1 })
      .skip(skip)
      .limit(parseInt(limit)),
    Meeting.countDocuments(filter),
  ]);

  res.json({
    success: true,
    total,
    page:  parseInt(page),
    pages: Math.ceil(total / parseInt(limit)),
    meetings,
  });
});

// @route  GET /api/meetings/:id
exports.getMeeting = asyncHandler(async (req, res, next) => {
  const meeting = await Meeting.findOne({ _id: req.params.id, user: req.user._id })
    .populate('bot', 'name avatarEmoji');
  if (!meeting) return next(new ErrorResponse('Meeting not found', 404));
  res.json({ success: true, meeting });
});

// @route  POST /api/meetings
// Create a meeting (and optionally push to Google Calendar)
exports.createMeeting = asyncHandler(async (req, res, next) => {
  const {
    guestName, guestEmail, guestPhone,
    title, description,
    startTime, endTime, duration,
    timezone, botId, conversationId, notes,
  } = req.body;

  if (!guestName)  return next(new ErrorResponse('Guest name is required', 400));
  if (!guestEmail) return next(new ErrorResponse('Guest email is required', 400));
  if (!startTime)  return next(new ErrorResponse('Start time is required', 400));
  if (!endTime)    return next(new ErrorResponse('End time is required', 400));

  const meeting = await Meeting.create({
    user:         req.user._id,
    bot:          botId          || undefined,
    conversation: conversationId || undefined,
    guestName,
    guestEmail,
    guestPhone,
    title:    title    || `Meeting with ${guestName}`,
    description,
    startTime: new Date(startTime),
    endTime:   new Date(endTime),
    duration:  duration || 30,
    timezone:  timezone || req.user.timezone || 'UTC',
    notes,
  });

  // Push to Google Calendar if connected
  const user = await User.findById(req.user._id).select('+googleCalendarTokens');
  if (user.googleCalendarConnected && user.googleCalendarTokens) {
    try {
      const event = await calendarSvc.createEvent(user.googleCalendarTokens, {
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
      console.error('Google Calendar event creation failed:', err.message);
      // Don't fail the whole request — meeting is still saved locally
    }
  }

  res.status(201).json({ success: true, meeting });
});

// @route  PUT /api/meetings/:id
exports.updateMeeting = asyncHandler(async (req, res, next) => {
  const meeting = await Meeting.findOne({ _id: req.params.id, user: req.user._id });
  if (!meeting) return next(new ErrorResponse('Meeting not found', 404));

  const allowed = ['title', 'description', 'status', 'notes', 'guestPhone'];
  allowed.forEach(f => { if (req.body[f] !== undefined) meeting[f] = req.body[f]; });

  await meeting.save();
  res.json({ success: true, meeting });
});

// @route  DELETE /api/meetings/:id
exports.deleteMeeting = asyncHandler(async (req, res, next) => {
  const meeting = await Meeting.findOne({ _id: req.params.id, user: req.user._id });
  if (!meeting) return next(new ErrorResponse('Meeting not found', 404));

  // Remove from Google Calendar if linked
  if (meeting.googleEventId) {
    const user = await User.findById(req.user._id).select('+googleCalendarTokens');
    if (user?.googleCalendarTokens) {
      try {
        await calendarSvc.deleteEvent(user.googleCalendarTokens, meeting.googleEventId);
      } catch (err) {
        console.error('Google Calendar event deletion failed:', err.message);
      }
    }
  }

  await meeting.deleteOne();
  res.json({ success: true, message: 'Meeting deleted' });
});

// @route  GET /api/meetings/status
// Returns whether Google Calendar is connected
exports.getCalendarStatus = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select('googleCalendarConnected');
  res.json({ success: true, connected: !!user.googleCalendarConnected });
});
