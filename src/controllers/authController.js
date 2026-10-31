const { z } = require("zod");
const { authenticateUser } = require("../services/authService");

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(128)
}).strict();

async function login(req, res) {
  const parsed = loginSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid login request"
      }
    });
  }

  const { email, password } = parsed.data;

  const result = await authenticateUser(email, password);

  if (!result) {
    return res.status(401).json({
      error: {
        code: "INVALID_CREDENTIALS",
        message: "Invalid email or password"
      }
    });
  }

  return res.status(200).json(result);
}

module.exports = { login };