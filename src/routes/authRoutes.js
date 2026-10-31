const express = require("express");
const { rateLimit } = require("express-rate-limit");
const { login } = require("../controllers/authController");

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({
      error: {
        code: "RATE_LIMITED",
        message: "Too many login attempts. Try again later."
      }
    });
  }
});

router.post("/login", loginLimiter, login);

module.exports = router;