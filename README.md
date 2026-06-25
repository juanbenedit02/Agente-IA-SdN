# Agente WhatsApp

Dashboard local para gestionar un agente de WhatsApp con IA. Conecta un número real vía Baileys (sin Meta API ni Twilio) y responde mensajes con un LLM a través de OpenRouter.

## Requisitos

- Node.js 22+
- Git (para la instalación de dependencias de Baileys)
- Cuenta en [OpenRouter](https://openrouter.ai) con API key

## Setup rápido

```bash
# 1. Instalar dependencias
npm install

# 2. Configurar variables de entorno
cp .env.example .env.local
# Editar .env.local con tu OPENROUTER_API_KEY y OPENROUTER_MODEL

# 3. Levantar el bot (terminal 1)
npm run start:bot

# 4. Levantar el dashboard (terminal 2)
npm run dev

# O todo junto:
npm run start:all
```

Abrí **http://localhost:3000** para escanear el QR.

## Variables de entorno

```
OPENROUTER_API_KEY=sk-or-...
OPENROUTER_MODEL=openai/gpt-4o-mini
```

**Modelo recomendado:** `openai/gpt-4o-mini` (~$0.15 por millón de tokens).  
Los modelos `:free` de OpenRouter tienen un límite de 50 requests/día sin créditos cargados y fallarán con error 429 en uso real.

## Personalizar el system prompt

Editá `src/lib/system-prompt.ts` para adaptar el comportamiento del bot a tu negocio:

```typescript
export const SYSTEM_PROMPT = `
Eres un asistente de [TU EMPRESA]. Responde en español...
`.trim();
```

## Cómo funciona

- **Modo IA**: el bot responde automáticamente usando el LLM.
- **Modo Humano**: los mensajes se guardan pero no se responden. Podés escribir desde el dashboard.
- El toggle AI/HUMAN es por conversación individual.
- Los mensajes del dashboard (modo Humano) llegan al cliente vía WhatsApp.

## Estructura de datos

La base de datos SQLite vive en `./data/messages.db`. La sesión de WhatsApp se guarda en `./auth/`. Ambas carpetas están en `.gitignore`.

## ⚠️ Seguridad

El dashboard **no tiene autenticación**. Si vas a desplegarlo en internet:

1. Habilitá basic auth a nivel de proxy (Nginx, Caddy, EasyPanel).
2. O usá Cloudflare Access para proteger la URL.

Sin esto, cualquiera con la URL puede leer todas las conversaciones y enviar mensajes haciéndose pasar por vos.

## Deploy en producción (EasyPanel / Railway)

1. Subí el código a un repositorio Git.
2. Conectá el repositorio en EasyPanel.
3. Configurá las variables de entorno en el panel.
4. Creá volúmenes persistentes para `/app/data` y `/app/auth` — sin esto cada redespliegue pierde las conversaciones y obliga a re-escanear el QR.
5. El `Procfile` y `nixpacks.toml` ya están configurados.

## Solución de problemas

### El bot muestra código 440 en loop

Ocurre cuando WhatsApp detecta un fingerprint de dispositivo no reconocido.

1. Verificá que `Browsers.macOS('Desktop')` esté en `client.ts`.
2. En tu teléfono: **Configuración → Dispositivos vinculados** → borrá cualquier dispositivo viejo de pruebas.
3. Si persiste, cambiá la IP del servidor o esperá 24 horas.

### Error 429 del LLM

El modelo `:free` de OpenRouter agotó la cuota diaria. Cambiá `OPENROUTER_MODEL=openai/gpt-4o-mini` en `.env.local`.

### El QR no aparece en el dashboard

Asegurate de que `npm run start:bot` esté corriendo. El bot tarda unos segundos en generar el QR.

### Procesos zombie en Windows

Si `Ctrl+C` no mata todos los procesos:

```powershell
# Ver procesos node
tasklist | findstr node

# Matar por PID
taskkill /PID <pid> /F
```

## Mejoras pendientes (v2)

- [ ] Soporte de imágenes salientes
- [ ] Function calling con `tools` de OpenRouter
- [ ] Auto-toggle a HUMAN cuando el bot dice frase específica
- [ ] WebSocket en lugar de polling
- [ ] Autenticación básica en el dashboard
- [ ] Filtros y búsqueda en la lista de conversaciones
