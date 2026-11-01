CREATE OR REPLACE FUNCTION prevent_stock_movement_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'Stock movement history is append-only';
END;
$$;

CREATE TRIGGER stock_movements_append_only
BEFORE UPDATE OR DELETE ON stock_movements
FOR EACH ROW
EXECUTE FUNCTION prevent_stock_movement_changes();