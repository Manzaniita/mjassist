import { useEffect, useMemo, useState } from 'react'
import {
  getStock, getReservado, getTemplateWhatsapp, setTemplateWhatsapp, registrarAjuste,
  getPreciosVigentes, StockRow,
} from '../lib/api'
import { useApp } from '../main'

export default function Stock() {
  const { operador, toast } = useApp()
  const [stock, setStock] = useState<StockRow[]>([])
  const [reservado, setReservado] = useState<Record<string, number>>({})
  const [precios, setPrecios] = useState<Record<string, number>>({})
  const [template, setTemplate] = useState('')
  const [editTpl, setEditTpl] = useState(false)
  const [ajuste, setAjuste] = useState<{ producto_id: string; nombre: string } | null>(null)
  const [ajCant, setAjCant] = useState('')
  const [ajMotivo, setAjMotivo] = useState('')

  const cargar = () =>
    Promise.all([getStock(), getReservado(), getTemplateWhatsapp(), getPreciosVigentes()]).then(
      ([s, r, t, pv]) => {
        setStock(s); setReservado(r); setTemplate(t)
        setPrecios(Object.fromEntries(
          pv.filter((p) => p.canal === 'MINORISTA').map((p) => [p.producto_id, Number(p.precio_ars)])
        ))
      }
    )
  useEffect(() => { cargar() }, [])

  const productos = useMemo(() => {
    const map = new Map<string, { nombre: string; minimo: number; central: number; consignado: number }>()
    stock.forEach((s) => {
      const e = map.get(s.producto_id) ?? { nombre: s.producto, minimo: s.stock_minimo, central: 0, consignado: 0 }
      if (s.es_central) e.central += s.cantidad
      else e.consignado += s.cantidad
      map.set(s.producto_id, e)
    })
    return [...map.entries()]
      .map(([id, e]) => ({ id, ...e, reservado: reservado[id] ?? 0, disponible: e.central - (reservado[id] ?? 0) }))
      .sort((a, b) => a.disponible - b.disponible)
  }, [stock, reservado])

  const mensaje = useMemo(() => {
    const lineas = productos
      .filter((p) => p.disponible > 0)
      .map((p) => `• ${p.nombre}${precios[p.id] ? ` — $${precios[p.id].toLocaleString('es-AR')}` : ''}`)
      .join('\n')
    return template.replace('{{lineas}}', lineas || '(sin stock disponible)')
  }, [productos, template, precios])

  const copiar = async () => {
    await navigator.clipboard.writeText(mensaje)
    toast('Mensaje copiado ✔ Pegalo en el grupo')
  }
  const compartir = () => {
    window.open('https://wa.me/?text=' + encodeURIComponent(mensaje), '_blank')
  }

  const guardarAjuste = async () => {
    if (!ajuste || !operador || !Number(ajCant)) return
    try {
      await registrarAjuste(ajuste.producto_id, Number(ajCant), operador.id, ajMotivo || 'Ajuste manual')
      toast('Ajuste registrado ✔')
      setAjuste(null); setAjCant(''); setAjMotivo('')
      cargar()
    } catch { toast('Error al ajustar', true) }
  }

  return (
    <>
      <div className="card neon">
        <h2 style={{ marginBottom: 8 }}>Mensaje para el grupo</h2>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn primary block" onClick={copiar}>📋 Copiar stock</button>
          <button className="btn block" onClick={compartir}>Enviar por WhatsApp</button>
        </div>
        <button className="btn sm ghost" style={{ marginTop: 8 }} onClick={() => setEditTpl(!editTpl)}>
          {editTpl ? 'Cerrar editor' : '✎ Editar formato del mensaje'}
        </button>
        {editTpl && (
          <>
            <textarea rows={5} value={template} onChange={(e) => setTemplate(e.target.value)} style={{ marginTop: 8 }} />
            <p className="muted" style={{ margin: '6px 0' }}>Usá {'{{lineas}}'} donde van los productos.</p>
            <button className="btn sm primary" onClick={async () => { await setTemplateWhatsapp(template); toast('Formato guardado ✔') }}>
              Guardar formato
            </button>
          </>
        )}
      </div>

      {productos.map((p) => {
        const max = Math.max(p.central + p.consignado, p.minimo * 3, 1)
        const pct = Math.min(100, (p.central / max) * 100)
        const nivel = p.central === 0 ? 'crit' : p.central <= p.minimo ? 'warn' : 'ok'
        return (
          <div className="card" key={p.id}>
            <div className="row">
              <strong>{p.nombre}</strong>
              {p.central === 0
                ? <span className="badge neon">Agotado</span>
                : p.central <= p.minimo
                  ? <span className="badge warn">Stock mínimo</span>
                  : <span className="badge ok">{p.disponible} disp.</span>}
            </div>
            <div className="thermo"><div className={nivel} style={{ width: pct + '%' }} /></div>
            <div className="row" style={{ marginTop: 7 }}>
              <span className="muted">
                Central {p.central} · En calle {p.consignado} · Reservado {p.reservado}
              </span>
              <button className="btn sm ghost" onClick={() => setAjuste({ producto_id: p.id, nombre: p.nombre })}>
                Ajustar
              </button>
            </div>
          </div>
        )
      })}

      {ajuste && (
        <div className="modal-back" onClick={() => setAjuste(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Ajustar stock — {ajuste.nombre}</h2>
            <label>Cantidad (negativo resta, positivo suma)</label>
            <input type="number" inputMode="numeric" value={ajCant} onChange={(e) => setAjCant(e.target.value)} autoFocus />
            <label>Motivo</label>
            <input placeholder="Ej: unidad dañada, conteo físico…" value={ajMotivo} onChange={(e) => setAjMotivo(e.target.value)} />
            <div className="row" style={{ gap: 8, marginTop: 14 }}>
              <button className="btn block" onClick={() => setAjuste(null)}>Cancelar</button>
              <button className="btn primary block" onClick={guardarAjuste} disabled={!Number(ajCant)}>Guardar ajuste</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
