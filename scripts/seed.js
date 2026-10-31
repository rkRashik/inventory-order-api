const bcrypt = require("bcryptjs");
const pool = require("../src/config/db");

async function seedUsers() {
  const users = [
    {
      name: "Admin",
      email: process.env.SEED_ADMIN_EMAIL,
      password: process.env.SEED_ADMIN_PASSWORD,
      role: "ADMIN"
    },
    {
      name: "Staff",
      email: process.env.SEED_STAFF_EMAIL,
      password: process.env.SEED_STAFF_PASSWORD,
      role: "STAFF"
    }
  ];

  for (const user of users) {
    if (
      !user.email ||
      !user.password ||
      user.password.length < 12
    ) {
      throw new Error(
        "Seed emails and passwords must be configured. Passwords need at least 12 characters."
      );
    }

    user.email = user.email.trim().toLowerCase();
    user.passwordHash = await bcrypt.hash(user.password, 12);
  }

  if (users[0].email === users[1].email) {
    throw new Error("Admin and Staff emails must be different.");
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    for (const user of users) {
      const result = await client.query(
        `INSERT INTO users (name, email, password_hash, role)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (email) DO NOTHING`,
        [user.name, user.email, user.passwordHash, user.role]
      );

      console.log(
        result.rowCount === 1
          ? `Created ${user.role} user`
          : `Skipped existing ${user.role} user`
      );
    }

    await client.query("COMMIT");
    console.log("User seeding completed");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

seedUsers()
  .catch((error) => {
    console.error("Seeding failed:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });