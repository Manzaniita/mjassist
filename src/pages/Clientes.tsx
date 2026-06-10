import { useEffect, useMemo, useState } from 'react'
import {
  getClientes, getMovimientosCliente, registrarPago, crearCliente,
  fmtARS, fmtFecha, MEDIOS_PAGO, SaldoCliente, Venta, Pago,
} from '../lib/api'
import { useApp } from '../main'

export default function Clientes() {
  const { operador, toast } = useApp()
  const [clientes, setClientes] = useState<SaldoCliente[]>([])
  const [tag, setTag] = useState<'TODOS' | 'DEUDA' | 'REVENDEDOR' | 'MAYORISTA'>('TODOS')
  const [texto, setTexto] = useState('')
  const [sel, setSel] = useState<SaldoCliente | null>(null)
  const [movs, setMovs] = useState<{ ventas: Venta[]; pagos: Pago[] } | null>(null)
  const [pagoMonto, setPagoMonto] = useState('')
  const [pagoMedio, setPagoMedio] = useState(MEDIOS_PAGO[0])
  const [nuevoNombre, setNuevoNombre] = useState('')

  const cargar = () => getClientes().then(setClientes)
  useEffect(() => { cargar() }, [])

  useEffect(() => {
    if (sel) { setMovs(null); getMovimientosCliente(sel.id).then(setMovs) }
  }, [sel])

  const lista = useMemo(() => {
    const t = texto.toLowerCase()
    return clientes.filter((c) => {
      if (tag === 'DEUDA' && c.saldo <= 0) return false
      if (tag === 'REVENDEDOR' && c.tipo !== 'REVENDEDOR') return false
      if (tag === 'MAYORISTA' && c.tipo !== 'MAYORISTA') return false
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
    if (!nuevoNombre.trim()) return
    try {
      await crearCliente({ nombre: nuevoNombre.trim() })
      setNuevoNombre('')
      toast('Cliente creado ✔')
      cargar()
    } catch (e: any) {
      toast(e.message || 'Error al crear cliente', true)
    }
  }

  return (
    <>
      <input placeholder="Buscar por nombre, alias, teléfono o IG…" value={texto}
        onChange={(e) => setTexto(e.target.value)} style={{ marginBottom: 8 }} />
      <div className="chips">
        {([['TODOS', 'Todos'], ['DEUDA', 'Con deuda'], ['REVENDEDOR', 'Revendedores'], ['MAYORISTA', 'Mayoristas']] as const).map(([v, l]) => (
          <button key={v} className={'chip' + (tag === v ? ' active' : '')} onClick={() => setTag(v)}>{l}</button>
        ))}
      </div>

      <div className="card row">
        <input placeholder="Nuevo cliente…" value={nuevoNombre} onChange={(e) => setNuevoNombre(e.target.value)} />
        <button className="btn sm primary" onClick={altaCliente} disabled={!nuevoNombre.trim()}>Crear</button>
      </div>

      {lista.map((c) => (
        <div key={c.id} className={'card list-tap' + (c.saldo > 0 ? ' neon' : '')} onClick={() => setSel(c)}>
          <div className="row">
            <div className="col">
              <strong>{c.nombre}{c.alias ? ` · ${c.alias}` : ''}</strong>
              <span className="muted">
                {c.tipo === 'FINAL' ? 'Cliente' : c.tipo.toLowerCase()}
                {c.telefono ? ` · ${c.telefono}` : ''}{c.instagram ? ` · @${c.instagram}` : ''}
              </span>
            </div>
            {c.saldo > 0
              ? <span className="badge warn">Debe {fmtARS(c.saldo)}</span>
              : <span className="badge ok">Al día</span>}
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
              <button className="btn sm" onClick={() => setSel(null)}>Cerrar</button>
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
              <button className="btn primary block" onClick={cobrar} disabled={!Number(pagoMonto)}>
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
    </>
  )
}
