// MJ Assist — Webhook de Telegram (Vercel Function)
// Flujo: mensaje (texto o audio) -> transcripción Whisper -> parseo LLM a JSON
//        -> draft con botones Confirmar/Cancelar -> grabado en Supabase vía RPC.
// Variables de entorno (Vercel): TELEGRAM_BOT_TOKEN, GROQ_API_KEY,
//                                SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Creado por mjimportaciones

import { createClient } from '@supabase/supabase-js'

const TG = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`
const GROQ_KEY = process.env.GROQ_API_KEY

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

// ---------- Telegram helpers ----------
async function tg(method, body) {
  const r = await fetch(`${TG}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return r.json()
}
const enviar = (chat_id, text, extra = {}) =>
  tg('sendMessage', { chat_id, text, parse_mode: 'Markdown', ...extra })

// ---------- Groq ----------
async function transcribir(fileId) {
  const info = await tg('getFile', { file_id: fileId })
  const url = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${info.result.file_path}`
  const audio = await fetch(url).then((r) => r.arrayBuffer())

  const form = new FormData()
  form.append('file', new Blob([audio]), 'audio.ogg')
  form.append('model', 'whisper-large-v3')
  form.append('language', 'es')

  const r = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${GROQ_KEY}` },
    body: form,
  })
  const j = await r.json()
  return j.text ?? ''
}

async function parsear(texto, contexto) {
  const system = `Sos el asistente de carga de MJ Importaciones (venta de vapers, Argentina).
Convertí el mensaje del operador a JSON. Respondé SOLO el JSON, sin markdown ni texto extra.

Esquema:
{"operacion":"venta"|"pago"|"desconocido",
 "cliente":"nombre tal como lo dijo",
 "items":[{"producto":"nombre aproximado","cantidad":1,"precio_unitario":24000|null}],
 "pago_inicial":0,
 "medio_pago":"Efectivo"|"Transferencia Joaco"|"Transferencia Meli"|null,
 "estado_entrega":"ENTREGADO"|"PUNTO_ENCUENTRO"|"ENVIO",
 "monto":0,
 "notas":null}

Reglas:
- "vendí / le di / se llevó" => operacion "venta". "me pagó / me transfirió / saldó" sin productos => "pago" (usar "monto").
- Los precios suelen decirse en miles: "24" o "24 mil" = 24000.
- Si falta el precio dejalo null (el sistema usa el precio de lista).
- "transferencia" sin nombre => "Transferencia Joaco".
- Si no se entiende, operacion "desconocido".

Catálogo de productos: ${contexto.productos.join(', ')}
Clientes conocidos: ${contexto.clientes.join(', ')}`

  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      temperature: 0,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: texto },
      ],
    }),
  })
  const j = await r.json()
  const raw = (j.choices?.[0]?.message?.content ?? '{}').replace(/```json|```/g, '').trim()
  try { return JSON.parse(raw) } catch { return { operacion: 'desconocido' } }
}

// ---------- Matching contra la base ----------
const norm = (s) => (s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

function matchear(nombre, lista) {
  const n = norm(nombre)
  if (!n) return null
  let mejor = null
  for (const item of lista) {
    const cand = norm(item.nombre) + ' ' + norm(item.alias ?? '')
    if (cand.includes(n) || n.includes(norm(item.nombre))) { mejor = item; break }
    const palabras = n.split(/\s+/).filter((w) => w.length > 2)
    if (palabras.length && palabras.every((w) => cand.includes(w))) mejor = mejor ?? item
  }
  return mejor
}

function resumenDraft(d) {
  if (d.operacion === 'venta') {
    const items = d.items_resueltos
      .map((i) => `  • ${i.cantidad}× ${i.nombre} a $${(i.precio_unitario ?? 0).toLocaleString('es-AR')}`)
      .join('\n')
    const total = d.items_resueltos.reduce((a, i) => a + i.cantidad * (i.precio_unitario ?? 0), 0)
    return `🧾 *VENTA*\nCliente: *${d.cliente_nombre}*${d.cliente_nuevo ? ' _(nuevo)_' : ''}\n${items}\nTotal: *$${total.toLocaleString('es-AR')}*` +
      (d.pago_inicial > 0 ? `\nPaga ahora: $${d.pago_inicial.toLocaleString('es-AR')} (${d.medio_pago})` : '\nTodo a cuenta') +
      `\nEntrega: ${d.estado_entrega.toLowerCase().replace('_', ' ')}`
  }
  if (d.operacion === 'pago') {
    return `💵 *PAGO*\nCliente: *${d.cliente_nombre}*\nMonto: *$${d.monto.toLocaleString('es-AR')}*\nMedio: ${d.medio_pago ?? 'Efectivo'}`
  }
  return 'No entendí la operación.'
}

// ---------- Handler ----------
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(200).send('MJ Assist bot OK')

  try {
    const update = req.body

    // ----- Confirmación / cancelación -----
    if (update.callback_query) {
      const cq = update.callback_query
      const [accion, draftId] = cq.data.split(':')
      await tg('answerCallbackQuery', { callback_query_id: cq.id })

      const { data: draft } = await supabase.from('bot_drafts').select('*').eq('id', draftId).single()
      if (!draft) {
        await enviar(cq.message.chat.id, 'Ese borrador ya no existe.')
        return res.status(200).json({ ok: true })
      }
      await supabase.from('bot_drafts').delete().eq('id', draftId)

      if (accion === 'cancelar') {
        await enviar(cq.message.chat.id, '❌ Operación cancelada. No se grabó nada.')
        return res.status(200).json({ ok: true })
      }

      const d = draft.payload
      // Usuario que confirma (por chat vinculado; fallback: primer ADMIN)
      let { data: user } = await supabase.from('usuarios').select('id').eq('telegram_chat_id', cq.message.chat.id).maybeSingle()
      if (!user) ({ data: user } = await supabase.from('usuarios').select('id').eq('rol', 'ADMIN').limit(1).single())

      if (d.operacion === 'venta') {
        let clienteId = d.cliente_id
        if (!clienteId) {
          const { data: nuevo } = await supabase.from('clientes').insert({ nombre: d.cliente_nombre }).select('id').single()
          clienteId = nuevo.id
        }
        const { error } = await supabase.rpc('registrar_venta', {
          p_cliente: clienteId,
          p_usuario: user.id,
          p_canal: 'MINORISTA',
          p_estado_entrega: d.estado_entrega,
          p_canal_origen: 'TELEGRAM',
          p_items: d.items_resueltos.map((i) => ({
            producto_id: i.producto_id, cantidad: i.cantidad, precio_unitario: i.precio_unitario,
          })),
          p_pago_inicial: d.pago_inicial ?? 0,
          p_medio_pago: d.medio_pago,
          p_notas: 'Cargada por Telegram',
        })
        await enviar(cq.message.chat.id, error ? `⚠️ Error al grabar: ${error.message}` : '✅ Venta grabada.')
      } else if (d.operacion === 'pago') {
        const { error } = await supabase.from('pagos').insert({
          cliente_id: d.cliente_id, monto: d.monto,
          medio_pago: d.medio_pago ?? 'Efectivo',
          usuario_id: user.id, canal_origen: 'TELEGRAM',
        })
        await enviar(cq.message.chat.id, error ? `⚠️ Error al grabar: ${error.message}` : '✅ Pago grabado.')
      }
      return res.status(200).json({ ok: true })
    }

    // ----- Mensaje nuevo -----
    const msg = update.message
    if (!msg) return res.status(200).json({ ok: true })
    const chatId = msg.chat.id

    if (msg.text === '/start') {
      await enviar(chatId,
        '👋 *MJ Assist*\nMandame un texto o un audio tipo:\n_"Vendí un grape ice a Larisa a 24, transferencia, entregado"_\n_"Valen me pagó 10 mil en efectivo"_\nTe muestro la operación y la confirmás con un botón.')
      return res.status(200).json({ ok: true })
    }

    let texto = msg.text ?? ''
    if (msg.voice || msg.audio) {
      await enviar(chatId, '🎙 Transcribiendo audio…')
      texto = await transcribir((msg.voice ?? msg.audio).file_id)
      if (!texto) {
        await enviar(chatId, 'No pude transcribir el audio, probá de nuevo.')
        return res.status(200).json({ ok: true })
      }
    }
    if (!texto.trim()) return res.status(200).json({ ok: true })

    // Contexto para el LLM y el matching
    const [{ data: productos }, { data: clientes }] = await Promise.all([
      supabase.from('productos').select('id,nombre').eq('activo', true),
      supabase.from('clientes').select('id,nombre,alias').eq('activo', true),
    ])

    const parsed = await parsear(texto, {
      productos: (productos ?? []).map((p) => p.nombre),
      clientes: (clientes ?? []).map((c) => c.nombre),
    })

    if (parsed.operacion === 'desconocido') {
      await enviar(chatId, `Entendí: _"${texto}"_\nPero no pude armar la operación. Decime qué vendiste, a quién y a cuánto.`)
      return res.status(200).json({ ok: true })
    }

    // Resolver cliente y productos contra la base
    const cli = matchear(parsed.cliente, clientes ?? [])
    const draft = {
      operacion: parsed.operacion,
      cliente_id: cli?.id ?? null,
      cliente_nombre: cli?.nombre ?? parsed.cliente ?? 'Sin nombre',
      cliente_nuevo: !cli,
      estado_entrega: parsed.estado_entrega ?? 'ENTREGADO',
      pago_inicial: Number(parsed.pago_inicial) || 0,
      medio_pago: parsed.medio_pago ?? null,
      monto: Number(parsed.monto) || 0,
      items_resueltos: [],
    }

    if (parsed.operacion === 'venta') {
      const noEncontrados = []
      for (const it of parsed.items ?? []) {
        const prod = matchear(it.producto, productos ?? [])
        if (prod) {
          draft.items_resueltos.push({
            producto_id: prod.id, nombre: prod.nombre,
            cantidad: Number(it.cantidad) || 1,
            precio_unitario: it.precio_unitario != null ? Number(it.precio_unitario) : null,
          })
        } else noEncontrados.push(it.producto)
      }
      if (draft.items_resueltos.length === 0) {
        await enviar(chatId, `No encontré ${noEncontrados.length ? `"${noEncontrados.join('", "')}"` : 'los productos'} en el catálogo. Cargalos primero desde la PWA.`)
        return res.status(200).json({ ok: true })
      }
      // Completar precio de lista para mostrar el total en el draft
      const ids = draft.items_resueltos.filter((i) => i.precio_unitario == null).map((i) => i.producto_id)
      if (ids.length) {
        const { data: pv } = await supabase.from('v_precio_vigente').select('*').in('producto_id', ids).eq('canal', 'MINORISTA')
        draft.items_resueltos.forEach((i) => {
          if (i.precio_unitario == null) {
            i.precio_unitario = Number(pv?.find((x) => x.producto_id === i.producto_id)?.precio_ars ?? 0)
          }
        })
      }
      if (noEncontrados.length) draft.aviso = `No encontré: ${noEncontrados.join(', ')} (no se incluyen)`
    }

    if (parsed.operacion === 'pago' && !cli) {
      await enviar(chatId, `No encontré al cliente "${parsed.cliente}". Verificá el nombre o crealo en la PWA.`)
      return res.status(200).json({ ok: true })
    }

    const { data: saved } = await supabase.from('bot_drafts')
      .insert({ chat_id: chatId, payload: draft }).select('id').single()

    await enviar(chatId,
      resumenDraft(draft) + (draft.aviso ? `\n⚠️ ${draft.aviso}` : '') + '\n\n¿Confirmo?',
      {
        reply_markup: {
          inline_keyboard: [[
            { text: '✅ Confirmar', callback_data: `confirmar:${saved.id}` },
            { text: '❌ Cancelar', callback_data: `cancelar:${saved.id}` },
          ]],
        },
      })

    return res.status(200).json({ ok: true })
  } catch (e) {
    console.error('telegram webhook error', e)
    return res.status(200).json({ ok: true }) // 200 siempre para que Telegram no reintente en loop
  }
}
