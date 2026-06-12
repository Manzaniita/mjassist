import { useEffect, useMemo, useRef, useState } from 'react'
import {
  getStock, getReservado, getTemplateWhatsapp, setTemplateWhatsapp, registrarAjuste,
  getPreciosVigentes, getProductos, crearProducto, actualizarProducto, eliminarProducto, setPrecio,
  getCanalesPrecio, crearCanalPrecio, actualizarCanalPrecio, eliminarCanalPrecio,
  StockRow, PrecioVigente, CanalPrecio, Producto,
} from '../lib/api'
import { useApp } from '../main'

// ---------- Helpers CSV ----------
function quitarAcentos(s: string) {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}
function limpiarHeader(h: string) {
  return quitarAcentos(h).toLowerCase().replace(/[^a-z0-9]/g, '')
}
function detectarDelimitador(linea: string) {
  const candidatos = [',', ';', '\t', '|']
  let mejor = ','
  let max = 0
  for (const d of candidatos) {
    const c = linea.split(d).length
    if (c > max) { max = c; mejor = d }
  }
  return mejor
}
function parsearCSV(texto: string): { headers: string[]; rows: string[][] } {
  const lineas = texto.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter((l) => l.trim())
  if (lineas.length === 0) return { headers: [], rows: [] }
  const delim = detectarDelimitador(lineas[0])
  const parsearLinea = (linea: string): string[] => {
    const res: string[] = []
    let actual = ''
    let entreComillas = false
    for (let i = 0; i < linea.length; i++) {
      const ch = linea[i]
      const next = linea[i + 1]
      if (ch === '"') {
        if (entreComillas && next === '"') { actual += '"'; i++ }
        else { entreComillas = !entreComillas }
      } else if (ch === delim && !entreComillas) {
        res.push(actual.trim())
        actual = ''
      } else {
        actual += ch
      }
    }
    res.push(actual.trim())
    return res
  }
  return { headers: parsearLinea(lineas[0]), rows: lineas.slice(1).map(parsearLinea) }
}

const CAMPOS_ESPECIALES = new Set(['nombre', 'cantidad', 'sku', 'marca', 'stockminimo', 'costo'])
const SINONIMOS_CAMPO: Record<string, string> = {
  producto: 'nombre', articulo: 'nombre', item: 'nombre',
  stock: 'cantidad', unidades: 'cantidad',
  codigo: 'sku', codigoproducto: 'sku',
  minimostock: 'stockminimo', minimo: 'stockminimo', min: 'stockminimo',
}
const SINONIMOS_CANAL: Record<string, string> = {
  reventa: 'REVENDEDOR',
  comunidad: 'MAYORISTA',
  publico: 'MINORISTA',
}

interface FilaImportacion {
  nombre: string
  cantidad: number | null
  sku: string | null
  marca: string | null
  stock_minimo: number | null
  costo: number | null
  precios: { canal: string; precio: number }[]
  fila: number
}

export default function Stock() {
  const { operador, toast } = useApp()
  const [stock, setStock] = useState<StockRow[]>([])
  const [reservado, setReservado] = useState<Record<string, number>>({})
  const [preciosVigentes, setPreciosVigentes] = useState<PrecioVigente[]>([])
  const [canales, setCanales] = useState<CanalPrecio[]>([])
  const [template, setTemplate] = useState('')
  const [editTpl, setEditTpl] = useState(false)
  const [ajuste, setAjuste] = useState<{ producto_id: string; nombre: string } | null>(null)
  const [ajCant, setAjCant] = useState('')
  const [ajMotivo, setAjMotivo] = useState('')

  const [nuevoProd, setNuevoProd] = useState('')
  const [editProd, setEditProd] = useState<{ id: string; nombre: string; marca: string; sku: string; stock_minimo: number; costo: string } | null>(null)
  const [editPrecios, setEditPrecios] = useState<{ id: string; nombre: string } | null>(null)
  const [precioInputs, setPrecioInputs] = useState<Record<string, string>>({})
  const [seleccionados, setSeleccionados] = useState<Set<string>>(new Set())
  const [precioMasivo, setPrecioMasivo] = useState<{ canal: string; precio: string } | null>(null)
  const [gestionCanales, setGestionCanales] = useState(false)
  const [nuevoCanal, setNuevoCanal] = useState('')
  const [editCanal, setEditCanal] = useState<CanalPrecio | null>(null)
  const [filtroTexto, setFiltroTexto] = useState('')
  const [importPreview, setImportPreview] = useState<{ filas: FilaImportacion[]; creados: number; actualizados: number; canalesNuevos: string[] } | null>(null)
  const [importando, setImportando] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const cargar = () =>
    Promise.all([getStock(), getReservado(), getTemplateWhatsapp(), getPreciosVigentes(), getCanalesPrecio()]).then(
      ([s, r, t, pv, c]) => {
        setStock(s); setReservado(r); setTemplate(t); setPreciosVigentes(pv); setCanales(c)
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

  const productosFiltrados = useMemo(() => {
    if (!filtroTexto) return productos
    const t = filtroTexto.toLowerCase()
    return productos.filter((p) => p.nombre.toLowerCase().includes(t))
  }, [productos, filtroTexto])

  const precios = useMemo(() => {
    const map: Record<string, Record<string, number>> = {}
    preciosVigentes.forEach((p) => {
      map[p.producto_id] = map[p.producto_id] ?? {}
      map[p.producto_id][p.canal] = Number(p.precio_ars)
    })
    return map
  }, [preciosVigentes])

  const mensaje = useMemo(() => {
    const canalDefault = canales[0]?.nombre ?? 'MINORISTA'
    const lineas = productos
      .filter((p) => p.disponible > 0)
      .map((p) => `• ${p.nombre}${precios[p.id]?.[canalDefault] ? ` — $${precios[p.id][canalDefault].toLocaleString('es-AR')}` : ''}`)
      .join('\n')
    return template.replace('{{lineas}}', lineas || '(sin stock disponible)')
  }, [productos, template, precios, canales])

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
        costo: editProd.costo ? Number(editProd.costo) : null,
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
      for (const c of canales) {
        const val = Number(precioInputs[c.nombre])
        if (!isNaN(val) && val >= 0) {
          await setPrecio(editPrecios.id, c.nombre, val)
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

  const seleccionarTodos = () => {
    if (seleccionados.size === productosFiltrados.length) {
      setSeleccionados(new Set())
    } else {
      setSeleccionados(new Set(productosFiltrados.map((p) => p.id)))
    }
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

  const guardarCanal = async () => {
    if (!editCanal) return
    try {
      await actualizarCanalPrecio(editCanal.id, { nombre: editCanal.nombre, orden: editCanal.orden })
      toast('Canal actualizado ✔')
      setEditCanal(null)
      cargar()
    } catch (e: any) {
      toast(e.message || 'Error al actualizar canal', true)
    }
  }

  const altaCanal = async () => {
    if (!nuevoCanal.trim()) return
    try {
      await crearCanalPrecio(nuevoCanal.trim())
      setNuevoCanal('')
      toast('Canal creado ✔')
      cargar()
    } catch (e: any) {
      toast(e.message || 'Error al crear canal', true)
    }
  }

  const borrarCanal = async (c: CanalPrecio) => {
    if (!window.confirm(`¿Eliminar canal "${c.nombre}"?`)) return
    try {
      await eliminarCanalPrecio(c.id)
      toast('Canal eliminado ✔')
      cargar()
    } catch (e: any) {
      toast(e.message || 'Error al eliminar canal', true)
    }
  }

  const resolverCanal = (header: string, canalesActuales: CanalPrecio[]): string => {
    const normalizado = limpiarHeader(header)
    if (SINONIMOS_CANAL[normalizado]) {
      const target = SINONIMOS_CANAL[normalizado]
      if (canalesActuales.some((c) => c.nombre.toUpperCase() === target)) return target
    }
    const exacto = canalesActuales.find((c) => c.nombre.toUpperCase() === normalizado.toUpperCase())
    if (exacto) return exacto.nombre
    return header.trim()
  }

  const procesarArchivoCSV = async (file: File) => {
    if (!operador) { toast('Debes seleccionar un operador', true); return }
    const texto = await file.text()
    const { headers, rows } = parsearCSV(texto)
    if (headers.length === 0) { toast('El CSV está vacío', true); return }

    const mapaHeader = new Map<string, string>()
    headers.forEach((h, i) => {
      const limpio = limpiarHeader(h)
      const campo = SINONIMOS_CAMPO[limpio] ?? limpio
      mapaHeader.set(String(i), campo)
    })

    const idxNombre = headers.findIndex((_, i) => mapaHeader.get(String(i)) === 'nombre')
    if (idxNombre === -1) { toast('Falta la columna Nombre', true); return }

    let canalesNuevos: string[] = []
    const canalesActuales = await getCanalesPrecio()
    const canalPorHeader = new Map<number, string>()
    headers.forEach((h, i) => {
      const campo = mapaHeader.get(String(i)) ?? ''
      if (!CAMPOS_ESPECIALES.has(campo)) {
        const canal = resolverCanal(h, canalesActuales)
        canalPorHeader.set(i, canal)
        if (!canalesActuales.some((c) => c.nombre.toUpperCase() === canal.toUpperCase())) {
          if (!canalesNuevos.some((n) => n.toUpperCase() === canal.toUpperCase())) canalesNuevos.push(canal)
        }
      }
    })

    const productosExistentes = await getProductos()
    const porNombre = new Map(productosExistentes.map((p) => [p.nombre.toLowerCase().trim(), p]))
    const porSku = new Map<string, Producto>()
    productosExistentes.forEach((p) => { if (p.sku) porSku.set(p.sku.toLowerCase().trim(), p) })

    const filas: FilaImportacion[] = []
    rows.forEach((cols, idx) => {
      const nombre = cols[idxNombre]?.trim()
      if (!nombre) return
      const leer = (campo: string): string | null => {
        const i = headers.findIndex((_, ix) => mapaHeader.get(String(ix)) === campo)
        return i === -1 ? null : cols[i]?.trim() || null
      }
      const leerNum = (campo: string): number | null => {
        const v = leer(campo)
        if (!v) return null
        const n = Number(v.replace(/[$\s.]/g, '').replace(',', '.'))
        return isNaN(n) ? null : n
      }
      const skuRaw = leer('sku')
      const sku = skuRaw ? skuRaw : null
      const precios: { canal: string; precio: number }[] = []
      canalPorHeader.forEach((canal, i) => {
        const v = cols[i]?.trim()
        if (!v) return
        const n = Number(v.replace(/[$\s.]/g, '').replace(',', '.'))
        if (!isNaN(n) && n >= 0) precios.push({ canal, precio: n })
      })

      filas.push({
        nombre,
        cantidad: leerNum('cantidad'),
        sku,
        marca: leer('marca'),
        stock_minimo: leerNum('stockminimo'),
        costo: leerNum('costo'),
        precios,
        fila: idx + 2,
      })
    })

    let creados = 0
    let actualizados = 0
    filas.forEach((f) => {
      const keySku = f.sku?.toLowerCase()
      const existe = keySku ? porSku.get(keySku) : porNombre.get(f.nombre.toLowerCase())
      if (existe) actualizados++
      else creados++
    })

    setImportPreview({ filas, creados, actualizados, canalesNuevos })
  }

  const ejecutarImportacion = async () => {
    if (!importPreview || !operador) return
    setImportando(true)
    const { filas } = importPreview
    let ok = 0
    let errores: string[] = []
    try {
      const productosExistentes = await getProductos()
      const porNombre = new Map(productosExistentes.map((p) => [p.nombre.toLowerCase().trim(), p]))
      const porSku = new Map<string, Producto>()
      productosExistentes.forEach((p) => { if (p.sku) porSku.set(p.sku.toLowerCase().trim(), p) })
      const canalesActuales = await getCanalesPrecio()

      for (const f of filas) {
        try {
          const keySku = f.sku?.toLowerCase()
          let prod = keySku ? porSku.get(keySku) : porNombre.get(f.nombre.toLowerCase())
          const payload: Partial<Producto> = {
            nombre: f.nombre,
            marca: f.marca,
            sku: f.sku,
            stock_minimo: f.stock_minimo ?? 3,
            costo: f.costo,
          }
          if (prod) {
            await actualizarProducto(prod.id, payload)
          } else {
            prod = await crearProducto(f.nombre, f.marca, f.sku, f.stock_minimo ?? 3, f.costo)
            porNombre.set(prod.nombre.toLowerCase().trim(), prod)
            if (prod.sku) porSku.set(prod.sku.toLowerCase().trim(), prod)
          }
          if (f.cantidad && f.cantidad > 0) {
            await registrarAjuste(prod.id, f.cantidad, operador.id, 'Importación CSV')
          }
          for (const p of f.precios) {
            const canalExiste = canalesActuales.some((c) => c.nombre.toUpperCase() === p.canal.toUpperCase())
            if (!canalExiste) {
              await crearCanalPrecio(p.canal, canalesActuales.length + 1)
              canalesActuales.push({ id: 0, nombre: p.canal, orden: canalesActuales.length + 1, activo: true })
            }
            await setPrecio(prod.id, p.canal, p.precio)
          }
          ok++
        } catch (e: any) {
          errores.push(`Fila ${f.fila}: ${e.message || 'Error'}`)
        }
      }
      toast(`Importados ${ok} productos ✔`)
      if (errores.length > 0) toast(`${errores.length} filas con error`, true)
      setImportPreview(null)
      cargar()
    } finally {
      setImportando(false)
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
        <button
          type="button"
          className="btn sm ghost"
          onClick={() => fileInputRef.current?.click()}
          title="Importar CSV"
        >
          📁 Importar CSV
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.txt"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) { procesarArchivoCSV(file) }
            if (e.target.value) e.target.value = ''
          }}
        />
      </div>

      <div className="card row">
        <input placeholder="Filtrar productos…" value={filtroTexto} onChange={(e) => setFiltroTexto(e.target.value)} style={{ margin: 0 }} />
        <button type="button" className="btn sm ghost" onClick={seleccionarTodos}>
          {seleccionados.size === productosFiltrados.length && productosFiltrados.length > 0 ? 'Desmarcar' : 'Seleccionar todos'}
        </button>
        <button type="button" className="btn sm ghost" onClick={() => setGestionCanales(true)}>⚙ Canales</button>
      </div>

      {seleccionados.size > 0 && (
        <div className="card row" style={{ background: 'rgba(255,45,85,0.08)' }}>
          <span className="muted">{seleccionados.size} seleccionados</span>
          <button type="button" className="btn sm primary" onClick={() => setPrecioMasivo({ canal: canales[0]?.nombre ?? 'MINORISTA', precio: '' })}>Aplicar precio masivo</button>
          <button type="button" className="btn sm ghost" onClick={() => setSeleccionados(new Set())}>Limpiar</button>
        </div>
      )}

      {productosFiltrados.map((p) => {
        const max = Math.max(p.central + p.consignado, p.minimo * 3, 1)
        const pct = Math.min(100, (p.central / max) * 100)
        const nivel = p.central === 0 ? 'crit' : p.central <= p.minimo ? 'warn' : 'ok'
        const preciosProd = canales.map((c) => precios[p.id]?.[c.nombre] ?? 0)
        const preciosStr = preciosProd.some((v) => v > 0) ? ` · ${preciosProd.map((v) => v > 0 ? `$${v}` : '-').join('/')}` : ''
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
                Central {p.central} · En calle {p.consignado} · Reservado {p.reservado}{preciosStr}
              </span>
              <div className="row" style={{ gap: 6 }}>
                <button type="button" className="btn sm ghost" onClick={() => { setEditPrecios({ id: p.id, nombre: p.nombre }); setPrecioInputs(Object.fromEntries(canales.map((c) => [c.nombre, String(precios[p.id]?.[c.nombre] || '')]))) }}>💲</button>
                <button type="button" className="btn sm ghost" onClick={() => setAjuste({ producto_id: p.id, nombre: p.nombre })}>Ajustar</button>
                <button type="button" className="btn sm ghost" onClick={() => setEditProd({ id: p.id, nombre: p.nombre, marca: '', sku: '', stock_minimo: p.minimo, costo: '' })}>✎</button>
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
              <button type="button" className="btn block" onClick={() => setAjuste(null)}>Cancelar</button>
              <button type="button" className="btn primary block" onClick={guardarAjuste} disabled={!Number(ajCant)}>Guardar ajuste</button>
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
            <label>Costo</label>
            <input type="number" inputMode="numeric" placeholder="0" value={editProd.costo} onChange={(e) => setEditProd({ ...editProd, costo: e.target.value })} />
            <div className="row" style={{ gap: 8, marginTop: 14 }}>
              <button type="button" className="btn block" onClick={() => setEditProd(null)}>Cancelar</button>
              <button type="button" className="btn primary block" onClick={guardarProducto}>Guardar</button>
            </div>
          </div>
        </div>
      )}

      {editPrecios && (
        <div className="modal-back" onClick={() => setEditPrecios(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Precios — {editPrecios.nombre}</h2>
            {canales.map((c) => (
              <div key={c.id} style={{ marginBottom: 10 }}>
                <label>{c.nombre} (0 = sin precio)</label>
                <input type="number" inputMode="numeric" value={precioInputs[c.nombre] ?? ''}
                  onChange={(e) => setPrecioInputs({ ...precioInputs, [c.nombre]: e.target.value })} />
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
              {canales.map((c) => <option key={c.id} value={c.nombre}>{c.nombre}</option>)}
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

      {gestionCanales && (
        <div className="modal-back" onClick={() => setGestionCanales(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Gestionar canales de precio</h2>
            <div className="card row" style={{ marginBottom: 10 }}>
              <input placeholder="Nuevo canal…" value={nuevoCanal} onChange={(e) => setNuevoCanal(e.target.value)} />
              <button type="button" className="btn sm primary" onClick={altaCanal}>Crear</button>
            </div>
            {canales.map((c) => (
              <div className="row" key={c.id} style={{ padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
                {editCanal?.id === c.id ? (
                  <>
                    <input value={editCanal.nombre} onChange={(e) => setEditCanal({ ...editCanal, nombre: e.target.value })} style={{ flex: 1 }} />
                    <input type="number" value={editCanal.orden} onChange={(e) => setEditCanal({ ...editCanal, orden: Number(e.target.value) })} style={{ width: 60 }} />
                    <button type="button" className="btn sm primary" onClick={guardarCanal}>✔</button>
                    <button type="button" className="btn sm ghost" onClick={() => setEditCanal(null)}>✕</button>
                  </>
                ) : (
                  <>
                    <span style={{ flex: 1 }}>{c.nombre}</span>
                    <button type="button" className="btn sm ghost" onClick={() => setEditCanal(c)}>✎</button>
                    <button type="button" className="btn sm ghost" style={{ color: 'var(--neon)' }} onClick={() => borrarCanal(c)}>🗑</button>
                  </>
                )}
              </div>
            ))}
            <div className="row" style={{ gap: 8, marginTop: 14 }}>
              <button type="button" className="btn block" onClick={() => setGestionCanales(false)}>Cerrar</button>
            </div>
          </div>
        </div>
      )}

      {importPreview && (
        <div className="modal-back" onClick={() => setImportPreview(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxHeight: '80vh', overflow: 'auto' }}>
            <h2>Vista previa de importación</h2>
            <p className="muted">
              {importPreview.filas.length} filas · {importPreview.creados} nuevos · {importPreview.actualizados} a actualizar
            </p>
            {importPreview.canalesNuevos.length > 0 && (
              <p className="muted" style={{ color: 'var(--neon)' }}>
                Se crearán canales: {importPreview.canalesNuevos.join(', ')}
              </p>
            )}
            <div style={{ maxHeight: '40vh', overflow: 'auto', margin: '10px 0', border: '1px solid var(--line)', borderRadius: 8 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: 'var(--card)' }}>
                    <th style={{ padding: 6, textAlign: 'left' }}>Nombre</th>
                    <th style={{ padding: 6, textAlign: 'left' }}>Cant</th>
                    <th style={{ padding: 6, textAlign: 'left' }}>Costo</th>
                    <th style={{ padding: 6, textAlign: 'left' }}>Precios</th>
                  </tr>
                </thead>
                <tbody>
                  {importPreview.filas.map((f, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--line)' }}>
                      <td style={{ padding: 6 }}>{f.nombre}</td>
                      <td style={{ padding: 6 }}>{f.cantidad ?? '-'}</td>
                      <td style={{ padding: 6 }}>{f.costo ? `$${f.costo}` : '-'}</td>
                      <td style={{ padding: 6 }}>{f.precios.map((p) => `${p.canal}: $${p.precio}`).join(', ') || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="muted" style={{ fontSize: 12 }}>
              Columnas reconocidas: Nombre, Cantidad, SKU, Marca, StockMinimo, Costo. El resto se toman como canales de precio.
            </p>
            <div className="row" style={{ gap: 8, marginTop: 14 }}>
              <button type="button" className="btn block" onClick={() => setImportPreview(null)}>Cancelar</button>
              <button type="button" className="btn primary block" onClick={ejecutarImportacion} disabled={importando}>
                {importando ? 'Importando…' : 'Confirmar importación'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
