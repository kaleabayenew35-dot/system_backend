/**
 * Consistent response helpers used across all routes.
 *
 * Success:  { success: true,  data: {...} }   (or top-level key for lists)
 * Error:    { success: false, error: "message", code?: "MACHINE_CODE" }
 *
 * Routes that already return a specific shape (gameApiRoutes, /dama) are NOT
 * touched — those contracts are fixed. These helpers are for admin/user routes.
 */

const ok = (res, data = {}, status = 200) => res.status(status).json({ success: true, ...data });

const err = (res, message, status = 400, code = undefined) => {
  const body = { success: false, error: message };
  if (code) body.code = code;
  return res.status(status).json(body);
};

/** Parse limit/offset from query params. Returns null when not provided (unpaginated). */
const parsePagination = (query) => {
  const limit  = query.limit  !== undefined ? parseInt(query.limit,  10) : null;
  const offset = query.offset !== undefined ? parseInt(query.offset, 10) : 0;
  if (limit !== null && (isNaN(limit) || limit < 1 || limit > 1000)) return null;
  if (isNaN(offset) || offset < 0) return null;
  return { limit, offset };
};

module.exports = { ok, err, parsePagination };
