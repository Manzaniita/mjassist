-- ============================================================
-- MIGRACIÓN: canales de precio y tipos de cliente dinámicos
-- Ejecutar en Supabase > SQL Editor (en base ya existente)
-- ============================================================

-- 1. Tablas dinámicas
CREATE TABLE IF NOT EXISTS canales_precio (
  id SERIAL PRIMARY KEY,
  nombre TEXT NOT NULL UNIQUE,
  orden INT NOT NULL DEFAULT 0,
  activo BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS tipos_cliente (
  id SERIAL PRIMARY KEY,
  nombre TEXT NOT NULL UNIQUE,
  orden INT NOT NULL DEFAULT 0,
  activo BOOLEAN NOT NULL DEFAULT TRUE
);

-- 2. Sembrar valores actuales (idempotente)
INSERT INTO canales_precio (nombre, orden) VALUES
  ('MINORISTA', 1), ('REVENDEDOR', 2), ('MAYORISTA', 3)
ON CONFLICT (nombre) DO NOTHING;

INSERT INTO tipos_cliente (nombre, orden) VALUES
  ('FINAL', 1), ('REVENDEDOR', 2), ('MAYORISTA', 3)
ON CONFLICT (nombre) DO NOTHING;

-- 3. Cambiar columnas de enum a text
ALTER TABLE precios ALTER COLUMN canal TYPE TEXT;
ALTER TABLE ventas ALTER COLUMN canal TYPE TEXT;
ALTER TABLE clientes ALTER COLUMN tipo TYPE TEXT;

-- 4. Recrear funciones que usaban el enum canal_precio
DROP FUNCTION IF EXISTS fn_precio_vigente(UUID, canal_precio);
CREATE OR REPLACE FUNCTION fn_precio_vigente(p_producto UUID, p_canal TEXT)
RETURNS NUMERIC LANGUAGE SQL STABLE AS $$
  SELECT COALESCE(
    (SELECT precio_ars FROM v_precio_vigente WHERE producto_id = p_producto AND canal = p_canal),
    (SELECT precio_ars FROM v_precio_vigente WHERE producto_id = p_producto AND canal = 'MINORISTA'),
    0
  );
$$;

DROP FUNCTION IF EXISTS registrar_venta(UUID, UUID, canal_precio, estado_entrega, canal_origen, JSONB, NUMERIC, TEXT, TEXT);
CREATE OR REPLACE FUNCTION registrar_venta(
  p_cliente UUID,
  p_usuario UUID,
  p_canal TEXT,
  p_estado_entrega estado_entrega,
  p_canal_origen canal_origen,
  p_items JSONB,
  p_pago_inicial NUMERIC DEFAULT 0,
  p_medio_pago TEXT DEFAULT NULL,
  p_notas TEXT DEFAULT NULL
) RETURNS UUID LANGUAGE PLPGSQL SECURITY DEFINER SET SEARCH_PATH = PUBLIC AS $$
DECLARE
  v_venta UUID;
  v_total NUMERIC := 0;
  v_central UUID;
  it JSONB;
  v_precio NUMERIC;
  v_prod UUID;
  v_cant INT;
BEGIN
  SELECT id INTO v_central FROM ubicaciones WHERE es_central LIMIT 1;
  IF v_central IS NULL THEN RAISE EXCEPTION 'No existe ubicación Central'; END IF;

  INSERT INTO ventas (usuario_id, cliente_id, canal, estado_entrega, canal_origen, notas)
  VALUES (p_usuario, p_cliente, p_canal, p_estado_entrega, p_canal_origen, p_notas)
  RETURNING id INTO v_venta;

  FOR it IN SELECT * FROM JSONB_ARRAY_ELEMENTS(p_items) LOOP
    v_prod := (it->>'producto_id')::UUID;
    v_cant := (it->>'cantidad')::INT;
    v_precio := COALESCE((it->>'precio_unitario')::NUMERIC, fn_precio_vigente(v_prod, p_canal));

    INSERT INTO venta_detalles (venta_id, producto_id, cantidad, precio_unitario)
    VALUES (v_venta, v_prod, v_cant, v_precio);

    INSERT INTO movimientos_stock (producto_id, cantidad, origen_id, tipo, usuario_id, referencia)
    VALUES (v_prod, v_cant, v_central, 'VENTA', p_usuario, v_venta::TEXT);

    v_total := v_total + (v_precio * v_cant);
  END LOOP;

  UPDATE ventas SET total_ars = v_total WHERE id = v_venta;

  IF COALESCE(p_pago_inicial, 0) > 0 THEN
    INSERT INTO pagos (cliente_id, venta_id, monto, medio_pago, tipo, usuario_id, canal_origen)
    VALUES (p_cliente, v_venta, p_pago_inicial, COALESCE(p_medio_pago, 'Efectivo'),
            CASE WHEN p_pago_inicial >= v_total THEN 'PAGO'::tipo_pago ELSE 'SENA'::tipo_pago END,
            p_usuario, p_canal_origen);
  END IF;

  RETURN v_venta;
END $$;

-- 5. RLS para las nuevas tablas (solo si no existen ya las políticas)
ALTER TABLE canales_precio ENABLE ROW LEVEL SECURITY;
ALTER TABLE tipos_cliente ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'canales_precio' AND policyname = 'acceso_interno') THEN
    CREATE POLICY acceso_interno ON canales_precio FOR ALL TO anon, authenticated USING (TRUE) WITH CHECK (TRUE);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'tipos_cliente' AND policyname = 'acceso_interno') THEN
    CREATE POLICY acceso_interno ON tipos_cliente FOR ALL TO anon, authenticated USING (TRUE) WITH CHECK (TRUE);
  END IF;
END $$;
