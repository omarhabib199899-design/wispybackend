const express = require('express');
const router  = express.Router();
const { protect } = require('../middleware/auth');
const {
  getMeetings,
  getMeeting,
  createMeeting,
  updateMeeting,
  deleteMeeting,
  getGoogleAuthUrl,
  googleCallback,
  disconnectGoogle,
  getCalendarStatus,
} = require('../controllers/meetingController');

router.use(protect);

// Calendar status & OAuth
router.get('/google/auth-url',    getGoogleAuthUrl);
router.get('/google/callback',    googleCallback);
router.delete('/google/disconnect', disconnectGoogle);
router.get('/calendar-status',    getCalendarStatus);

// CRUD
router.route('/')
  .get(getMeetings)
  .post(createMeeting);

router.route('/:id')
  .get(getMeeting)
  .put(updateMeeting)
  .delete(deleteMeeting);

module.exports = router;
