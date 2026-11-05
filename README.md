# orchestra

**Un equipo de agentes de IA que trabaja como un ingeniero senior que no desperdicia nada.**

orchestra es un mod (plugin) para [Claude Code](https://claude.com/claude-code). Reparte cada parte de una tarea al modelo que mejor la hace, empezando por el más barato. Puede usar subagentes de Claude o los agentes de otras CLIs que tengas instaladas: Codex, Antigravity/Gemini, OpenCode, GitHub Copilot o Kimi. Hace que esos agentes se coordinen sin pisarse y te lo muestra todo en un panel.

Lo acompañan dos cosas:

- **La skill `orchestra`**, que es su modo eficiencia. Funciona también en Codex, Copilot, Gemini, OpenCode y Kimi.
- **Un prompt maestro**, que construye o mejora el mod en tu equipo según los agentes que tengas.

> *English summary:* orchestra is a Claude Code plugin that splits a task across Claude subagents and other installed CLI agents (Codex, Antigravity/Gemini, OpenCode, Copilot, Kimi). Each part goes to the cheapest model that does it well. Agents share a board and never edit the same file at once, and a live pane shows plan usage, per-agent context, files and conversations. Its lean skill also works in any agent that reads `SKILL.md` files.

---

## Qué incluye

| Archivo | Qué es |
|---|---|
| `hooks/register.tsx` | El mod: reparto de trabajo, herramienta `delegate`, tablero, guard de archivos, relay con Haiku, modo lean y panel. |
| `skills/orchestra/SKILL.md` | La skill: reglas de eficiencia y de orquestación (respuestas cortas, código mínimo y completo, criterio para elegir modelos, encargos cortos). |
| `PROMPT-MAESTRO.md` | Prompt para pegar en Claude Code. Detecta tus agentes, te pregunta por tus planes y construye o mejora el mod. |
| `install-skill.sh` | Copia la skill en las carpetas de los agentes que tengas instalados. |
| `hooks/register.test.ts` | Tests del mod (`claude plugin test`). |

## Cómo funciona

1. **Reparto con criterio, sin recetas fijas.** En cada sesión el mod lee los modelos que cada CLI ofrece *ahora* en tu cuenta y se los da al chat principal, cada uno con su descripción, su ventana de contexto y sus niveles de esfuerzo. Para cada parte, el chat elige el modelo según cinco cosas:
   - el tipo de trabajo;
   - la dificultad;
   - el contexto que necesita;
   - si hacen falta las herramientas del chat;
   - el coste: lo gratis primero, luego las cuotas de otros planes y al final tus límites de Claude Code.

   **Si tú nombras un modelo, se usa ese.**
2. **Agentes externos en segundo plano.** La herramienta `delegate` lanza Codex, AGY, OpenCode, Copilot o Kimi con una tarea autocontenida, les reserva sus archivos y sigue su actividad en vivo. Al terminar, el agente deja un informe en `.orchestra/reports/`. Opcionalmente, un modelo *distinto* revisa su trabajo.
3. **Coordinación:**
   - Un tablero compartido (`board`, y `.orchestra/BOARD.md` para los agentes externos) donde los agentes se escriben entre sí o a un grupo.
   - Un guard que impide que dos agentes editen el mismo archivo a la vez.
   - Un registro de quién edita, lee o audita cada archivo, y qué funciones toca.
4. **Relay con Haiku.** Las notas largas y los informes se condensan con Haiku antes de llegar a otros agentes o al chat principal. Si Haiku pierde una ruta o un identificador, pasa el original.
5. **Modo lean (activo por defecto).** El chat, los subagentes de Claude y los agentes externos reciben reglas de eficiencia:
   - respuesta primero, sin relleno;
   - el cambio más pequeño que funcione completo;
   - leer solo lo necesario;
   - informes de pocas líneas.

   Se apaga con `/orchestra lean off`.
6. **Un panel** (`/orchestra`), igual en la CLI y en la app de escritorio:
   - **Usage**: lo usado y lo que queda de los límites de 5 h y semanal, la hora de reinicio, y el contexto del chat.
   - **Orchestra**: grupos y, por cada proveedor, una línea plegable con sus agentes (modelo, esfuerzo, `ctx` en %, tarea, archivos que edita y lee, y las funciones que toca).
   - **Files**: qué hace cada agente en cada archivo.
   - **Working together**: quién habla con quién y quién espera a quién.
   - **Agent**: la ficha de un agente y su conversación.
   - **Message the team**: un campo para escribir tú a un agente o a un grupo.
   - **Haiku relay**: encenderlo o apagarlo.

## Requisitos

- **Claude Code** reciente con soporte de mods (módulos de hooks de plugins). Probado en 2.1.318.
- **Opcional:** cualquiera de estas CLIs, con la sesión iniciada por ti: `codex`, `agy` (Antigravity), `opencode`, `copilot`, `kimi`. Las que no tengas se ignoran; el mod funciona solo con Claude.

## Instalación en Claude Code

En una terminal:

```bash
claude plugin marketplace add TheAlejo160/orchestra
```

```bash
claude plugin install orchestra@orchestra
```

O desde el prompt de Claude Code:

```
/plugin install orchestra --marketplace TheAlejo160/orchestra
```

Reinicia Claude Code. El panel se abre solo. Después:

- `/orchestra` vuelve a abrir el panel.
- `/orchestra lean on|off` enciende o apaga el modo eficiencia.
- La skill `orchestra:orchestra` viene dentro del plugin y Claude la carga cuando hace falta; no tienes que invocarla.

Para actualizar:

```bash
claude plugin marketplace update orchestra
```

```bash
claude plugin update orchestra@orchestra
```

## ¿Y si no uso Claude Code? (Codex, Copilot, Gemini, OpenCode, Kimi, Cursor…)

**El mod es solo para Claude Code**, porque se apoya en su API de plugins: panel, hooks y herramientas. **La skill funciona en cualquier agente que lea archivos `SKILL.md`.** Sin el mod no hay panel, ni guard de archivos, ni tablero, ni relay, pero sí:

- respuestas cortas y código mínimo y completo;
- criterio para elegir modelo y esfuerzo;
- encargos cortos;
- revisión con otro modelo, cuando el agente puede lanzar subagentes propios.

Para instalarla en los agentes que tengas:

```bash
git clone https://github.com/TheAlejo160/orchestra && sh orchestra/install-skill.sh
```

El script solo copia `skills/orchestra/SKILL.md` en estas carpetas, según qué CLIs encuentre:

| Agente | Carpeta de skills personal |
|---|---|
| Claude Code (solo la skill, sin el mod) | `~/.claude/skills/` |
| OpenAI Codex | `~/.codex/skills/` y `~/.agents/skills/` |
| GitHub Copilot CLI | `~/.copilot/skills/` y `~/.agents/skills/` |
| Gemini CLI / Antigravity | `~/.gemini/skills/` |
| OpenCode | `~/.config/opencode/skills/` |
| Kimi Code | `~/.kimi-code/skills/` |
| Cursor y otros | Cópiala a mano a la carpeta de skills o reglas que use ese agente. |

Las rutas pueden cambiar entre versiones de cada CLI; mira la documentación de la tuya si no la detecta.

## El prompt maestro

`PROMPT-MAESTRO.md` está pensado para Claude Code y sirve en dos situaciones:

- **No tienes el mod:** lo construye desde cero.
- **Ya lo tienes:** lo compara con la especificación y te propone qué mejorar.

En los dos casos, primero detecta qué agentes hay instalados (incluidos Cursor, Z.ai/GLM, Qwen y otros) y, sin inventar flags, averigua cómo correrlos sin preguntas. Luego te pregunta qué plan tienes en cada uno y en qué orden gastar las cuotas, y guarda tus respuestas en un archivo de configuración editable. Pégalo como primer mensaje de una sesión nueva.

## Seguridad

- **El mod nunca pide, lee ni guarda credenciales.** Cada CLI usa la sesión que ya iniciaste tú.
- **Los agentes externos en modo escritura pueden editar tu proyecto.** Usa `write: false` para revisiones y estudios. Cada CLI tiene su propio sandbox, y el de Antigravity limita los comandos al proyecto.
- **El guard de archivos solo controla las ediciones de los subagentes de Claude.** Las CLIs externas editan fuera de él, así que el mod reserva sobre la marcha los archivos que van tocando, para avisar a los demás.
- **`.orchestra/`** (informes y tablero) lleva su propio `.gitignore` y no entra en tus commits.
- **El relay con Haiku envía las notas largas a Haiku**, con tu cuenta de Claude, para condensarlas. Se apaga desde el panel.
- **El repositorio no contiene datos de nadie:** ni rutas, ni cuentas, ni informes de uso.

## Desarrollo

```bash
claude plugin validate .
```

```bash
claude plugin test .
```

Para añadir un proveedor nuevo hacen falta cinco piezas: una función que lea sus modelos, el `argv` para lanzarlo, un lector de su salida JSON, los patrones de rechazo de cuenta y su nota de coste. Copia el patrón de uno existente, añade su test con un proceso simulado y abre un PR.

## Licencia

MIT. Ver [LICENSE](LICENSE).
