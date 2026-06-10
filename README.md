# MJ Assist — Gestión MJ Importaciones

PWA mobile-first + bot de Telegram para reemplazar el Google Sheets "MJ Control Humito".
Stack: **Vite + React + TypeScript** · **Supabase (PostgreSQL)** · **Vercel** (hosting + Functions) · **Groq** (Whisper + Llama para el bot).

Creado por mjimportaciones

---

## 1. Base de datos (Supabase)

1. Entrá a tu proyecto en [supabase.com](https://supabase.com) → **SQL Editor** → **New query**.
2. Pegá **completo** el contenido de `supabase/schema.sql` y ejecutá (**Run**).
3. Listo: tablas, vistas, funciones RPC, políticas RLS y datos iniciales (usuarios Fernando/Joaco/Meli, depósito Central, catálogo con precios por canal).

> ⚠️ Si el proyecto ya tiene tablas de pruebas anteriores con estos nombres, borralas antes o usá un proyecto limpio. El script asume base vacía.

> 🔐 **Seguridad:** las políticas RLS son permisivas (herramienta interna con anon key). No publiques la URL de la PWA. Cuando quieras, se agrega Supabase Auth y se restringen las políticas.

## 2. Variables de entorno

Copiá `.env.example` a `.env` y completá (Supabase → Settings → API):

```
VITE_SUPABASE_URL=https://TU-PROYECTO.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

Para correr local:

```bash
npm install
npm run dev
```

## 3. Subir a GitHub

El repo ya viene con git inicializado y el primer commit hecho. Conectalo a tu GitHub:

```bash
cd mjassist
git remote add origin https://github.com/Manzaniita/mjassist.git
git push -u origin main --force   # --force solo si el repo remoto tenía el scaffold viejo
```

> Si preferís no pisar el repo actual, creá uno nuevo (`mjassist-v2`) y apuntá `origin` ahí.

## 4. Deploy en Vercel

1. En Vercel: **Add New → Project** → importá el repo (o si ya existe el proyecto, el push dispara el deploy).
2. Framework preset: **Vite**. Build command `npm run build`, output `dist` (lo detecta solo).
3. **Settings → Environment Variables**, cargá las 6:

| Variable | Para | De dónde sale |
|---|---|---|
| `VITE_SUPABASE_URL` | PWA | Supabase → Settings → API |
| `VITE_SUPABASE_ANON_KEY` | PWA | Supabase → Settings → API (anon public) |
| `SUPABASE_URL` | Bot | La misma URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Bot | Supabase → Settings → API (service_role — **secreta**) |
| `TELEGRAM_BOT_TOKEN` | Bot | @BotFather |
| `GROQ_API_KEY` | Bot | console.groq.com → API Keys |

4. Redeploy para que tomen efecto.

## 5. Activar el bot de Telegram

1. Crear el bot con [@BotFather](https://t.me/BotFather) (`/newbot`) y copiar el token.
2. Registrar el webhook (reemplazá TOKEN y tu dominio de Vercel):

```bash
curl "https://api.telegram.org/botTOKEN/setWebhook?url=https://TU-APP.vercel.app/api/telegram"
```

3. Mandale `/start` al bot y probá: *"Vendí un grape ice a valen a 24, transferencia, entregado"* — te muestra el draft y confirmás con el botón.
4. (Opcional) Vinculá tu chat para que las cargas queden a tu nombre: mandate un mensaje al bot, mirá el `chat_id` en los logs de Vercel y guardalo en `usuarios.telegram_chat_id`.

## 6. Qué incluye la PWA

- **Inicio:** vendido hoy/7 días, por cobrar, stock crítico, deuda de revendedores, últimas ventas.
- **Ventas:** historial con búsqueda y filtros (saldo, fechas) + **nueva venta rápida** (cliente → productos → confirmar) con carrito multi-producto, precio editable, seña o pago total.
- **Clientes:** tags (Con deuda / Revendedores / Mayoristas), alta rápida, **Ficha 360°** con saldo calculado (ventas − pagos), historial completo, registrar pago y botón de WhatsApp.
- **Stock:** Central vs. en calle vs. reservado con termómetros, ajustes manuales auditados (chau "stock viejo"), y **mensaje de WhatsApp** con template editable + copiar/compartir.
- **Revendedores:** mercadería en su poder valorizada, deuda, **entrega en consignación** (precio congelado al remito) y **rendición** en una sola operación (vendidas + devueltas + pago).
- **Caja:** arqueo por medio de pago en cualquier rango de fechas.

Instalable como app: en Chrome del celu → menú → *Agregar a pantalla de inicio*.

## 7. Migración desde el Sheets

El importador de CSVs es el próximo paso (Fase importación). Mientras tanto podés arrancar en limpio: cargá el stock real con "Ajustar" en cada producto y los saldos iniciales de deudores como ventas con nota "Saldo inicial migrado".
