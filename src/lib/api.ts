import { createClient } from '@supabase/supabase-js'

const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string) || ''
const supabaseKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || ''

if (!supabaseUrl || !supabaseKey) {
  console.error('[MJ Assist] Faltan VITE_SUPABASE_URL y/o VITE_SUPABASE_ANON_KEY en las variables de entorno de Vercel.')
}

export const supabase = createClient(supabaseUrl, supabaseKey)

// ---------- Tipos ----------
export interface Usuario { id: string; nombre: string; rol: string }
export interface CanalPrecio { id: number; nombre: string; orden: number; activo: boolean }
export interface TipoCliente { id: number; nombre: string; orden: number; activo: boolean }

export interface Cliente {
  id: string; nombre: string; alias: string | null; telefono: string | null
  instagram: string | null; tipo: string
  notas: string | null; activo: boolean
}
export interface SaldoCliente extends Cliente {
  total_ventas: number; total_pagos: number; saldo: number
}
export interface Producto {
  id: string; nombre: string; marca: string | null; sku: string | null
  stock_minimo: number; activo: boolean
}
export interface PrecioVigente { producto_id: string; canal: string; precio_ars: number }
export interface StockRow {
  ubicacion_id: string; ubicacion: string; es_central: boolean
  revendedor_id: string | null; producto_id: string; producto: string
  stock_minimo: number; cantidad: number
}
export interface Venta {
  id: string; fecha: string; usuario_id: string | null; cliente_id: string
  canal: string; estado_entrega: string; total_ars: number
  canal_origen: string; notas: string | null
  fecha_estimada?: string | null
  fecha_entrega?: string | null
  cancelada?: boolean
  clientes?: { nombre: string }
  usuarios?: { nombre: string } | null
  venta_detalles?: { cantidad: number; precio_unitario: number; productos: { nombre: string } }[]
  pagos?: { monto: number }[]
}
export interface Pago {
  id: string; fecha: string; cliente_id: string; venta_id: string | null
  monto: number; medio_pago: string; tipo: string
}

export interface ItemVenta { producto_id: string; cantidad: number; precio_unitario: number | null }

// ---------- Services ----------
export async function getUsuarios(): Promise<Usuario[]> {
  const { data, error } = await supabase.from('usuarios').select('id,nombre,rol').eq('activo', true).order('nombre')
  if (error) throw error
  return data
}

export async function getClientes(): Promise<SaldoCliente[]> {
  const { data, error } = await supabase.from('v_saldo_clientes').select('*').eq('activo', true).order('nombre')
  if (error) throw error
  return data
}

export async function crearCliente(c: Partial<Cliente>): Promise<Cliente> {
  const { data, error } = await supabase.from('clientes').insert(c).select()
  if (error) throw error
  if (!data || data.length === 0) throw new Error('No se pudo crear el cliente')
  return data[0]
}

export async function actualizarCliente(id: string, c: Partial<Cliente>): Promise<Cliente> {
  const payload: Partial<Cliente> = {}
  if (c.nombre !== undefined) payload.nombre = c.nombre
  if (c.alias !== undefined) payload.alias = c.alias
  if (c.telefono !== undefined) payload.telefono = c.telefono
  if (c.instagram !== undefined) payload.instagram = c.instagram
  if (c.tipo !== undefined) payload.tipo = c.tipo
  if (c.notas !== undefined) payload.notas = c.notas
  if (c.activo !== undefined) payload.activo = c.activo
  const { data, error } = await supabase.from('clientes').update(payload).eq('id', id).select()
  if (error) throw error
  if (!data || data.length === 0) throw new Error('No se pudo actualizar el cliente')
  return data[0]
}

export async function eliminarCliente(id: string): Promise<void> {
  const { error } = await supabase.from('clientes').update({ activo: false }).eq('id', id)
  if (error) throw error
}

export async function getProductos(): Promise<Producto[]> {
  const { data, error } = await supabase.from('productos').select('*').eq('activo', true).order('nombre')
  if (error) throw error
  return data
}

export async function crearProducto(nombre: string, marca?: string | null, sku?: string | null, stock_minimo = 3): Promise<Producto> {
  const { data, error } = await supabase.from('productos').insert({ nombre, marca: marca ?? null, sku: sku ?? null, stock_minimo }).select()
  if (error) throw error
  if (!data || data.length === 0) throw new Error('No se pudo crear el producto')
  return data[0]
}

export async function actualizarProducto(id: string, campos: Partial<Producto>): Promise<Producto> {
  const { data, error } = await supabase.from('productos').update(campos).eq('id', id).select()
  if (error) throw error
  if (!data || data.length === 0) throw new Error('No se pudo actualizar el producto')
  return data[0]
}

export async function eliminarProducto(id: string): Promise<void> {
  const { error } = await supabase.from('productos').update({ activo: false }).eq('id', id)
  if (error) throw error
}

export async function setPrecio(producto_id: string, canal: string, precio_ars: number): Promise<void> {
  const { error } = await supabase.from('precios').insert({ producto_id, canal, precio_ars })
  if (error) throw error
}

export async function getPreciosVigentes(): Promise<PrecioVigente[]> {
  const { data, error } = await supabase.from('v_precio_vigente').select('*')
  if (error) throw error
  return data
}

export async function getStock(): Promise<StockRow[]> {
  const { data, error } = await supabase.from('v_stock').select('*').order('producto')
  if (error) throw error
  return data
}

export async function getReservado(): Promise<Record<string, number>> {
  const { data, error } = await supabase.from('v_stock_reservado').select('*')
  if (error) throw error
  return Object.fromEntries((data ?? []).map((r: any) => [r.producto_id, r.reservado]))
}

export interface FiltroVentas {
  desde?: string; hasta?: string; cliente_id?: string; texto?: string
}
export async function getVentas(f: FiltroVentas = {}): Promise<Venta[]> {
  let q = supabase
    .from('ventas')
    .select('*, clientes(nombre), usuarios(nombre), venta_detalles(cantidad, precio_unitario, productos(nombre)), pagos(monto)')
    .order('fecha', { ascending: false })
    .limit(200)
  if (f.desde) q = q.gte('fecha', f.desde)
  if (f.hasta) q = q.lte('fecha', f.hasta + 'T23:59:59')
  if (f.cliente_id) q = q.eq('cliente_id', f.cliente_id)
  const { data, error } = await q
  if (error) throw error
  return data as unknown as Venta[]
}

export async function registrarVenta(params: {
  cliente_id: string; usuario_id: string; canal: string; estado_entrega: string
  items: ItemVenta[]; pago_inicial: number; medio_pago: string | null; notas?: string; fecha_estimada?: string | null
}): Promise<string> {
  const { data, error } = await supabase.rpc('registrar_venta', {
    p_cliente: params.cliente_id,
    p_usuario: params.usuario_id,
    p_canal: params.canal,
    p_estado_entrega: params.estado_entrega,
    p_canal_origen: 'PWA',
    p_items: params.items,
    p_pago_inicial: params.pago_inicial,
    p_medio_pago: params.medio_pago,
    p_notas: params.notas ?? null,
  })
  if (error) throw error
  // Guardar fecha estimada si aplica
  if (params.fecha_estimada && data) {
    await supabase.from('ventas').update({ fecha_estimada: params.fecha_estimada }).eq('id', data)
  }
  return data
}

export async function marcarEntregado(venta_id: string): Promise<void> {
  const { error } = await supabase.from('ventas').update({ estado_entrega: 'ENTREGADO', fecha_entrega: new Date().toISOString() }).eq('id', venta_id)
  if (error) throw error
}

export async function cancelarVenta(venta_id: string, usuario_id: string): Promise<void> {
  const { error } = await supabase.rpc('cancelar_venta', { p_venta: venta_id, p_usuario: usuario_id })
  if (error) throw error
}

export async function registrarPago(params: {
  cliente_id: string; monto: number; medio_pago: string; usuario_id: string
  tipo?: string; venta_id?: string | null; notas?: string
}): Promise<void> {
  const { error } = await supabase.from('pagos').insert({
    cliente_id: params.cliente_id,
    monto: params.monto,
    medio_pago: params.medio_pago,
    usuario_id: params.usuario_id,
    tipo: params.tipo ?? 'PAGO',
    venta_id: params.venta_id ?? null,
    canal_origen: 'PWA',
    notas: params.notas ?? null,
  })
  if (error) throw error
}

export async function getMovimientosCliente(cliente_id: string): Promise<{ ventas: Venta[]; pagos: Pago[] }> {
  const [v, p] = await Promise.all([
    supabase
      .from('ventas')
      .select('*, venta_detalles(cantidad, precio_unitario, productos(nombre))')
      .eq('cliente_id', cliente_id)
      .order('fecha', { ascending: false }),
    supabase.from('pagos').select('*').eq('cliente_id', cliente_id).order('fecha', { ascending: false }),
  ])
  if (v.error) throw v.error
  if (p.error) throw p.error
  return { ventas: v.data as unknown as Venta[], pagos: p.data as Pago[] }
}

export async function registrarConsignacion(params: {
  revendedor_id: string; usuario_id: string
  items: { producto_id: string; cantidad: number; precio_unitario: number | null }[]
  notas?: string
}): Promise<string> {
  const { data, error } = await supabase.rpc('registrar_consignacion', {
    p_revendedor: params.revendedor_id,
    p_usuario: params.usuario_id,
    p_canal_origen: 'PWA',
    p_items: params.items,
    p_notas: params.notas ?? null,
  })
  if (error) throw error
  return data
}

export async function registrarRendicion(params: {
  revendedor_id: string; usuario_id: string
  items: { producto_id: string; vendidas: number; devueltas: number }[]
  monto_pago: number; medio_pago: string | null; notas?: string
}): Promise<string> {
  const { data, error } = await supabase.rpc('registrar_rendicion', {
    p_revendedor: params.revendedor_id,
    p_usuario: params.usuario_id,
    p_canal_origen: 'PWA',
    p_items: params.items,
    p_monto_pago: params.monto_pago,
    p_medio_pago: params.medio_pago,
    p_notas: params.notas ?? null,
  })
  if (error) throw error
  return data
}

// Devuelve el precio congelado de la última consignación por producto para un revendedor
export async function getPreciosConsignacionRevendedor(revendedor_id: string): Promise<Record<string, number>> {
  const { data, error } = await supabase
    .from('consignaciones')
    .select('fecha, consignacion_detalles(producto_id, precio_unitario)')
    .eq('revendedor_id', revendedor_id)
    .order('fecha', { ascending: false })
    .limit(200)
  if (error) throw error
  const map: Record<string, number> = {}
  for (const row of (data ?? []) as any[]) {
    for (const d of row.consignacion_detalles ?? []) {
      if (!map[d.producto_id]) map[d.producto_id] = Number(d.precio_unitario)
    }
  }
  return map
}

export async function registrarAjuste(producto_id: string, cantidad: number, usuario_id: string, motivo: string) {
  const { error } = await supabase.rpc('registrar_ajuste', {
    p_producto: producto_id, p_cantidad: cantidad, p_usuario: usuario_id, p_motivo: motivo,
  })
  if (error) throw error
}

export async function getPagosRango(desde: string, hasta: string): Promise<Pago[]> {
  const { data, error } = await supabase
    .from('pagos').select('*')
    .gte('fecha', desde).lte('fecha', hasta + 'T23:59:59')
    .order('fecha', { ascending: false })
  if (error) throw error
  return data
}

export async function getSaldosPendientes(): Promise<{ total_saldo: number; clientes: SaldoCliente[] }> {
  const { data, error } = await supabase.from('v_saldo_clientes').select('*').eq('activo', true).gt('saldo', 0).order('saldo', { ascending: false })
  if (error) throw error
  const clientes = (data ?? []) as SaldoCliente[]
  const total_saldo = clientes.reduce((a, c) => a + Number(c.saldo), 0)
  return { total_saldo, clientes }
}

export async function getTemplateWhatsapp(): Promise<string> {
  const { data } = await supabase.from('configuracion').select('valor').eq('clave', 'whatsapp_template').single()
  return data?.valor ?? '🔥 *STOCK ACTUALIZADO MJ* 🔥\n\n{{lineas}}'
}
export async function setTemplateWhatsapp(valor: string) {
  await supabase.from('configuracion').upsert({ clave: 'whatsapp_template', valor })
}

// ---------- Canales y Tipos dinámicos ----------
export async function getCanalesPrecio(): Promise<CanalPrecio[]> {
  const { data, error } = await supabase.from('canales_precio').select('*').eq('activo', true).order('orden')
  if (error) throw error
  return data
}
export async function crearCanalPrecio(nombre: string, orden = 0): Promise<CanalPrecio> {
  const { data, error } = await supabase.from('canales_precio').insert({ nombre, orden }).select()
  if (error) throw error
  if (!data || data.length === 0) throw new Error('No se pudo crear el canal')
  return data[0]
}
export async function actualizarCanalPrecio(id: number, campos: Partial<CanalPrecio>): Promise<CanalPrecio> {
  const { data, error } = await supabase.from('canales_precio').update(campos).eq('id', id).select()
  if (error) throw error
  if (!data || data.length === 0) throw new Error('No se pudo actualizar el canal')
  return data[0]
}
export async function eliminarCanalPrecio(id: number): Promise<void> {
  const { error } = await supabase.from('canales_precio').update({ activo: false }).eq('id', id)
  if (error) throw error
}

export async function getTiposCliente(): Promise<TipoCliente[]> {
  const { data, error } = await supabase.from('tipos_cliente').select('*').eq('activo', true).order('orden')
  if (error) throw error
  return data
}
export async function crearTipoCliente(nombre: string, orden = 0): Promise<TipoCliente> {
  const { data, error } = await supabase.from('tipos_cliente').insert({ nombre, orden }).select()
  if (error) throw error
  if (!data || data.length === 0) throw new Error('No se pudo crear el tipo')
  return data[0]
}
export async function actualizarTipoCliente(id: number, campos: Partial<TipoCliente>): Promise<TipoCliente> {
  const { data, error } = await supabase.from('tipos_cliente').update(campos).eq('id', id).select()
  if (error) throw error
  if (!data || data.length === 0) throw new Error('No se pudo actualizar el tipo')
  return data[0]
}
export async function eliminarTipoCliente(id: number): Promise<void> {
  const { error } = await supabase.from('tipos_cliente').update({ activo: false }).eq('id', id)
  if (error) throw error
}

// ---------- Helpers ----------
export const fmtARS = (n: number) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n)

export const fmtFecha = (iso: string) =>
  new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

export const MEDIOS_PAGO = ['Efectivo', 'Transferencia Joaco', 'Transferencia Meli', 'USDT', 'Otro']
