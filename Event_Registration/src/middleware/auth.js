const jwt = require('jsonwebtoken');
const db = require('../db');
const config = require('../config');
const { HttpError } = require('../utils/errors');

const getUser = db.prepare('SELECT id, name, email, role FROM users WHERE id = ?');

/** Requires a valid "Authorization: Bearer <token>" header. Sets req.user. */
function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return next(new HttpError(401, 'Authentication required. Send "Authorization: Bearer <token>".'));
  }
  try {
    const payload = jwt.verify(token, config.JWT_SECRET);
    const user = getUser.get(payload.id);
    if (!user) return next(new HttpError(401, 'User no longer exists.'));
    req.user = user;
    next();
  } catch {
    next(new HttpError(401, 'Invalid or expired token.'));
  }
}

/** Use after authenticate. */
function requireOrganizer(req, res, next) {
  if (req.user.role !== 'organizer') {
    return next(new HttpError(403, 'Only event organizers can do this.'));
  }
  next();
}

module.exports = { authenticate, requireOrganizer };
