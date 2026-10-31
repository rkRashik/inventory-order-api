const pool = require("../config/db");

async function createProduct(data) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query(
      `INSERT INTO products (sku, name, description, unit_price)
       VALUES ($1, $2, $3, $4)
       RETURNING id, sku, name, description, unit_price, is_active`,
      [
        data.sku,
        data.name,
        data.description ?? null,
        data.unit_price
      ]
    );

    const product = result.rows[0];

    await client.query(
      "INSERT INTO inventory (product_id, quantity) VALUES ($1, 0)",
      [product.id]
    );

    await client.query("COMMIT");

    return { ...product, available_stock: 0 };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}


async function listProducts({ page, limit, search, isActive }) {
  const conditions = [];
  const params = [];

  if (search) {
    params.push(`%${search}%`);

    conditions.push(
      `(p.name ILIKE $${params.length} OR p.sku ILIKE $${params.length})`
    );
  }

  if (isActive !== undefined) {
    params.push(isActive);
    conditions.push(`p.is_active = $${params.length}`);
  }

  const where = conditions.length
    ? `WHERE ${conditions.join(" AND ")}`
    : "";

  const countResult = await pool.query(
    `SELECT COUNT(*) AS total FROM products p ${where}`,
    params
  );

  const total = Number(countResult.rows[0].total);
  const offset = (page - 1) * limit;

  const result = await pool.query(
    `SELECT p.id, p.sku, p.name, p.description,
            p.unit_price, p.is_active,
            COALESCE(i.quantity, 0) AS available_stock
     FROM products p
     LEFT JOIN inventory i ON i.product_id = p.id
     ${where}
     ORDER BY p.created_at DESC, p.id DESC
     LIMIT $${params.length + 1}
     OFFSET $${params.length + 2}`,
    [...params, limit, offset]
  );

  return {
    products: result.rows,
    pagination: {
      page,
      limit,
      total,
      total_pages: Math.ceil(total / limit)
    }
  };
}

module.exports = { createProduct, listProducts };