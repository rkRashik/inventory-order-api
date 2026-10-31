const pool = require("../src/config/db");

async function checkDatabase() {
  try {
    const result = await pool.query(
      "SELECT current_database() AS database"
    );

    console.log(
      "Connected to database:",
      result.rows[0].database
    );
  } catch (error) {
    console.error("Database connection failed:", error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

checkDatabase();