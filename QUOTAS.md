# De dónde salen las cuotas del panel de orchestra

El mod abre la pantalla interactiva de cada CLI en una terminal oculta (pty de Python, desde `~`), escribe su comando de uso, pulsa Enter, lee la pantalla y la cierra. Si la pantalla muestra otro aviso (actualizar, confiar en la carpeta, iniciar sesión), no pulsa nada y deja la lectura anterior.

| CLI | Comando | Qué se muestra | Respaldo |
| --- | --- | --- | --- |
| claude | — (no se lanza: pediría confiar en `~` cada vez y cargaría todos los plugins) | ventanas de 5 h y semanal, % y reinicio | `$.session.usage()`: las cabeceras que Claude Code ya lee, en vivo |
| codex | `codex -c check_for_update_on_startup=false` → `/status` | 5 h y semanal (% libre → % usado), hora de reinicio, plan | última línea `"rate_limits"` de `~/.codex/sessions/*/*/*/rollout-*.jsonl` |
| agy | `agy` → `/usage` | cada grupo (Gemini, Claude y GPT, Argon) con sus modelos, límite semanal y de 5 h restante, "Refreshes in", y el estado de los créditos de IA | último rechazo |
| kimi | `kimi` → `/usage` | el recuadro "Plan usage" tal cual (hoy: "No usage data available.") | último rechazo |
| copilot | — (pide confiar en la carpeta) | solicitudes premium restantes / del mes, reinicio, plan | `gh api /copilot_internal/user` (endpoint sin documentar que usan los editores de GitHub); si falla, la cuenta propia del mod |
| opencode | — (`/usage` solo da estadísticas locales) | modelos gratis: último rechazo | — |

Cuándo se lee: al empezar la sesión, cada 15 min, al terminar cada agente externo y tras `delegate` action `probe`. Las lecturas no se solapan.

## Qué bloquea el enrutado

- Codex o Copilot con una ventana al 100 %: toda la CLI hasta ese reinicio.
- agy: cada modelo de un grupo con una ventana al 100 % hasta su "Refreshes in" (hoy Argon, ~163 h). Si el grupo vuelve a tener margen, se quitan los bloqueos de límite o créditos de sus modelos.
- Un error de un agente: "limited" hasta la hora que diga ("try again at 4:06 AM", "resets 2:40am", "in 3h 20m", ISO), 2 h si no dice ninguna; créditos o plan 72 h, o hasta que un probe vea responder al modelo. El "usage limit" de Codex bloquea todos sus modelos.

El prompt de enrutado lista "Usage now" por CLI y grupo, y los modelos bloqueados con su reinicio si falta menos de 24 h.
