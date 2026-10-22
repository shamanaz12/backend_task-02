const express = require('express');
const db = require('../db');
const { HttpError } = require('../utils/errors');
const {
  requireString,
  optionalString,
  requireDate,
  requireCapacity,
  parseId,
  parsePaging,
  likePattern,
} = require('../utils/validate');
const { authenticate, requireOrganizer } = require('../middleware/auth');

const router = express.Router();

const EVENT_SELECT = `
  SELECT e.id, e.title, e.description, e.location,
         e.event_date  AS eventDate,
         e.capacity,
         e.created_by  AS organizerId,
         u.name        AS organizerName,
         e.created_at  AS createdAt,
         e.updated_at  AS updatedAt,
         (SELECT COUNT(*) FROM registrations r
           WHERE r.event_id = e.id AND r.status = 'confirmed') AS registeredCount
  FROM events e
  JOIN users u ON u.id = e.created_by`;

function withSeats(row) {
  return { ...row, seatsLeft: Math.max(row.capacity - row.registeredCount, 0) };
}

function getEventOr404(id) {
  const row = db.prepare(`${EVENT_SELECT} WHERE e.id = ?`).get(id);
  if (!row) throw new HttpError(404, 'Event not found.');
  return row;
}

function assertOwner(event, user) {
  if (event.organizerId !== user.id) {
    throw new HttpError(403, 'You can only manage events that you created.');
  }
}

// ---------------------------------------------------------------- list events
// GET /api/events?q=&upcoming=true&page=1&limit=10
router.get('/', (req, res, next) => {
  try {
    const { page, limit, offset } = parsePaging(req.query);
    const where = [];
    const params = [];

    if (typeof req.query.q === 'string' && req.query.q.trim()) {
      const p = likePattern(req.query.q.trim());
      where.push(
        "(e.title LIKE ? ESCAPE '\\' OR e.description LIKE ? ESCAPE '\\' OR e.location LIKE ? ESCAPE '\\')"
      );
      params.push(p, p, p);
    }
    if (req.query.upcoming === 'true') {
      where.push('e.event_date >= ?');
      params.push(new Date().toISOString());
    }
    const clause = where.length ? ` WHERE ${where.join(' AND ')}` : '';

    const total = db
      .prepare(`SELECT COUNT(*) AS n FROM events e${clause}`)
      .get(...params).n;
    const rows = db
      .prepare(`${EVENT_SELECT}${clause} ORDER BY e.event_date ASC, e.id ASC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset);

    res.json({ data: rows.map(withSeats), page, limit, total });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------- event details
router.get('/:id', (req, res, next) => {
  try {
    res.json(withSeats(getEventOr404(parseId(req.params.id))));
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------- create (organizer)
router.post('/', authenticate, requireOrganizer, (req, res, next) => {
  try {
    const b = req.body || {};
    const title = requireString(b.title, 'title', { min: 3, max: 150 });
    const description = optionalString(b.description, 'description', 5000) || '';
    const location = requireString(b.location, 'location', { min: 2, max: 200 });
    const eventDate = requireDate(b.eventDate);
    const capacity = requireCapacity(b.capacity);
    if (new Date(eventDate) <= new Date()) {
      throw new HttpError(400, 'eventDate must be in the future.');
    }

    const info = db
      .prepare(
        'INSERT INTO events (title, description, location, event_date, capacity, created_by) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(title, description, location, eventDate, capacity, req.user.id);

    res.status(201).json(withSeats(getEventOr404(Number(info.lastInsertRowid))));
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------- update (owner)
router.put('/:id', authenticate, requireOrganizer, (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const event = getEventOr404(id);
    assertOwner(event, req.user);

    const b = req.body || {};
    const title = b.title !== undefined ? requireString(b.title, 'title', { min: 3, max: 150 }) : event.title;
    const description =
      b.description !== undefined ? optionalString(b.description, 'description', 5000) || '' : event.description;
    const location =
      b.location !== undefined ? requireString(b.location, 'location', { min: 2, max: 200 }) : event.location;
    const eventDate = b.eventDate !== undefined ? requireDate(b.eventDate) : event.eventDate;
    const capacity = b.capacity !== undefined ? requireCapacity(b.capacity) : event.capacity;

    if (capacity < event.registeredCount) {
      throw new HttpError(
        400,
        `capacity cannot be lower than the number of confirmed registrations (${event.registeredCount}).`
      );
    }

    db.prepare(
      `UPDATE events SET title = ?, description = ?, location = ?, event_date = ?, capacity = ?,
         updated_at = datetime('now') WHERE id = ?`
    ).run(title, description, location, eventDate, capacity, id);

    res.json(withSeats(getEventOr404(id)));
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------- delete (owner)
router.delete('/:id', authenticate, requireOrganizer, (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    assertOwner(getEventOr404(id), req.user);
    db.prepare('DELETE FROM events WHERE id = ?').run(id); // registrations are removed by ON DELETE CASCADE
    res.json({ message: 'Event deleted.' });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------- register for an event
// POST /api/events/:id/register   body: { fullName?, phone?, notes? }
const registerTx = db.transaction((userId, eventId, data) => {
  const event = db.prepare('SELECT id, event_date, capacity FROM events WHERE id = ?').get(eventId);
  if (!event) throw new HttpError(404, 'Event not found.');
  if (new Date(event.event_date) <= new Date()) {
    throw new HttpError(400, 'Registration is closed: this event has already started or ended.');
  }

  const already = db
    .prepare("SELECT id FROM registrations WHERE user_id = ? AND event_id = ? AND status = 'confirmed'")
    .get(userId, eventId);
  if (already) throw new HttpError(409, 'You are already registered for this event.');

  const { n } = db
    .prepare("SELECT COUNT(*) AS n FROM registrations WHERE event_id = ? AND status = 'confirmed'")
    .get(eventId);
  if (n >= event.capacity) throw new HttpError(409, 'Sorry, this event is full.');

  const info = db
    .prepare('INSERT INTO registrations (user_id, event_id, full_name, phone, notes) VALUES (?, ?, ?, ?, ?)')
    .run(userId, eventId, data.fullName, data.phone, data.notes);
  return Number(info.lastInsertRowid);
});

router.post('/:id/register', authenticate, (req, res, next) => {
  try {
    const eventId = parseId(req.params.id);
    const b = req.body || {};
    const fullName =
      b.fullName !== undefined ? requireString(b.fullName, 'fullName', { min: 2, max: 100 }) : req.user.name;
    const phone = optionalString(b.phone, 'phone', 30);
    const notes = optionalString(b.notes, 'notes', 1000);

    const regId = registerTx(req.user.id, eventId, { fullName, phone, notes });
    const registration = db
      .prepare(
        `SELECT id, event_id AS eventId, user_id AS userId, full_name AS fullName, phone, notes,
                status, created_at AS createdAt FROM registrations WHERE id = ?`
      )
      .get(regId);
    res.status(201).json(registration);
  } catch (err) {
    if (err && typeof err.code === 'string' && err.code.startsWith('SQLITE_CONSTRAINT')) {
      return next(new HttpError(409, 'You are already registered for this event.'));
    }
    next(err);
  }
});

// ---------------------------------------------------------------- attendee list (owner organizer)
router.get('/:id/registrations', authenticate, requireOrganizer, (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    assertOwner(getEventOr404(id), req.user);
    const rows = db
      .prepare(
        `SELECT r.id, r.user_id AS userId, u.email, r.full_name AS fullName, r.phone, r.notes,
                r.status, r.created_at AS createdAt, r.cancelled_at AS cancelledAt
         FROM registrations r JOIN users u ON u.id = r.user_id
         WHERE r.event_id = ? ORDER BY r.created_at ASC, r.id ASC`
      )
      .all(id);
    res.json({ data: rows, total: rows.length });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
