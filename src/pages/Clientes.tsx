import { useEffect, useMemo, useState } from 'react'
import {
  getClientes, getMovimientosCliente, registrarPago, crearCliente, actualizarCliente, eliminarCliente,
  getTiposCliente, crearTipoCliente, actualizarTipoCliente, eliminarTipoCliente,
  fmtARS, fmtFecha, MEDIOS_PAGO, SaldoCliente, Venta, Pago, TipoCliente,
} from '../lib/api'
import { useApp } from '../main'

export default function Clientes() {
  const { operador, toast } = useApp()
  const [clientes, setClientes] = useState<SaldoCliente[]>([])
  const [tipos, setTipos] = useState<TipoCliente[]>([])
  const [tag, setTag] = useState<string>('TODOS')
  const [texto, setTexto] = useState('')
  const [sel, setSel] = useState<SaldoCliente | null>(null)
  const [movs, setMovs] = useState<{ ventas: Venta[]; pagos: Pago[] } | null>(null)
  const [pagoMonto, setPagoMonto] = useState('')
  const [pagoMedio, setPagoMedio] = useState(MEDIOS_PAGO[0])
  const [nuevoNombre, setNuevoNombre] = useState('')
  const [editando, setEditando] = useState<SaldoCliente | null>(null)
  const [editCampos, setEditCampos] = useState<Partial<SaldoCliente>>({})
  const [gestionTipos, setGestionTipos] = useState(false)
  const [nuevoTipo, setNuevoTipo] = useState('')
  const [editTipo, setEditTipo] = useState<TipoCliente | null>(null)

  const cargar = () => Promise.all([getClientes(), getTiposCliente()]).then(([c, t]) => { setClientes(c); setTipos(t) })
  useEffect(() => { cargar() }, [])

  useEffect(() => {
    if (sel) { setMovs(null); getMovimientosCliente(sel.id).then(setMovs) }
  }, [sel])

  const lista = useMemo(() => {
    const t = texto.toLowerCase()
    return clientes.filter((c) => {
      if (tag === 'DEUDA' && c.saldo <= 0) return false
      if (tag !== 'TODOS' && tag !== 'DEUDA' && c.tipo !== tag) return false
      if (!t) return true
      return [c.nombre, c.alias, c.telefono, c.instagram].join(' ').toLowerCase().includes(t)
    })
  }, [clientes, tag, texto])

  const cobrar = async () => {
    if (!sel || !operador || !Number(pagoMonto)) return
    try {
      await registrarPago({
        cliente_id: sel.id, monto: Number(pagoMonto), medio_pago: pagoMedio, usuario_id: operador.id,
      })
      toast('Pago registrado ✔')
      setPagoMonto('')
      await cargar()
      const actualizado = (await getClientes()).find((c) => c.id === sel.id)
      if (actualizado) setSel(actualizado)
      getMovimientosCliente(sel.id).then(setMovs)
    } catch { toast('Error al registrar el pago', true) }
  }

  const altaCliente = async () => {
    if (!nuevoNombre.trim()) { toast('Escribí un nombre para el cliente', true); return }
    try {
      await crearCliente({ nombre: nuevoNombre.trim() })
      setNuevoNombre('')
      toast('Cliente creado ✔')
      cargar()
    } catch (e: any) {
      toast(e.message || 'Error al crear cliente', true)
    }
  }

  const guardarEdicion = async () => {
    if (!editando) return
    try {
      await actualizarCliente(editando.id, editCampos)
      toast('Cliente actualizado ✔')
      setEditando(null)
      cargar()
    } catch (e: any) {
      toast(e.message || 'Error al actualizar cliente', true)
    }
  }

  const borrarCliente = async (c: SaldoCliente) => {
    if (!window.confirm(`¿Eliminar a ${c.nombre}?`)) return
    try {
      await eliminarCliente(c.id)
      toast('Cliente eliminado ✔')
      setSel(null)
      cargar()
    } catch (e: any) {
      toast(e.message || 'Error al eliminar cliente', true)
    }
  }

  const guardarTipo = async () => {
    if (!editTipo) return
    try {
      await actualizarTipoCliente(editTipo.id, { nombre: editTipo.nombre, orden: editTipo.orden })
      toast('Tipo actualizado ✔')
      setEditTipo(null)
      cargar()
    } catch (e: any) {
      toast(e.message || 'Error al actualizar tipo', true)
    }
  }

  const altaTipo = async () => {
    if (!nuevoTipo.trim()) return
    try {
      await crearTipoCliente(nuevoTipo.trim())
      setNuevoTipo('')
      toast('Tipo creado ✔')
      cargar()
    } catch (e: any) {
      toast(e.message || 'Error al crear tipo', true)
    }
  }

  const borrarTipo = async (t: TipoCliente) => {
    if (!window.confirm(`¿Eliminar tipo "${t.nombre}"? Los clientes con este tipo quedarán sin categoría.`)) return
    try {
      await eliminarTipoCliente(t.id)
      toast('Tipo eliminado ✔')
      cargar()
    } catch (e: any) {
      toast(e.message || 'Error al eliminar tipo', true)
    }
  }

  return (
    <>
      <input placeholder="Buscar por nombre, alias, teléfono o IG…" value={texto}
        onChange={(e) => setTexto(e.target.value)} style={{ marginBottom: 8 }} />
      <div className="chips">
        <button className={'chip' + (tag === 'TODOS' ? ' active' : '')} onClick={() => setTag('TODOS')}>Todos</button>
        <button className={'chip' + (tag === 'DEUDA' ? ' active' : '')} onClick={() => setTag('DEUDA')}>Con deuda</button>
        {tipos.map((t) => (
          <button key={t.id} className={'chip' + (tag === t.nombre ? ' active' : '')} onClick={() => setTag(t.nombre)}>{t.nombre}</button>
        ))}
        <button className="btn sm ghost" onClick={() => setGestionTipos(true)}>⚙ Tipos</button>
      </div>

      <div className="card row">
        <input placeholder="Nuevo cliente…" value={nuevoNombre} onChange={(e) => setNuevoNombre(e.target.value)} />
        <button type="button" className="btn sm primary" onClick={altaCliente}>Crear</button>
      </div>

      {lista.map((c) => (
        <div key={c.id} className={'card list-tap' + (c.saldo > 0 ? ' neon' : '')} onClick={() => setSel(c)}>
          <div className="row">
            <div className="col">
              <strong>{c.nombre}{c.alias ? ` · ${c.alias}` : ''}</strong>
              <span className="muted">
                {c.tipo}
                {c.telefono ? ` · ${c.telefono}` : ''}{c.instagram ? ` · @${c.instagram}` : ''}
              </span>
            </div>
            <div className="row" style={{ gap: 6 }}>
              <button type="button" className="btn sm ghost" onClick={(e) => { e.stopPropagation(); setEditando(c); setEditCampos(c) }}>✎</button>
              {c.saldo > 0
                ? <span className="badge warn">Debe {fmtARS(c.saldo)}</span>
                : <span className="badge ok">Al día</span>}
            </div>
          </div>
        </div>
      ))}
      {lista.length === 0 && <div className="empty">No hay clientes en este filtro.</div>}

      {/* Ficha 360 */}
      {sel && (
        <div className="modal-back" onClick={() => setSel(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="row">
              <h2>{sel.nombre}</h2>
              <div className="row" style={{ gap: 6 }}>
                <button type="button" className="btn sm ghost" onClick={() => { setEditando(sel); setEditCampos(sel) }}>✎ Editar</button>
                <button type="button" className="btn sm ghost" style={{ color: 'var(--neon)' }} onClick={() => borrarCliente(sel)}>🗑 Eliminar</button>
                <button type="button" className="btn sm" onClick={() => setSel(null)}>Cerrar</button>
              </div>
            </div>
            <div className="grid3" style={{ margin: '12px 0' }}>
              <div className="card col" style={{ margin: 0 }}>
                <span className="muted">Compró</span><strong>{fmtARS(sel.total_ventas)}</strong>
              </div>
              <div className="card col" style={{ margin: 0 }}>
                <span className="muted">Pagó</span><strong>{fmtARS(sel.total_pagos)}</strong>
              </div>
              <div className="card col" style={{ margin: 0, borderColor: sel.saldo > 0 ? 'var(--neon)' : 'var(--line)' }}>
                <span className="muted">Saldo</span>
                <strong style={{ color: sel.saldo > 0 ? 'var(--warn)' : 'var(--ok)' }}>{fmtARS(sel.saldo)}</strong>
              </div>
            </div>

            <div className="row" style={{ gap: 8 }}>
              <input type="number" inputMode="numeric" placeholder="Monto a cobrar"
                value={pagoMonto} onChange={(e) => setPagoMonto(e.target.value)} />
              <select value={pagoMedio} onChange={(e) => setPagoMedio(e.target.value)} style={{ width: 150 }}>
                {MEDIOS_PAGO.map((m) => <option key={m}>{m}</option>)}
              </select>
            </div>
            <div className="row" style={{ gap: 8, marginTop: 8 }}>
              <button type="button" className="btn primary block" onClick={cobrar} disabled={!Number(pagoMonto)}>
                Registrar pago
              </button>
              {sel.telefono && (
                <a className="btn block" style={{ textAlign: 'center' }}
                  href={`https://wa.me/${sel.telefono.replace(/\D/g, '')}`} target="_blank" rel="noreferrer">
                  WhatsApp
                </a>
              )}
            </div>

            <hr className="divider" />
            <h2>Historial</h2>
            {!movs && <div className="empty">Cargando movimientos…</div>}
            {movs && [...movs.ventas.map((v) => ({ tipo: 'V' as const, fecha: v.fecha, v })),
                      ...movs.pagos.map((p) => ({ tipo: 'P' as const, fecha: p.fecha, p }))]
              .sort((a, b) => b.fecha.localeCompare(a.fecha))
              .map((m, i) => (
                <div key={i} className="row" style={{ padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
                  {m.tipo === 'V' ? (
                    <>
                      <div className="col">
                        <span className="muted">{fmtFecha(m.fecha)} · Venta</span>
                        <span>{(m.v.venta_detalles ?? []).map((d) => `${d.cantidad}× ${d.productos.nombre}`).join(', ')}</span>
                      </div>
                      <strong>{fmtARS(Number(m.v.total_ars))}</strong>
                    </>
                  ) : (
                    <>
                      <div className="col">
                        <span className="muted">{fmtFecha(m.fecha)} · Pago {m.p.tipo === 'SENA' ? '(seña)' : ''}</span>
                        <span>{m.p.medio_pago}</span>
                      </div>
                      <strong style={{ color: 'var(--ok)' }}>−{fmtARS(Number(m.p.monto))}</strong>
                    </>
                  )}
                </div>
              ))}
            {movs && movs.ventas.length === 0 && movs.pagos.length === 0 && (
              <div className="empty">Sin movimientos todavía.</div>
            )}
          </div>
        </div>
      )}

      {/* Editar cliente */}
      {editando && (
        <div className="modal-back" onClick={() => setEditando(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Editar cliente</h2>
            <label>Nombre</label>
            <input value={editCampos.nombre ?? ''} onChange={(e) => setEditCampos({ ...editCampos, nombre: e.target.value })} />
            <label>Alias</label>
            <input value={editCampos.alias ?? ''} onChange={(e) => setEditCampos({ ...editCampos, alias: e.target.value || null })} />
            <label>Teléfono</label>
            <input value={editCampos.telefono ?? ''} onChange={(e) => setEditCampos({ ...editCampos, telefono: e.target.value || null })} />
            <label>Instagram</label>
            <input value={editCampos.instagram ?? ''} onChange={(e) => setEditCampos({ ...editCampos, instagram: e.target.value || null })} />
            <label>Tipo</label>
            <select value={editCampos.tipo ?? ''} onChange={(e) => setEditCampos({ ...editCampos, tipo: e.target.value })}>
              <option value="">—</option>
              {tipos.map((t) => <option key={t.id} value={t.nombre}>{t.nombre}</option>)}
            </select>
            <div className="row" style={{ gap: 8, marginTop: 14 }}>
              <button type="button" className="btn block" onClick={() => setEditando(null)}>Cancelar</button>
              <button type="button" className="btn primary block" onClick={guardarEdicion}>Guardar</button>
            </div>
          </div>
        </div>
      )}

      {/* Gestionar tipos */}
      {gestionTipos && (
        <div className="modal-back" onClick={() => setGestionTipos(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Gestionar tipos de cliente</h2>
            <div className="card row" style={{ marginBottom: 10 }}>
              <input placeholder="Nuevo tipo…" value={nuevoTipo} onChange={(e) => setNuevoTipo(e.target.value)} />
              <button type="button" className="btn sm primary" onClick={altaTipo}>Crear</button>
            </div>
            {tipos.map((t) => (
              <div className="row" key={t.id} style={{ padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
                {editTipo?.id === t.id ? (
                  <>
                    <input value={editTipo.nombre} onChange={(e) => setEditTipo({ ...editTipo, nombre: e.target.value })} style={{ flex: 1 }} />
                    <input type="number" value={editTipo.orden} onChange={(e) => setEditTipo({ ...editTipo, orden: Number(e.target.value) })} style={{ width: 60 }} />
                    <button type="button" className="btn sm primary" onClick={guardarTipo}>✔</button>
                    <button type="button" className="btn sm ghost" onClick={() => setEditTipo(null)}>✕</button>
                  </>
                ) : (
                  <>
                    <span style={{ flex: 1 }}>{t.nombre}</span>
                    <button type="button" className="btn sm ghost" onClick={() => setEditTipo(t)}>✎</button>
                    <button type="button" className="btn sm ghost" style={{ color: 'var(--neon)' }} onClick={() => borrarTipo(t)}>🗑</button>
                  </>
                )}
              </div>
            ))}
            <div className="row" style={{ gap: 8, marginTop: 14 }}>
              <button type="button" className="btn block" onClick={() => setGestionTipos(false)}>Cerrar</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
