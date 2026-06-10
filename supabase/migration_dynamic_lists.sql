-- ============================================================
-- MIGRACIÓN COMPLETA: canales de precio y tipos de cliente dinámicos
-- Orden: tablas catálogo → eliminar vistas/funciones → alter columnas → recrear funciones/vistas → RLS
-- ============================================================

-- 0. Tablas catálogo (idempotente)
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

INSERT INTO canales_precio (nombre, orden) VALUES
  ('MINORISTA', 1), ('REVENDEDOR', 2), ('MAYORISTA', 3)
ON CONFLICT (nombre) DO NOTHING;

INSERT INTO tipos_cliente (nombre, orden) VALUES
  ('FINAL', 1), ('REVENDEDOR', 2), ('MAYORISTA', 3)
ON CONFLICT (nombre) DO NOTHING;

-- 1. Eliminar vistas que dependen de las columnas enum
DROP VIEW IF EXISTS v_precio_vigente;
DROP VIEW IF EXISTS v_saldo_clientes;

-- 2. Eliminar funciones que usan el enum canal_precio (en orden para no romper dependencias de tipos)
DROP FUNCTION IF EXISTS registrar_venta(UUID, UUID, canal_precio, estado_entrega, canal_origen, JSONB, NUMERIC, TEXT, TEXT);
DROP FUNCTION IF EXISTS registrar_consignacion(UUID, UUID, canal_origen, JSONB, TEXT);
DROP FUNCTION IF EXISTS registrar_rendicion(UUID, UUID, canal_origen, JSONB, NUMERIC, TEXT, TEXT);
DROP FUNCTION IF EXISTS registrar_ajuste(UUID, INT, UUID, TEXT);
DROP FUNCTION IF EXISTS registrar_compra(TEXT, NUMERIC, UUID, JSONB, TEXT);
DROP FUNCTION IF EXISTS fn_ubicacion_revendedor(UUID);
DROP FUNCTION IF EXISTS fn_precio_vigente(UUID, canal_precio);

-- 3. Cambiar columnas de enum a text
ALTER TABLE precios ALTER COLUMN canal TYPE TEXT;
ALTER TABLE ventas ALTER COLUMN canal TYPE TEXT;
ALTER TABLE clientes ALTER COLUMN tipo TYPE TEXT;

-- 4. Recrear funciones con TEXT en lugar de canal_precio
CREATE OR REPLACE FUNCTION fn_precio_vigente(p_producto UUID, p_canal TEXT)
RETURNS NUMERIC LANGUAGE SQL STABLE AS $$
  SELECT COALESCE(
    (SELECT precio_ars FROM v_precio_vigente WHERE producto_id = p_producto AND canal = p_canal),
    (SELECT precio_ars FROM v_precio_vigente WHERE producto_id = p_producto AND canal = 'MINORISTA'),
    0
  );
$$;

CREATE OR REPLACE FUNCTION fn_ubicacion_revendedor(p_cliente UUID)
RETURNS UUID LANGUAGE PLPGSQL AS $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM ubicaciones WHERE cliente_id = p_cliente;
  IF v_id IS NULL THEN
    INSERT INTO ubicaciones (nombre, cliente_id, es_central)
    SELECT 'Stock ' || nombre, id, false FROM clientes WHERE id = p_cliente
    RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END $$;

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

CREATE OR REPLACE FUNCTION registrar_consignacion(
  p_revendedor UUID,
  p_usuario UUID,
  p_canal_origen canal_origen,
  p_items JSONB,
  p_notas TEXT DEFAULT NULL
) RETURNS UUID LANGUAGE PLPGSQL SECURITY DEFINER SET SEARCH_PATH = PUBLIC AS $$
DECLARE
  v_consig UUID;
  v_central UUID;
  v_ubic UUID;
  it JSONB;
  v_precio NUMERIC;
  v_prod UUID;
  v_cant INT;
BEGIN
  SELECT id INTO v_central FROM ubicaciones WHERE es_central LIMIT 1;
  v_ubic := fn_ubicacion_revendedor(p_revendedor);

  INSERT INTO consignaciones (revendedor_id, usuario_id, canal_origen, notas)
  VALUES (p_revendedor, p_usuario, p_canal_origen, p_notas)
  RETURNING id INTO v_consig;

  FOR it IN SELECT * FROM JSONB_ARRAY_ELEMENTS(p_items) LOOP
    v_prod := (it->>'producto_id')::UUID;
    v_cant := (it->>'cantidad')::INT;
    v_precio := COALESCE((it->>'precio_unitario')::NUMERIC, fn_precio_vigente(v_prod, 'REVENDEDOR'));

    INSERT INTO consignacion_detalles (consignacion_id, producto_id, cantidad, precio_unitario)
    VALUES (v_consig, v_prod, v_cant, v_precio);

    INSERT INTO movimientos_stock (producto_id, cantidad, origen_id, destino_id, tipo, usuario_id, referencia)
    VALUES (v_prod, v_cant, v_central, v_ubic, 'TRASLADO_CONSIGNACION', p_usuario, v_consig::TEXT);
  END LOOP;

  RETURN v_consig;
END $$;

CREATE OR REPLACE FUNCTION registrar_rendicion(
  p_revendedor UUID,
  p_usuario UUID,
  p_canal_origen canal_origen,
  p_items JSONB,
  p_monto_pago NUMERIC DEFAULT 0,
  p_medio_pago TEXT DEFAULT NULL,
  p_notas TEXT DEFAULT NULL
) RETURNS UUID LANGUAGE PLPGSQL SECURITY DEFINER SET SEARCH_PATH = PUBLIC AS $$
DECLARE
  v_venta UUID;
  v_total NUMERIC := 0;
  v_central UUID;
  v_ubic UUID;
  it JSONB;
  v_prod UUID;
  v_vend INT;
  v_dev INT;
  v_precio NUMERIC;
  v_hay_vendidas BOOLEAN := false;
BEGIN
  SELECT id INTO v_central FROM ubicaciones WHERE es_central LIMIT 1;
  v_ubic := fn_ubicacion_revendedor(p_revendedor);

  FOR it IN SELECT * FROM JSONB_ARRAY_ELEMENTS(p_items) LOOP
    IF COALESCE((it->>'vendidas')::INT, 0) > 0 THEN v_hay_vendidas := true; END IF;
  END LOOP;

  IF v_hay_vendidas THEN
    INSERT INTO ventas (usuario_id, cliente_id, canal, estado_entrega, canal_origen, notas)
    VALUES (p_usuario, p_revendedor, 'REVENDEDOR', 'ENTREGADO', p_canal_origen,
            COALESCE(p_notas, 'Rendición de consignación'))
    RETURNING id INTO v_venta;
  END IF;

  FOR it IN SELECT * FROM JSONB_ARRAY_ELEMENTS(p_items) LOOP
    v_prod := (it->>'producto_id')::UUID;
    v_vend := COALESCE((it->>'vendidas')::INT, 0);
    v_dev  := COALESCE((it->>'devueltas')::INT, 0);

    IF v_vend > 0 THEN
      SELECT cd.precio_unitario INTO v_precio
      FROM consignacion_detalles cd
      JOIN consignaciones c ON c.id = cd.consignacion_id
      WHERE c.revendedor_id = p_revendedor AND cd.producto_id = v_prod
      ORDER BY c.fecha DESC LIMIT 1;
      v_precio := COALESCE(v_precio, fn_precio_vigente(v_prod, 'REVENDEDOR'));

      INSERT INTO venta_detalles (venta_id, producto_id, cantidad, precio_unitario)
      VALUES (v_venta, v_prod, v_vend, v_precio);

      INSERT INTO movimientos_stock (producto_id, cantidad, origen_id, tipo, usuario_id, referencia)
      VALUES (v_prod, v_vend, v_ubic, 'VENTA', p_usuario, v_venta::TEXT);

      v_total := v_total + (v_precio * v_vend);
    END IF;

    IF v_dev > 0 THEN
      INSERT INTO movimientos_stock (producto_id, cantidad, origen_id, destino_id, tipo, usuario_id, notas)
      VALUES (v_prod, v_dev, v_ubic, v_central, 'DEVOLUCION_CONSIGNACION', p_usuario, p_notas);
    END IF;
  END LOOP;

  IF v_hay_vendidas THEN
    UPDATE ventas SET total_ars = v_total WHERE id = v_venta;
  END IF;

  IF COALESCE(p_monto_pago, 0) > 0 THEN
    INSERT INTO pagos (cliente_id, venta_id, monto, medio_pago, tipo, usuario_id, canal_origen)
    VALUES (p_revendedor, v_venta, p_monto_pago, COALESCE(p_medio_pago, 'Efectivo'),
            'RENDICION_REVENDEDOR', p_usuario, p_canal_origen);
  END IF;

  RETURN COALESCE(v_venta, gen_random_uuid());
END $$;

CREATE OR REPLACE FUNCTION registrar_ajuste(
  p_producto UUID,
  p_cantidad INT,
  p_usuario UUID,
  p_motivo TEXT
) RETURNS VOID LANGUAGE PLPGSQL SECURITY DEFINER SET SEARCH_PATH = PUBLIC AS $$
DECLARE v_central UUID;
BEGIN
  SELECT id INTO v_central FROM ubicaciones WHERE es_central LIMIT 1;
  IF p_cantidad > 0 THEN
    INSERT INTO movimientos_stock (producto_id, cantidad, destino_id, tipo, usuario_id, notas)
    VALUES (p_producto, p_cantidad, v_central, 'AJUSTE', p_usuario, p_motivo);
  ELSIF p_cantidad < 0 THEN
    INSERT INTO movimientos_stock (producto_id, cantidad, origen_id, tipo, usuario_id, notas)
    VALUES (p_producto, ABS(p_cantidad), v_central, 'AJUSTE', p_usuario, p_motivo);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION registrar_compra(
  p_proveedor TEXT,
  p_tipo_cambio NUMERIC,
  p_usuario UUID,
  p_items JSONB,
  p_notas TEXT DEFAULT NULL
) RETURNS UUID LANGUAGE PLPGSQL SECURITY DEFINER SET SEARCH_PATH = PUBLIC AS $$
DECLARE
  v_compra UUID;
  v_central UUID;
  it JSONB;
  v_total_usd NUMERIC := 0;
BEGIN
  SELECT id INTO v_central FROM ubicaciones WHERE es_central LIMIT 1;

  INSERT INTO compras (proveedor, tipo_cambio, usuario_id, notas)
  VALUES (p_proveedor, p_tipo_cambio, p_usuario, p_notas)
  RETURNING id INTO v_compra;

  FOR it IN SELECT * FROM JSONB_ARRAY_ELEMENTS(p_items) LOOP
    INSERT INTO compra_detalles (compra_id, producto_id, cantidad, costo_unitario_usd)
    VALUES (v_compra, (it->>'producto_id')::UUID, (it->>'cantidad')::INT,
            COALESCE((it->>'costo_unitario_usd')::NUMERIC, 0));

    INSERT INTO movimientos_stock (producto_id, cantidad, destino_id, tipo, usuario_id, referencia)
    VALUES ((it->>'producto_id')::UUID, (it->>'cantidad')::INT, v_central, 'COMPRA', p_usuario, v_compra::TEXT);

    v_total_usd := v_total_usd + COALESCE((it->>'costo_unitario_usd')::NUMERIC, 0) * (it->>'cantidad')::INT;
  END LOOP;

  UPDATE compras SET total_usd = v_total_usd, total_ars = v_total_usd * p_tipo_cambio
  WHERE id = v_compra;

  RETURN v_compra;
END $$;

-- 5. Recrear vistas
CREATE OR REPLACE VIEW v_precio_vigente AS
SELECT DISTINCT ON (producto_id, canal)
  producto_id, canal, precio_ars, vigente_desde
FROM precios
WHERE vigente_desde <= NOW()
ORDER BY producto_id, canal, vigente_desde DESC;

CREATE OR REPLACE VIEW v_saldo_clientes AS
SELECT
  c.id, c.nombre, c.alias, c.telefono, c.instagram, c.tipo, c.activo,
  COALESCE(v.total_ventas, 0) AS total_ventas,
  COALESCE(p.total_pagos, 0) AS total_pagos,
  COALESCE(v.total_ventas, 0) - COALESCE(p.total_pagos, 0) AS saldo
FROM clientes c
LEFT JOIN (
  SELECT cliente_id, SUM(total_ars) AS total_ventas FROM ventas GROUP BY cliente_id
) v ON v.cliente_id = c.id
LEFT JOIN (
  SELECT cliente_id, SUM(monto) AS total_pagos FROM pagos GROUP BY cliente_id
) p ON p.cliente_id = c.id;

-- 6. RLS para las nuevas tablas
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
