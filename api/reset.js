// MJ Assist — Vercel Function para resetear base de datos
// Variables de entorno: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

function setCors(res) {
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    setCors(res)
    return res.status(204).end()
  }
  if (req.method !== 'POST') {
    setCors(res)
    return res.status(405).json({ error: 'Método no permitido' })
  }

  const { usuario_id, modo } = req.body || {}

  if (!usuario_id) {
    setCors(res)
    return res.status(400).json({ error: 'Falta usuario_id' })
  }
  if (!['completa', 'operaciones'].includes(modo)) {
    setCors(res)
    return res.status(400).json({ error: 'Modo inválido. Usá "completa" o "operaciones"' })
  }

  try {
    const rpc = modo === 'completa' ? 'reset_base_completa' : 'reset_operaciones'
    const { error } = await supabase.rpc(rpc, { p_usuario: usuario_id })
    if (error) throw error

    setCors(res)
    return res.status(200).json({ ok: true, modo })
  } catch (err) {
    console.error('[reset]', err)
    setCors(res)
    return res.status(500).json({ error: err.message || 'Error al resetear' })
  }
}
