import { useEffect, useMemo, useState } from 'react'
import {
  getStock, getReservado, getTemplateWhatsapp, setTemplateWhatsapp, registrarAjuste,
  getPreciosVigentes, crearProducto, actualizarProducto, eliminarProducto, setPrecio, StockRow, PrecioVigente,
} from '../lib/api'
import { useApp } from '../main'

export default function Stock() {
  const { operador, toast } = useApp()
  const [stock, setStock] = useState<StockRow[]>([])
  const [reservado, setReservado] = useState<Record<string, number>>({})
  const [preciosVigentes, setPreciosVigentes] = useState<PrecioVigente[]>([])
  const [template, setTemplate] = useState('')
  const [editTpl, setEditTpl] = useState(false)
  const [ajuste, setAjuste] = useState<{ producto_id: string; nombre: string } | null>(null)
  const [ajCant, setAjCant] = useState('')
  const [ajMotivo, setAjMotivo] = useState('')

  const [nuevoProd, setNuevoProd] = useState('')
  const [editProd, setEditProd] = useState<{ id: string; nombre: string; marca: string; sku: string; stock_minimo: number } | null>(null)
  const [editPrecios, setEditPrecios] = useState<{ id: string; nombre: string } | null>(null)
  const [precioInputs, setPrecioInputs] = useState<Record<string, string>>({})
  const [seleccionados, setSeleccionados] = useState<Set<string>>(new Set())
  const [precioMasivo, setPrecioMasivo] = useState<{ canal: string; precio: string } | null>(null)

  const cargar = () =>
    Promise.all([getStock(), getReservado(), getTemplateWhatsapp(), getPreciosVigentes()]).then(
      ([s, r, t, pv]) => {
        setStock(s); setReservado(r); setTemplate(t); setPreciosVigentes(pv)
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

  const precios = useMemo(() => {
    const map: Record<string, Record<string, number>> = {}
    preciosVigentes.forEach((p) => {
      map[p.producto_id] = map[p.producto_id] ?? {}
      map[p.producto_id][p.canal] = Number(p.precio_ars)
    })
    return map
  }, [preciosVigentes])

  const mensaje = useMemo(() => {
    const lineas = productos
      .filter((p) => p.disponible > 0)
      .map((p) => `• ${p.nombre}${precios[p.id]?.MINORISTA ? ` — $${precios[p.id].MINORISTA.toLocaleString('es-AR')}` : ''}`)
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

  const altaProducto = async () => {
    if (!nuevoProd.trim()) return
    try {
      await crearProducto(nuevoProd.trim())
      toast('Producto creado ✔')
      setNuevoProd('')
      cargar()
    } catch (e: any) {
      toast(e.message || 'Error al crear producto', true)
    }
  }

  const guardarProducto = async () => {
    if (!editProd) return
    try {
      await actualizarProducto(editProd.id, {
        nombre: editProd.nombre,
        marca: editProd.marca || null,
        sku: editProd.sku || null,
        stock_minimo: Number(editProd.stock_minimo) || 3,
      })
      toast('Producto actualizado ✔')
      setEditProd(null)
      cargar()
    } catch (e: any) {
      toast(e.message || 'Error al actualizar producto', true)
    }
  }

  const borrarProducto = async (id: string, nombre: string) => {
    if (!window.confirm(`¿Eliminar ${nombre}?`)) return
    try {
      await eliminarProducto(id)
      toast('Producto eliminado ✔')
      cargar()
    } catch (e: any) {
      toast(e.message || 'Error al eliminar producto', true)
    }
  }

  const guardarPrecios = async () => {
    if (!editPrecios) return
    try {
      for (const canal of ['MINORISTA', 'REVENDEDOR', 'MAYORISTA']) {
        const val = Number(precioInputs[canal])
        if (!isNaN(val) && val >= 0) {
          await setPrecio(editPrecios.id, canal, val)
        }
      }
      toast('Precios actualizados ✔')
      setEditPrecios(null)
      cargar()
    } catch (e: any) {
      toast(e.message || 'Error al guardar precios', true)
    }
  }

  const toggleSel = (id: string) => {
    const next = new Set(seleccionados)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSeleccionados(next)
  }

  const aplicarPrecioMasivo = async () => {
    if (!precioMasivo || seleccionados.size === 0) return
    const precio = Number(precioMasivo.precio)
    if (isNaN(precio) || precio < 0) { toast('Precio inválido', true); return }
    try {
      for (const id of seleccionados) {
        await setPrecio(id, precioMasivo.canal, precio)
      }
      toast(`Precio aplicado a ${seleccionados.size} productos ✔`)
      setPrecioMasivo(null)
      setSeleccionados(new Set())
      cargar()
    } catch (e: any) {
      toast(e.message || 'Error al aplicar precios', true)
    }
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

      <div className="card row">
        <input placeholder="Nuevo producto…" value={nuevoProd} onChange={(e) => setNuevoProd(e.target.value)} />
        <button type="button" className="btn sm primary" onClick={altaProducto}>Crear</button>
      </div>

      {seleccionados.size > 0 && (
        <div className="card row" style={{ background: 'rgba(255,45,85,0.08)' }}>
          <span className="muted">{seleccionados.size} seleccionados</span>
          <button type="button" className="btn sm primary" onClick={() => setPrecioMasivo({ canal: 'MINORISTA', precio: '' })}>Aplicar precio masivo</button>
          <button type="button" className="btn sm ghost" onClick={() => setSeleccionados(new Set())}>Limpiar</button>
        </div>
      )}

      {productos.map((p) => {
        const max = Math.max(p.central + p.consignado, p.minimo * 3, 1)
        const pct = Math.min(100, (p.central / max) * 100)
        const nivel = p.central === 0 ? 'crit' : p.central <= p.minimo ? 'warn' : 'ok'
        const pmin = precios[p.id]?.MINORISTA ?? 0
        const prev = precios[p.id]?.REVENDEDOR ?? 0
        const pmay = precios[p.id]?.MAYORISTA ?? 0
        return (
          <div className="card" key={p.id}>
            <div className="row">
              <div className="row" style={{ gap: 8 }}>
                <input type="checkbox" checked={seleccionados.has(p.id)} onChange={() => toggleSel(p.id)} style={{ width: 18, height: 18 }} />
                <strong>{p.nombre}</strong>
              </div>
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
                {(pmin || prev || pmay) ? ` · $${pmin || '-'}/${prev || '-'}/${pmay || '-'}` : ''}
              </span>
              <div className="row" style={{ gap: 6 }}>
                <button type="button" className="btn sm ghost" onClick={() => { setEditPrecios({ id: p.id, nombre: p.nombre }); setPrecioInputs({ MINORISTA: String(pmin || ''), REVENDEDOR: String(prev || ''), MAYORISTA: String(pmay || '') }) }}>💲</button>
                <button type="button" className="btn sm ghost" onClick={() => setAjuste({ producto_id: p.id, nombre: p.nombre })}>Ajustar</button>
                <button type="button" className="btn sm ghost" onClick={() => setEditProd({ id: p.id, nombre: p.nombre, marca: '', sku: '', stock_minimo: p.minimo })}>✎</button>
                <button type="button" className="btn sm ghost" style={{ color: 'var(--neon)' }} onClick={() => borrarProducto(p.id, p.nombre)}>🗑</button>
              </div>
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

      {editProd && (
        <div className="modal-back" onClick={() => setEditProd(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Editar producto</h2>
            <label>Nombre</label>
            <input value={editProd.nombre} onChange={(e) => setEditProd({ ...editProd, nombre: e.target.value })} />
            <label>Marca</label>
            <input value={editProd.marca} onChange={(e) => setEditProd({ ...editProd, marca: e.target.value })} />
            <label>SKU</label>
            <input value={editProd.sku} onChange={(e) => setEditProd({ ...editProd, sku: e.target.value })} />
            <label>Stock mínimo</label>
            <input type="number" inputMode="numeric" value={editProd.stock_minimo} onChange={(e) => setEditProd({ ...editProd, stock_minimo: Number(e.target.value) })} />
            <div className="row" style={{ gap: 8, marginTop: 14 }}>
              <button className="btn block" onClick={() => setEditProd(null)}>Cancelar</button>
              <button className="btn primary block" onClick={guardarProducto}>Guardar</button>
            </div>
          </div>
        </div>
      )}

      {editPrecios && (
        <div className="modal-back" onClick={() => setEditPrecios(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Precios — {editPrecios.nombre}</h2>
            {(['MINORISTA', 'REVENDEDOR', 'MAYORISTA'] as const).map((canal) => (
              <div key={canal} style={{ marginBottom: 10 }}>
                <label>{canal === 'MINORISTA' ? 'Minorista' : canal === 'REVENDEDOR' ? 'Revendedor' : 'Mayorista'} (0 = sin precio)</label>
                <input type="number" inputMode="numeric" value={precioInputs[canal] ?? ''}
                  onChange={(e) => setPrecioInputs({ ...precioInputs, [canal]: e.target.value })} />
              </div>
            ))}
            <div className="row" style={{ gap: 8, marginTop: 14 }}>
              <button type="button" className="btn block" onClick={() => setEditPrecios(null)}>Cancelar</button>
              <button type="button" className="btn primary block" onClick={guardarPrecios}>Guardar precios</button>
            </div>
          </div>
        </div>
      )}

      {precioMasivo && (
        <div className="modal-back" onClick={() => setPrecioMasivo(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Precio masivo ({seleccionados.size} productos)</h2>
            <label>Canal</label>
            <select value={precioMasivo.canal} onChange={(e) => setPrecioMasivo({ ...precioMasivo, canal: e.target.value })}>
              <option value="MINORISTA">Minorista</option>
              <option value="REVENDEDOR">Revendedor</option>
              <option value="MAYORISTA">Mayorista</option>
            </select>
            <label>Precio</label>
            <input type="number" inputMode="numeric" autoFocus value={precioMasivo.precio} onChange={(e) => setPrecioMasivo({ ...precioMasivo, precio: e.target.value })} />
            <div className="row" style={{ gap: 8, marginTop: 14 }}>
              <button type="button" className="btn block" onClick={() => setPrecioMasivo(null)}>Cancelar</button>
              <button type="button" className="btn primary block" onClick={aplicarPrecioMasivo}>Aplicar</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
