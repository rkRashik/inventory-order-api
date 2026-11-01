# Inventory & Order Management API

A REST API built with **Node.js, Express, and PostgreSQL** for managing products, stock, and customer orders. This project was developed for a backend developer practical assessment.

The main focus is keeping stock correct when orders are created, retried, or cancelled. Order creation uses a database transaction, row locks, and an idempotency key to avoid partial updates, overselling, and duplicate orders.

## Tech stack

- Node.js 24 and Express 5
- PostgreSQL with the `pg` driver
- Zod for request validation
- bcryptjs for password hashing and JWT for authentication
- express-rate-limit for login protection
- Node.js test runner and Supertest for integration tests

## Getting started

You need **Node.js 24**, npm, and a local PostgreSQL server.

### 1. Install dependencies

```bash
npm install
```

### 2. Set up PostgreSQL

Create a database user and database with PostgreSQL administrator access. For example:

```sql
CREATE ROLE inventory_app WITH LOGIN PASSWORD 'choose_a_local_password';
CREATE DATABASE inventory_order_db OWNER inventory_app;
```

Run `CREATE DATABASE` separately, outside a transaction. If you already have a PostgreSQL user or database, you can reuse them as long as the user can connect and create objects in the database's `public` schema.

### 3. Configure environment variables

Copy the sample file:

```powershell
Copy-Item .env.example .env
```

On macOS or Linux, use `cp .env.example .env`.

Update `.env` with your own values:

```dotenv
DB_HOST=127.0.0.1
DB_PORT=5432
DB_NAME=inventory_order_db
DB_USER=inventory_app
DB_PASSWORD=your_local_password

JWT_SECRET=use_a_random_secret_of_at_least_32_characters

SEED_ADMIN_EMAIL=admin@example.test
SEED_ADMIN_PASSWORD=choose_a_password_with_at_least_12_characters
SEED_STAFF_EMAIL=staff@example.test
SEED_STAFF_PASSWORD=choose_another_password_with_at_least_12_characters
```

`PORT` is optional; the default is `3000`. Do not commit `.env` or `.env.test`.

### 4. Run migrations and seed users

```bash
npm run migrate
npm run seed
```

The migrations create the tables, constraints, and stock movement protection trigger. Applied files are recorded in `schema_migrations`, so running migrations again skips them.

The seed script creates one Admin and one Staff account. Existing accounts with the same email are skipped; seeding does not change their passwords.

### 5. Start the API

```bash
npm start
```

Base URL: `http://localhost:3000`

Health check: `GET /health`

## Authentication and roles

Log in with the credentials from `.env`:

**POST `/auth/login`**

```json
{
  "email": "admin@example.test",
  "password": "your_configured_password"
}
```

The response contains `accessToken`. Use it with protected routes:

```text
Authorization: Bearer <accessToken>
```

The token expires after one hour. No registration endpoint is provided; users are created by the seed script.

| Action | Admin | Staff |
| --- | --- | --- |
| View products and orders | Yes | Yes |
| Create, update, or deactivate products | Yes | No |
| Adjust stock and view stock history | Yes | Yes |
| Create and cancel orders | Yes | Yes |

## API endpoints

Except for login and the health check, all endpoints require a Bearer token.

| Method | Endpoint | Description |
| --- | --- | --- |
| GET | `/health` | Check API status |
| POST | `/auth/login` | Sign in |
| GET | `/users/me` | Current user |
| POST | `/products` | Create product (Admin) |
| GET | `/products` | List, search, filter products |
| GET | `/products/:id` | Product details |
| PATCH | `/products/:id` | Update product (Admin) |
| PATCH | `/products/:id/deactivate` | Deactivate product (Admin) |
| POST | `/inventory/adjustments` | Add or remove stock |
| GET | `/inventory/:productId/movements` | Stock movement history |
| POST | `/orders` | Create an order |
| GET | `/orders` | List, search, filter orders |
| GET | `/orders/:id` | Order details with items |
| POST | `/orders/:id/cancel` | Cancel a confirmed order |

### Create a product

**POST `/products`** (Admin)

```json
{
  "sku": "MSE-001",
  "name": "Wireless Mouse",
  "description": "Basic wireless mouse",
  "unit_price": "800.00"
}
```

Prices are sent as decimal strings and stored as PostgreSQL `NUMERIC(12,2)`. A new product starts with zero stock.

Product list example:

```text
GET /products?search=mouse&is_active=true&page=1&limit=10
```

Products are deactivated instead of deleted to keep their order history.

### Adjust stock

**POST `/inventory/adjustments`**

```json
{
  "product_id": 1,
  "type": "IN",
  "quantity": 10,
  "reason": "Initial stock receipt"
}
```

Use `OUT` to remove stock. The API rejects an adjustment if it would make stock negative. Each successful adjustment writes a stock movement with its actor, quantity, reason, and time.

History example: `GET /inventory/1/movements?page=1&limit=20`

### Create an order

**POST `/orders`**

Additional header:

```text
Idempotency-Key: order-example-001
```

Body:

```json
{
  "customer_name": "Test Customer",
  "items": [
    { "product_id": 1, "quantity": 2 }
  ]
}
```

An order can contain 1–50 different products. The API takes each product's current price and saves it in `order_items`, so later price changes do not affect old orders.

Expected behavior:

- First successful request: `201 Created`, `replayed: false`.
- Repeat the same body with the same key: `200 OK`, `replayed: true`; stock is not reduced again.
- Use the same key with different order details: `409 Conflict`.
- Try to order more than the available stock: `409 Conflict`; no partial order is saved.

Use a **new idempotency key for each new order**.

### List and cancel orders

```text
GET /orders?status=CONFIRMED&page=1&limit=20
GET /orders?search=Test&status=CANCELLED&page=1&limit=10
GET /orders?from_date=2026-11-01&to_date=2026-11-01
GET /orders/1
```

The `search` filter checks customer names and order numbers. Dates use `YYYY-MM-DD`.

To cancel an order:

```text
POST /orders/1/cancel
```

Only `CONFIRMED` orders can be cancelled. Cancellation restores the ordered quantities and writes `CANCELLATION` movements in the same transaction. A second cancellation returns `409 Conflict` and does not restore stock again.

### Common HTTP responses

| Status | Meaning |
| --- | --- |
| `200` / `201` | Request succeeded |
| `400` | Invalid input or missing idempotency key |
| `401` / `403` | Missing login or insufficient permission |
| `404` | Resource not found |
| `409` | Business conflict (for example, insufficient stock) |
| `429` | Too many login attempts |
| `500` | Unexpected server error; details are not returned to the client |

## Database migrations

SQL files are in `migrations/`:

- `001_initial_schema.sql` — users, products, and inventory
- `002_order_and_stock_tables.sql` — orders, order items, and stock movements
- `003_protect_stock_movements.sql` — rejects ordinary updates and deletes to stock movement records

For the reasoning behind the schema, transactions, and idempotency handling, see [DECISIONS.md](DECISIONS.md).

## Running tests

**Use a separate test database.** The tests insert records and temporarily add a database constraint to test rollback behavior.

1. Create a PostgreSQL database called `inventory_order_test_db` and give `inventory_app` permission to connect and create schema objects.
2. Create `.env.test` with the test connection values:

   ```dotenv
   NODE_ENV=test
   DB_HOST=127.0.0.1
   DB_PORT=5432
   DB_NAME=inventory_order_test_db
   DB_USER=inventory_app
   DB_PASSWORD=your_local_test_database_password
   JWT_SECRET=use_a_separate_random_test_secret_at_least_32_characters
   ```

3. Apply the test database migrations and run the tests:

   ```bash
   node --env-file=.env.test scripts/migrate.js
   npm test
   ```

The integration tests cover login and permissions, stock changes, order totals and price snapshots, idempotency, insufficient stock, transaction rollback after a forced database failure, concurrent orders, and cancellation. The latest local run reported **9 passing tests** (one parent test and eight subtests).

The test database is not cleaned automatically after each run. Random identifiers are used to keep repeated test runs separate.

## Scope and limitations

The API includes JSON request logging and logs important order and
inventory operations. Browser access is controlled through the
CORS_ALLOWED_ORIGINS environment variable, which is empty by default.

This is a local assessment project, not a deployed production service.
Testing covers the main business rules but not every possible failure
or high-load scenario.
