# orchestra

**[English](#english) · [Español](#español)**

## English

**A team of AI agents that works like a senior engineer who wastes nothing.**

orchestra is a mod (plugin) for [Claude Code](https://claude.com/claude-code). It hands each part of a task to the cheapest model that does that part well. That can be a Claude subagent or an agent from another CLI you have installed: Codex, Antigravity/Gemini, OpenCode, GitHub Copilot or Kimi. The agents coordinate without stepping on each other, and one pane shows you everything they do.

The repository also contains:

- **The `orchestra` skill**, the mod's efficiency mode. The skill also works on its own in Codex, Copilot, Gemini, OpenCode and Kimi.
- **A master prompt** that builds or upgrades the mod on your machine for the agents you have.

---

### What's inside

| File | What it is |
|---|---|
| `hooks/register.tsx` | The mod: routing, the `delegate` tool, the shared board, the file guard, the Haiku relay, lean mode and the pane. |
| `skills/skill/SKILL.md` | The skill: efficiency and orchestration rules (short answers, minimal complete code, judging which model to use, lean briefs). |
| `MASTER-PROMPT.md` · `PROMPT-MAESTRO.md` | The master prompt, in English and in Spanish, to paste into Claude Code. It detects your agents, asks about your plans, and builds or upgrades the mod. |
| `install-skill.sh` | Copies the skill into the skill folders of the agents installed on your machine. |
| `hooks/register.test.ts` | The mod's tests, run with `claude plugin test`. |

### How it works

1. **Routing by judgment, not by a fixed recipe.** Every session, the mod reads the models each CLI offers your account *right now*. It hands them to the main chat with their descriptions, context windows and effort levels. For each part, the chat weighs:
   - the kind of work;
   - how hard it is;
   - how much context it needs;
   - whether it needs the chat's own tools;
   - cost: free models first, then other plans' quotas, then your Claude Code limits last.

   **If you name a model, that model is used.**
2. **External agents in the background.** The `delegate` tool runs Codex, AGY, OpenCode, Copilot or Kimi on a self-contained task. It claims the agent's files and follows its activity live. When the agent finishes, its report goes to `.orchestra/reports/`. Optionally, a *different* model reviews the work.
3. **Coordination.** The agents share three things:
   - a board (the `board` tool, plus `.orchestra/BOARD.md` for external agents), where they message each other or a whole group;
   - a guard that stops two agents from editing the same file at once;
   - a record of who edits, reads or audits each file, and which functions they touch.
4. **Haiku relay.** Haiku condenses long notes and reports before they reach other agents or the main chat. If Haiku would drop a path or an identifier, the original goes through instead.
5. **Lean mode, on by default.** The chat, the Claude subagents and the external agents all get efficiency rules: answer first with no filler, make the smallest complete change, read only what is needed, keep reports to a few lines. `/orchestra lean off` turns it off.
6. **One pane** (`/orchestra`), the same in the CLI and the desktop app. From top to bottom:
   - **Usage:** what is used and what is left of the 5-hour and weekly limits, when each resets, and the chat's context.
   - **Orchestra:** groups, then one collapsible row per provider. Each agent shows its model, effort, context %, task, the files it edits and reads, and the functions it touches.
   - **Files:** who does what on each file.
   - **Working together:** who talks to whom, and who waits on whom.
   - **Agent:** one agent's card and its conversation.
   - **Message the team:** a box to write to an agent or a group yourself.
   - **Haiku relay:** a switch to turn it on or off.

### Requirements

- **A recent Claude Code with mod support** (plugin hooks modules). Tested on 2.1.318.
- **Optional:** any of these CLIs, signed in by you: `codex`, `agy` (Antigravity), `opencode`, `copilot`, `kimi`. The mod ignores the ones you don't have, and it works with Claude alone.

### Install in Claude Code

In a terminal:

```bash
claude plugin marketplace add TheAlejo160/orchestra
```

```bash
claude plugin install orchestra@orchestra
```

Or at the Claude Code prompt:

```
/plugin install orchestra --marketplace TheAlejo160/orchestra
```

Restart Claude Code. The pane opens by itself with each session. In a terminal narrower than 144 columns, Claude Code holds back panes that plugins open on their own, so the pane appears with your first message instead. If you close it by hand, it stays closed until `/orchestra`. After that:

- `/orchestra` reopens the pane.
- `/orchestra lean on|off` turns lean mode on or off.
- The skill `orchestra:skill` ships inside the plugin, and Claude loads it when needed. You never have to invoke it.

To update:

```bash
claude plugin marketplace update orchestra
```

```bash
claude plugin update orchestra@orchestra
```

### Not using Claude Code? (Codex, Copilot, Gemini, OpenCode, Kimi, Cursor…)

**The mod runs only in Claude Code,** because it is built on Claude Code's plugin API: the pane, the hooks and the tools. **The skill works in any agent that reads `SKILL.md` files.** Without the mod you get no pane, file guard, board or relay. You still get:

- short answers and minimal, complete code;
- judgment on which model and effort to use;
- lean briefs;
- review by a different model, where the agent can run subagents of its own.

To install the skill into the agents you have:

```bash
git clone https://github.com/TheAlejo160/orchestra && sh orchestra/install-skill.sh
```

The script only copies `skills/skill/SKILL.md`, into these folders for the CLIs it finds:

| Agent | Personal skills folder |
|---|---|
| Claude Code (the skill only, without the mod) | `~/.claude/skills/` |
| OpenAI Codex | `~/.codex/skills/` and `~/.agents/skills/` |
| GitHub Copilot CLI | `~/.copilot/skills/` and `~/.agents/skills/` |
| Gemini CLI / Antigravity | `~/.gemini/skills/` |
| OpenCode | `~/.config/opencode/skills/` |
| Kimi Code | `~/.kimi-code/skills/` |
| Cursor and others | Copy it by hand into the skills or rules folder your agent uses. |

These folders can change between CLI versions. If the script doesn't find yours, check that CLI's docs.

### The master prompt

[`MASTER-PROMPT.md`](MASTER-PROMPT.md) (English) and [`PROMPT-MAESTRO.md`](PROMPT-MAESTRO.md) (Spanish) are the same prompt, written for Claude Code. It does two things:

- **Without the mod:** it builds the mod from scratch.
- **With the mod:** it compares it with the spec and proposes upgrades.

Either way, it first detects the agents you have installed, including Cursor, Z.ai/GLM, Qwen and others. From each CLI's own `--help` and a test run, without inventing flags, it works out how to run it without prompts. Then it asks about your plan for each agent and the order to spend quotas in, and saves your answers to a config file you can edit later. Paste it as the first message of a new session.

### Security

- **The mod never asks for, reads or stores credentials.** Each CLI uses the session you signed in yourself.
- **External agents in write mode can edit your project.** Use `write: false` for reviews and surveys. Each CLI has its own sandbox; Antigravity's keeps commands inside the project.
- **The file guard covers edits by Claude subagents only.** External CLIs edit outside it, so the mod claims the files they touch as it sees them, to warn the other agents off.
- **`.orchestra/`**, which holds the reports and the board, has its own `.gitignore` and stays out of your commits.
- **The Haiku relay sends long notes to Haiku,** on your Claude account, to condense them. You can turn it off in the pane.
- **This repository contains no one's personal data:** no paths, no accounts, no usage reports.

### Development

```bash
claude plugin validate .
```

```bash
claude plugin test .
```

To add a provider, write five pieces:

- a model loader;
- the `argv` that launches it;
- a reader for its JSON output;
- its account-refusal patterns;
- a cost note.

Copy the pattern of an existing provider, add a test with a simulated process, and open a PR.

### License

MIT. See [LICENSE](LICENSE).

---

## Español

**Un equipo de agentes de IA que trabaja como un ingeniero senior que no desperdicia nada.**

orchestra es un mod (plugin) para [Claude Code](https://claude.com/claude-code). Reparte cada parte de una tarea al modelo que mejor la hace, empezando por el más barato. Puede usar subagentes de Claude o los agentes de otras CLIs que tengas instaladas: Codex, Antigravity/Gemini, OpenCode, GitHub Copilot o Kimi. Hace que esos agentes se coordinen sin pisarse y te lo muestra todo en un panel.

Lo acompañan dos cosas:

- **La skill `orchestra`**, que es su modo eficiencia. Funciona también en Codex, Copilot, Gemini, OpenCode y Kimi.
- **Un prompt maestro**, que construye o mejora el mod en tu equipo según los agentes que tengas.

---

### Qué incluye

| Archivo | Qué es |
|---|---|
| `hooks/register.tsx` | El mod: reparto de trabajo, herramienta `delegate`, tablero, guard de archivos, relay con Haiku, modo lean y panel. |
| `skills/skill/SKILL.md` | La skill: reglas de eficiencia y de orquestación (respuestas cortas, código mínimo y completo, criterio para elegir modelos, encargos cortos). |
| `PROMPT-MAESTRO.md` · `MASTER-PROMPT.md` | El prompt maestro, en español y en inglés, para pegar en Claude Code. Detecta tus agentes, te pregunta por tus planes y construye o mejora el mod. |
| `install-skill.sh` | Copia la skill en las carpetas de los agentes que tengas instalados. |
| `hooks/register.test.ts` | Tests del mod (`claude plugin test`). |

### Cómo funciona

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

### Requisitos

- **Claude Code** reciente con soporte de mods (módulos de hooks de plugins). Probado en 2.1.318.
- **Opcional:** cualquiera de estas CLIs, con la sesión iniciada por ti: `codex`, `agy` (Antigravity), `opencode`, `copilot`, `kimi`. Las que no tengas se ignoran; el mod funciona solo con Claude.

### Instalación en Claude Code

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

Reinicia Claude Code. El panel se abre solo en cada sesión. En una terminal de menos de 144 columnas, Claude Code retiene los paneles que un plugin abre por su cuenta, así que el panel aparece con tu primer mensaje. Si lo cierras a mano, no vuelve a abrirse hasta que escribas `/orchestra`. Después:

- `/orchestra` vuelve a abrir el panel.
- `/orchestra lean on|off` enciende o apaga el modo eficiencia.
- La skill `orchestra:skill` viene dentro del plugin y Claude la carga cuando hace falta; no tienes que invocarla.

Para actualizar:

```bash
claude plugin marketplace update orchestra
```

```bash
claude plugin update orchestra@orchestra
```

### ¿Y si no uso Claude Code? (Codex, Copilot, Gemini, OpenCode, Kimi, Cursor…)

**El mod es solo para Claude Code**, porque se apoya en su API de plugins: panel, hooks y herramientas. **La skill funciona en cualquier agente que lea archivos `SKILL.md`.** Sin el mod no hay panel, ni guard de archivos, ni tablero, ni relay, pero sí:

- respuestas cortas y código mínimo y completo;
- criterio para elegir modelo y esfuerzo;
- encargos cortos;
- revisión con otro modelo, cuando el agente puede lanzar subagentes propios.

Para instalarla en los agentes que tengas:

```bash
git clone https://github.com/TheAlejo160/orchestra && sh orchestra/install-skill.sh
```

El script solo copia `skills/skill/SKILL.md` en estas carpetas, según qué CLIs encuentre:

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

### El prompt maestro

[`PROMPT-MAESTRO.md`](PROMPT-MAESTRO.md) (español) y [`MASTER-PROMPT.md`](MASTER-PROMPT.md) (inglés) son el mismo prompt, pensado para Claude Code. Sirve en dos situaciones:

- **No tienes el mod:** lo construye desde cero.
- **Ya lo tienes:** lo compara con la especificación y te propone qué mejorar.

En los dos casos, primero detecta qué agentes hay instalados (incluidos Cursor, Z.ai/GLM, Qwen y otros) y, sin inventar flags, averigua cómo correrlos sin preguntas. Luego te pregunta qué plan tienes en cada uno y en qué orden gastar las cuotas, y guarda tus respuestas en un archivo de configuración editable. Pégalo como primer mensaje de una sesión nueva.

### Seguridad

- **El mod nunca pide, lee ni guarda credenciales.** Cada CLI usa la sesión que ya iniciaste tú.
- **Los agentes externos en modo escritura pueden editar tu proyecto.** Usa `write: false` para revisiones y estudios. Cada CLI tiene su propio sandbox, y el de Antigravity limita los comandos al proyecto.
- **El guard de archivos solo controla las ediciones de los subagentes de Claude.** Las CLIs externas editan fuera de él, así que el mod reserva sobre la marcha los archivos que van tocando, para avisar a los demás.
- **`.orchestra/`** (informes y tablero) lleva su propio `.gitignore` y no entra en tus commits.
- **El relay con Haiku envía las notas largas a Haiku**, con tu cuenta de Claude, para condensarlas. Se apaga desde el panel.
- **El repositorio no contiene datos de nadie:** ni rutas, ni cuentas, ni informes de uso.

### Desarrollo

```bash
claude plugin validate .
```

```bash
claude plugin test .
```

Para añadir un proveedor nuevo hacen falta cinco piezas: una función que lea sus modelos, el `argv` para lanzarlo, un lector de su salida JSON, los patrones de rechazo de cuenta y su nota de coste. Copia el patrón de uno existente, añade su test con un proceso simulado y abre un PR.

### Licencia

MIT. Ver [LICENSE](LICENSE).
