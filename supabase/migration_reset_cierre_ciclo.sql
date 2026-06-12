-- ============================================================
-- MIGRACIÓN: funciones de administración para reset y cierre de ciclo
-- ============================================================

-- Función auxiliar para verificar que el usuario sea ADMIN activo
CREATE OR REPLACE FUNCTION verificar_admin(p_usuario UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM usuarios WHERE id = p_usuario AND rol = 'ADMIN' AND activo = TRUE
  ) THEN
    RAISE EXCEPTION 'Solo un administrador activo puede ejecutar esta acción';
  END IF;
END $$;

-- Reset COMPLETO: borra catálogo y operaciones.
-- Preserva usuarios, configuración, canales_precio y tipos_cliente.
CREATE OR REPLACE FUNCTION reset_base_completa(p_usuario UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM verificar_admin(p_usuario);

  -- 1. Tablas transaccionales
  DELETE FROM pagos;
  DELETE FROM venta_detalles;
  DELETE FROM ventas;
  DELETE FROM consignacion_detalles;
  DELETE FROM consignaciones;
  DELETE FROM compra_detalles;
  DELETE FROM compras;
  DELETE FROM reserva_detalles;
  DELETE FROM reservas;
  DELETE FROM movimientos_stock;
  DELETE FROM bot_drafts;

  -- 2. Catálogo (precios se borran en cascada con productos, pero limpiamos explícito)
  DELETE FROM precios;
  DELETE FROM productos;

  -- 3. Ubicaciones no centrales primero (por FK restrict con clientes)
  DELETE FROM ubicaciones WHERE es_central = FALSE;
  DELETE FROM clientes;

  -- 4. Asegurar ubicación Central
  IF NOT EXISTS (SELECT 1 FROM ubicaciones WHERE es_central = TRUE) THEN
    INSERT INTO ubicaciones (nombre, es_central) VALUES ('Central', TRUE);
  END IF;
END $$;

-- Reset de OPERACIONES: deja el catálogo intacto para seguir operando.
CREATE OR REPLACE FUNCTION reset_operaciones(p_usuario UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM verificar_admin(p_usuario);

  DELETE FROM pagos;
  DELETE FROM venta_detalles;
  DELETE FROM ventas;
  DELETE FROM consignacion_detalles;
  DELETE FROM consignaciones;
  DELETE FROM compra_detalles;
  DELETE FROM compras;
  DELETE FROM reserva_detalles;
  DELETE FROM reservas;
  DELETE FROM movimientos_stock;
  DELETE FROM bot_drafts;

  -- El catálogo (productos, clientes, precios, ubicaciones) se preserva.
  -- El stock queda en 0 porque se calcula desde movimientos_stock.
END $$;
