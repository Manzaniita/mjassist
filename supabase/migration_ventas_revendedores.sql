-- ============================================================
-- MIGRACIÓN: Cancelación de ventas + mejoras en revendedores
-- ============================================================

-- 1. Agregar columna cancelada a ventas
alter table ventas add column if not exists cancelada boolean not null default false;

-- 2. Recrear vista v_saldo_clientes excluyendo ventas canceladas
create or replace view v_saldo_clientes as
select
  c.id, c.nombre, c.alias, c.telefono, c.instagram, c.tipo, c.activo,
  coalesce(v.total_ventas, 0) as total_ventas,
  coalesce(p.total_pagos, 0) as total_pagos,
  coalesce(v.total_ventas, 0) - coalesce(p.total_pagos, 0) as saldo
from clientes c
left join (
  select cliente_id, sum(total_ars) as total_ventas from ventas where cancelada = false group by cliente_id
) v on v.cliente_id = c.id
left join (
  select cliente_id, sum(monto) as total_pagos from pagos group by cliente_id
) p on p.cliente_id = c.id;

-- 3. Nueva función: cancelar venta (revierte stock a Central)
create or replace function cancelar_venta(
  p_venta uuid,
  p_usuario uuid
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_central uuid;
  it record;
begin
  select id into v_central from ubicaciones where es_central limit 1;
  if v_central is null then raise exception 'No existe ubicación Central'; end if;

  if (select cancelada from ventas where id = p_venta) then
    raise exception 'La venta ya está cancelada';
  end if;

  -- Marcar venta como cancelada
  update ventas set cancelada = true,
    notas = coalesce(notas || ' | ', '') || 'Venta cancelada el ' || now()::text
  where id = p_venta;

  -- Revertir stock: devolver cada producto a Central como ajuste
  for it in
    select producto_id, cantidad from venta_detalles where venta_id = p_venta
  loop
    insert into movimientos_stock (producto_id, cantidad, destino_id, tipo, usuario_id, referencia, notas)
    values (it.producto_id, it.cantidad, v_central, 'AJUSTE', p_usuario, p_venta::text, 'Reversa por cancelación de venta');
  end loop;
end $$;
