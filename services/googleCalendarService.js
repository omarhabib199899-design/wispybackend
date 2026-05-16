const { google } = require('googleapis');

/**
 * Build an OAuth2 client from a user's stored tokens.
 * tokens = { access_token, refresh_token, expiry_date }
 */
const buildClient = (tokens) => {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI,
  );
  oauth2Client.setCredentials(tokens);
  return oauth2Client;
};

/**
 * Generate the Google OAuth consent URL.
 * The user visits this URL to grant calendar access.
 */
exports.getAuthUrl = () => {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI,
  );

  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/calendar'],
  });
};

/**
 * Exchange an auth code for access + refresh tokens.
 */
exports.exchangeCode = async (code) => {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI,
  );
  const { tokens } = await oauth2Client.getToken(code);
  return tokens;
};

/**
 * Create a Google Calendar event.
 * Returns { eventId, meetLink, htmlLink }
 */
exports.createEvent = async (tokens, { title, description, startTime, endTime, guestEmail, guestName, timezone }) => {
  const auth     = buildClient(tokens);
  const calendar = google.calendar({ version: 'v3', auth });

  const event = {
    summary:     title || 'Meeting via Wispy',
    description: description || '',
    start: {
      dateTime: new Date(startTime).toISOString(),
      timeZone: timezone || 'UTC',
    },
    end: {
      dateTime: new Date(endTime).toISOString(),
      timeZone: timezone || 'UTC',
    },
    attendees: [
      { email: guestEmail, displayName: guestName },
    ],
    conferenceData: {
      createRequest: {
        requestId:             `wispy-${Date.now()}`,
        conferenceSolutionKey: { type: 'hangoutsMeet' },
      },
    },
    reminders: {
      useDefault: false,
      overrides:  [
        { method: 'email',  minutes: 60 },
        { method: 'popup',  minutes: 15 },
      ],
    },
  };

  const response = await calendar.events.insert({
    calendarId:                'primary',
    resource:                  event,
    conferenceDataVersion:     1,
    sendUpdates:               'all', // sends email invites to attendees
  });

  return {
    eventId:   response.data.id,
    meetLink:  response.data.conferenceData?.entryPoints?.[0]?.uri || null,
    htmlLink:  response.data.htmlLink,
  };
};

/**
 * Delete a Google Calendar event.
 */
exports.deleteEvent = async (tokens, eventId) => {
  const auth     = buildClient(tokens);
  const calendar = google.calendar({ version: 'v3', auth });

  await calendar.events.delete({
    calendarId: 'primary',
    eventId,
    sendUpdates: 'all',
  });
};

/**
 * List upcoming events (for checking availability).
 */
exports.listEvents = async (tokens, { timeMin, timeMax }) => {
  const auth     = buildClient(tokens);
  const calendar = google.calendar({ version: 'v3', auth });

  const response = await calendar.events.list({
    calendarId:   'primary',
    timeMin:      new Date(timeMin).toISOString(),
    timeMax:      new Date(timeMax).toISOString(),
    singleEvents: true,
    orderBy:      'startTime',
  });

  return response.data.items || [];
};
