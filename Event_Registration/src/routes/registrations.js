const express = require('express');
const db = require('../db');
const { HttpError } = require('../utils/errors');
const { parseId } = require('../utils/validate');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

const REG_SELECT = `
  SELECT r.id, r.event_id AS eventId, r.full_name AS fullName, r.phone, r.notes, r.status,
         r.created_at AS createdAt, r.cancelled_at AS cancelledAt,
         e.title AS eventTitle, e.location AS eventLocation, e.event_date AS eventDate
  FROM registrations r JOIN events e ON e.id = r.event_id`;

// GET /api/registrations/my?status=confirmed|cancelled
router.get('/my', (req, res, next) => {
  try {
    const { status } = req.query;
    if (status !== undefined && !['confirmed', 'cancelled'].includes(status)) {
      throw new HttpError(400, 'status must be "confirmed" or "cancelled".');
    }
    const rows = status
      ? db.prepare(`${REG_SELECT} WHERE r.user_id = ? AND r.status = ? ORDER BY e.event_date ASC`).all(req.user.id, status)
      : db.prepare(`${REG_SELECT} WHERE r.user_id = ? ORDER BY e.event_date ASC, r.id ASC`).all(req.user.id);
    res.json({ data: rows, total: rows.length });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/registrations/:id  -> cancel my registration
router.delete('/:id', (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const reg = db
      .prepare('SELECT r.*, e.event_date FROM registrations r JOIN events e ON e.id = r.event_id WHERE r.id = ?')
      .get(id);
    if (!reg) throw new HttpError(404, 'Registration not found.');
    if (reg.user_id !== req.user.id) throw new HttpError(403, 'You can only cancel your own registrations.');
    if (reg.status === 'cancelled') throw new HttpError(409, 'This registration is already cancelled.');
    if (new Date(reg.event_date) <= new Date()) {
      throw new HttpError(400, 'You cannot cancel after the event has started.');
    }

    db.prepare("UPDATE registrations SET status = 'cancelled', cancelled_at = datetime('now') WHERE id = ?").run(id);
    res.json(db.prepare(`${REG_SELECT} WHERE r.id = ?`).get(id));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
