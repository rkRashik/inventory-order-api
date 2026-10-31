const jwt = require("jsonwebtoken");
const pool = require("../config/db");

async function authenticate(req, res, next) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({
      error: {
        code: "UNAUTHORIZED",
        message: "Authentication required"
      }
    });
  }

  const token = header.slice(7);

  let payload;

  try {
    payload = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ["HS256"]
    });
  } catch (error) {
    return res.status(401).json({
      error: {
        code: "INVALID_TOKEN",
        message: "Invalid or expired access token"
      }
    });
  }

  if (!/^[1-9]\d*$/.test(String(payload.sub))) {
    return res.status(401).json({
      error: {
        code: "INVALID_TOKEN",
        message: "Invalid access token"
      }
    });
  }

  try {
    const result = await pool.query(
      `SELECT id, name, email, role
       FROM users
       WHERE id = $1 AND is_active = TRUE`,
      [payload.sub]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        error: {
          code: "UNAUTHORIZED",
          message: "User account is unavailable"
        }
      });
    }

    req.user = result.rows[0];
    next();
  } catch (error) {
    next(error);
  }
}

module.exports = authenticate;