# Technical Decisions

This file explains the main design choices for the Inventory & Order Management API and the assumptions made for the assessment.

## 1. Project structure

I used Node.js, Express, and PostgreSQL. The code is separated into routes, controllers, services, and database configuration:

- **Routes** define the API endpoints and their middleware.
- **Controllers** validate requests and return HTTP responses.
- **Services** handle database queries and business rules.
- **Migrations** create the tables and constraints.

I kept SQL queries in the services so it is easier to see where a transaction starts and ends.

## 2. Database design

The database has six main tables: `users`, `products`, `inventory`, `orders`, `order_items`, and `stock_movements`.

Important constraints include:

- Unique user emails and product SKUs.
- Nonnegative product prices and stock quantities.
- Positive order item and stock movement quantities.
- Unique idempotency keys and order numbers.
- Foreign keys connecting orders, products, and users.
- A check that each order item's `line_total` matches quantity × unit price.

A product is deactivated with `is_active` instead of being deleted, so existing order references are preserved. Stock movements have an append-only trigger (`003_protect_stock_movements.sql`) that rejects normal `UPDATE` and `DELETE` statements.

## 3. Order creation and transactions

An order needs several database changes: saving the order, saving its items, reducing stock, and recording stock movements. These changes must succeed together.

The order service uses one PostgreSQL connection for `BEGIN`, all required queries, and `COMMIT`. If a query fails, it runs `ROLLBACK`. This prevents an order from being saved with only part of its stock changes.

Before reducing stock, the service checks that each product is active and has enough stock. It also uses a conditional inventory update as an additional stock check.

## 4. Concurrent orders

Two requests may try to buy the last available unit at nearly the same time. If both simply read the available quantity without locking, they could both think the item is in stock.

For each product, I use `SELECT ... FOR UPDATE` to lock its product and inventory rows during order creation. Product IDs are processed in ascending order, which helps keep a consistent lock order for multi-item orders.

This protects stock correctness, although requests for a popular product may need to wait for each other.

## 5. Idempotency

Order creation requires an `Idempotency-Key` header. The service stores this key and a SHA-256 hash of the normalized request.

- A new key creates a new order.
- The same key and same details return the existing order without reducing stock again.
- The same key with different details returns `409 Conflict`.

A transaction-scoped advisory lock prevents simultaneous requests using the same key from creating two orders. There is also a unique constraint on the key in PostgreSQL.

In this implementation, keys are unique across all users and do not expire automatically.

## 6. Prices and order history

Product prices and order totals use PostgreSQL `NUMERIC(12,2)`. During calculation, the service converts decimal prices into integer cents using `BigInt` instead of calculating totals with floating-point numbers.

Each `order_items` row saves the unit price at the time of purchase. If the product price changes later, an existing order still shows its original price.

## 7. Cancellation and stock movements

Only a `CONFIRMED` order can be cancelled. The cancellation service locks the order row, checks its status, restores the quantities, writes `CANCELLATION` movements, and updates the order status in one transaction.

If the same order is cancelled again, the API returns `409 Conflict`. It does not increase stock a second time.

Stock adjustments also use a transaction and record who made the change. Both Admin and Staff can adjust stock or create/cancel orders, but product changes are restricted to Admin.

## 8. Authentication and validation

Passwords are stored as bcrypt hashes. Login issues a JWT that expires after one hour. Protected requests verify the token and check that the user is still active.

Zod validates request data, SQL queries use parameters for values, and login is rate-limited to 10 requests per 15 minutes. Unexpected errors are returned to clients as generic `500` responses. The JSON body limit is 100 KB.

HTTP requests and important order and inventory operations are logged
as JSON without recording passwords, access tokens, or request bodies.

CORS uses an explicit origin allowlist configured through
CORS_ALLOWED_ORIGINS. If no origins are configured, cross-origin
browser requests are not allowed.

## 9. Testing

I used Node.js's built-in test runner with Supertest and a separate PostgreSQL test database.

The tests check authentication and roles, stock updates, order creation, price snapshots, idempotent retries, insufficient stock, concurrent orders, and cancellation. One test also forces a database constraint failure during order creation and verifies that the order, stock changes, and movement records are rolled back.

The latest local test run passed all **9 reported tests** (including the parent test). These tests cover the main business rules, but they are not a complete load or security test suite.

## 10. Assumptions and limitations

- The assessment uses two order statuses: `CONFIRMED` and `CANCELLED`.
- Products can be deactivated but not permanently deleted through the API.
- Admin manages products; Admin and Staff can adjust stock and manage orders.
- All prices use one consistent currency; multi-currency handling is not included.
- Idempotency keys have no expiry or cleanup process.
- No payment processing, public registration, or password reset is included.
- The project is intended to run locally for review; production deployment is outside the current scope.
