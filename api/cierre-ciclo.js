// MJ Assist — Vercel Function para cierre de ciclo
// Exporta TODO a Excel y luego limpia las operaciones.
// Variables de entorno: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from '@supabase/supabase-js'
import * as XLSX from 'xlsx'

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

function setJsonCors(res) {
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

async function fetchAll(table) {
  const { data, error } = await supabase.from(table).select('*').order('fecha', { ascending: false })
  if (error) throw error
  return data || []
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    setJsonCors(res)
    return res.status(204).end()
  }
  if (req.method !== 'POST') {
    setJsonCors(res)
    return res.status(405).json({ error: 'Método no permitido' })
  }

  const { usuario_id } = req.body || {}
  if (!usuario_id) {
    setJsonCors(res)
    return res.status(400).json({ error: 'Falta usuario_id' })
  }

  try {
    // Verificar admin
    const { data: usuario, error: userErr } = await supabase
      .from('usuarios')
      .select('id, nombre, rol, activo')
      .eq('id', usuario_id)
      .single()
    if (userErr) throw userErr
    if (!usuario || usuario.rol !== 'ADMIN' || !usuario.activo) {
      setJsonCors(res)
      return res.status(403).json({ error: 'Solo administradores activos pueden cerrar ciclo' })
    }

    // Leer datos
    const [
      ventas, ventaDetalles, pagos, clientes, productos, stock,
      consignaciones, consignacionDetalles, compras, compraDetalles,
      reservas, reservaDetalles, movimientos, canales, tipos, usuarios
    ] = await Promise.all([
      fetchAll('ventas'),
      fetchAll('venta_detalles'),
      fetchAll('pagos'),
      supabase.from('v_saldo_clientes').select('*').then(r => r.data || []),
      fetchAll('productos'),
      supabase.from('v_stock').select('*').then(r => r.data || []),
      fetchAll('consignaciones'),
      fetchAll('consignacion_detalles'),
      fetchAll('compras'),
      fetchAll('compra_detalles'),
      fetchAll('reservas'),
      fetchAll('reserva_detalles'),
      fetchAll('movimientos_stock'),
      fetchAll('canales_precio'),
      fetchAll('tipos_cliente'),
      fetchAll('usuarios'),
    ])

    const fechaCierre = new Date().toISOString()
    const resumen = [{
      fecha_cierre: fechaCierre,
      administrador: usuario.nombre,
      total_ventas: ventas.length,
      total_pagos: pagos.length,
      total_clientes: clientes.length,
      total_productos: productos.length,
      total_consignaciones: consignaciones.length,
      total_compras: compras.length,
      total_reservas: reservas.length,
      total_movimientos: movimientos.length,
    }]

    const sheets = [
      { data: resumen, name: 'Resumen' },
      { data: ventas, name: 'Ventas' },
      { data: ventaDetalles, name: 'Venta Detalles' },
      { data: pagos, name: 'Pagos' },
      { data: clientes, name: 'Clientes' },
      { data: productos, name: 'Productos' },
      { data: stock, name: 'Stock' },
      { data: consignaciones, name: 'Consignaciones' },
      { data: consignacionDetalles, name: 'Consignacion Detalles' },
      { data: compras, name: 'Compras' },
      { data: compraDetalles, name: 'Compra Detalles' },
      { data: reservas, name: 'Reservas' },
      { data: reservaDetalles, name: 'Reserva Detalles' },
      { data: movimientos, name: 'Movimientos Stock' },
      { data: canales, name: 'Canales Precio' },
      { data: tipos, name: 'Tipos Cliente' },
      { data: usuarios, name: 'Usuarios' },
    ]

    const wb = XLSX.utils.book_new()
    sheets.forEach(({ data, name }) => {
      if (data.length === 0) return
      const ws = XLSX.utils.json_to_sheet(data)
      const cols = Object.keys(data[0] || {}).map(() => ({ wch: 18 }))
      ws['!cols'] = cols
      XLSX.utils.book_append_sheet(wb, ws, name)
    })

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })

    // Limpiar operaciones (preserva catálogo)
    const { error: resetError } = await supabase.rpc('reset_operaciones', { p_usuario: usuario_id })
    if (resetError) throw resetError

    const filename = `cierre-ciclo-${fechaCierre.slice(0, 10)}.xlsx`
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    res.setHeader('Access-Control-Allow-Origin', '*')
    return res.status(200).send(buffer)
  } catch (err) {
    console.error('[cierre-ciclo]', err)
    setJsonCors(res)
    return res.status(500).json({ error: err.message || 'Error al cerrar ciclo' })
  }
}
