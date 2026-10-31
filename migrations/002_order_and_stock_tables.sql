CREATE TABLE orders (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_number VARCHAR(40) NOT NULL UNIQUE,
    customer_name VARCHAR(150) NOT NULL,
    status VARCHAR(12) NOT NULL DEFAULT 'CONFIRMED'
        CHECK (status IN ('CONFIRMED', 'CANCELLED')),
    total_amount NUMERIC(12, 2) NOT NULL
        CHECK (total_amount >= 0),
    idempotency_key VARCHAR(255) NOT NULL UNIQUE,
    request_hash CHAR(64) NOT NULL,
    created_by BIGINT NOT NULL
        REFERENCES users(id) ON DELETE RESTRICT,
    cancelled_by BIGINT
        REFERENCES users(id) ON DELETE RESTRICT,
    cancelled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT valid_cancellation CHECK (
        (status = 'CONFIRMED'
            AND cancelled_by IS NULL
            AND cancelled_at IS NULL)
        OR
        (status = 'CANCELLED'
            AND cancelled_by IS NOT NULL
            AND cancelled_at IS NOT NULL)
    )
);

CREATE TABLE order_items (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_id BIGINT NOT NULL
        REFERENCES orders(id) ON DELETE RESTRICT,
    product_id BIGINT NOT NULL
        REFERENCES products(id) ON DELETE RESTRICT,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price NUMERIC(12, 2) NOT NULL
        CHECK (unit_price >= 0),
    line_total NUMERIC(12, 2) NOT NULL
        CHECK (line_total >= 0),
    UNIQUE (order_id, product_id),
    CONSTRAINT valid_line_total CHECK (
        line_total = quantity * unit_price
    )
);

CREATE TABLE stock_movements (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    product_id BIGINT NOT NULL
        REFERENCES products(id) ON DELETE RESTRICT,
    movement_type VARCHAR(20) NOT NULL
        CHECK (movement_type IN (
            'ADJUSTMENT_IN',
            'ADJUSTMENT_OUT',
            'ORDER',
            'CANCELLATION'
        )),
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    reference TEXT NOT NULL,
    created_by BIGINT NOT NULL
        REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_orders_status_created
    ON orders(status, created_at DESC);

CREATE INDEX idx_order_items_order
    ON order_items(order_id);

CREATE INDEX idx_movements_product_created
    ON stock_movements(product_id, created_at DESC);