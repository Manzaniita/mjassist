const required = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY']
const missing = required.filter((k) => !(import.meta.env as any)[k])

if (missing.length) {
  const root = document.getElementById('root')
  if (root) {
    root.innerHTML = `
      <div style="padding:2rem;font-family:system-ui,sans-serif;background:#0a0a0a;color:#ff5555;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;">
        <h1 style="margin-bottom:1rem;font-size:1.5rem;">⚠️ Error de configuración</h1>
        <p style="color:#ccc;max-width:420px;line-height:1.6;font-size:0.95rem;">
          Faltan las siguientes variables de entorno en Vercel:<br/><br/>
          <code style="background:#222;padding:4px 8px;border-radius:4px;color:#fff;">${missing.join('</code><br/><code style="background:#222;padding:4px 8px;border-radius:4px;color:#fff;">')}</code>
        </p>
        <p style="color:#888;margin-top:1.5rem;font-size:0.9rem;">
          Andá a <b>Vercel → mjassist → Settings → Environment Variables</b>,<br/>
          agregalas y hacé <b>Redeploy</b>.
        </p>
      </div>
    `
  }
} else {
  import('./bootstrap').then(({ render }) => render())
}
