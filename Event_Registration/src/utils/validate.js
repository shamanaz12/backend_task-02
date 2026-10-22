const { HttpError } = require('./errors');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function requireString(value, field, { min = 1, max = 255 } = {}) {
  if (typeof value !== 'string') throw new HttpError(400, `${field} is required.`);
  const v = value.trim();
  if (v.length < min || v.length > max) {
    throw new HttpError(400, `${field} must be between ${min} and ${max} characters.`);
  }
  return v;
}

function optionalString(value, field, max = 1000) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new HttpError(400, `${field} must be text.`);
  const v = value.trim();
  if (v.length > max) throw new HttpError(400, `${field} must be at most ${max} characters.`);
  return v || null;
}

function requireEmail(value) {
  const v = requireString(value, 'email', { min: 5, max: 254 }).toLowerCase();
  if (!EMAIL_REGEX.test(v)) throw new HttpError(400, 'Please provide a valid email address.');
  return v;
}

function requireDate(value, field = 'eventDate') {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new HttpError(400, `${field} must be a valid date (e.g. 2026-12-31T18:00:00Z).`);
  }
  return new Date(value).toISOString();
}

function requireCapacity(value) {
  if (!Number.isInteger(value) || value < 1 || value > 100000) {
    throw new HttpError(400, 'capacity must be a whole number between 1 and 100000.');
  }
  return value;
}

function parseId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1) throw new HttpError(400, 'Invalid id.');
  return id;
}

function parsePaging(query) {
  let page = parseInt(query.page, 10);
  let limit = parseInt(query.limit, 10);
  if (!Number.isInteger(page) || page < 1) page = 1;
  if (!Number.isInteger(limit) || limit < 1) limit = 10;
  if (limit > 50) limit = 50;
  return { page, limit, offset: (page - 1) * limit };
}

/** Escapes % and _ so user text is matched literally inside a LIKE query (use with ESCAPE '\'). */
function likePattern(text) {
  return `%${String(text).replace(/[\\%_]/g, (c) => '\\' + c)}%`;
}

module.exports = {
  requireString,
  optionalString,
  requireEmail,
  requireDate,
  requireCapacity,
  parseId,
  parsePaging,
  likePattern,
};
