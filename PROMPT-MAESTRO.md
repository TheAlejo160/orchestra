# Prompt maestro: «orchestra» para Claude Code

Sirve para dos cosas:

- **Crear** el mod desde cero en un equipo que no lo tiene.
- **Mejorar** un orchestra que ya existe hasta dejarlo como describe este documento, sin perder lo que ya funciona.

Detecta qué agentes de IA hay instalados en el equipo y se adapta a ellos. Cada agente se puede activar, desactivar o configurar sin tocar el código.

**Cómo usarlo:** abre una sesión nueva de Claude Code (CLI o app de escritorio), en la carpeta donde quieres el mod o en la del mod que ya tienes. Copia todo lo que hay debajo de la línea y pégalo como primer mensaje. Puedes añadir al final una línea con lo que quieras cambiar, por ejemplo: «sin Kimi; Copilot siempre en auto; añade Cursor».

---

Quiero que construyas o mejores un mod de Claude Code llamado **orchestra**: un orquestador multiagente. Reparte el trabajo entre subagentes de Claude y agentes de otras CLIs instaladas en mi equipo, hace que se coordinen sin pisarse y lo muestra todo en un panel.

## 0. Reglas de trabajo (antes de nada)

1. Carga el skill `plugin-authoring` y sigue sus reglas: dónde va el mod, el contrato de tipos, `claude plugin validate`, `claude plugin test` y `tsc`.
2. Antes de usar cualquier API de `$`, búscala en las declaraciones de tipos que indica el skill y lee su declaración. **No inventes APIs, eventos ni props.** Si algo que pido no existe en la API, dímelo y propón la alternativa más cercana.
3. **No inventes flags ni formatos de ninguna CLI.** Para cada CLI externa, saca su forma de uso de su propio `--help`, de su documentación instalada y de una ejecución de prueba mínima en un directorio temporal. Si no puedes confirmar algo, márcalo como «sin verificar» y dímelo.
4. Nunca pidas, leas ni escribas credenciales, tokens ni claves. Si una CLI no tiene sesión iniciada, dime el comando para que la inicie yo.
5. No cambies la configuración global de las CLIs. El mod solo lee lo que necesita.
6. Antes de descargar o instalar nada, pídeme permiso y dime qué es, de dónde viene y cuánto pesa.
7. Trabaja por fases y enséñame el resultado de las fases 1 y 2 antes de escribir código.

## 1. Fase 1: detectar el entorno

### 1.1 ¿Crear o mejorar?

- Busca un orchestra existente: en la carpeta actual, en `~/.claude/plugins/installed_plugins.json` (entrada `orchestra@…`) y en las carpetas de mods de desarrollo que indica el skill.
- Si existe: léelo **entero**, incluidos sus tests, el contrato de tipos y su `plugin.json`. Haz una tabla con cada función de las secciones 3 a 9: «ya está», «está pero distinta» o «falta». Esa es la base de la fase 2.
- Si no existe, se crea desde cero.

### 1.2 Inventario de agentes

Usa siempre un shell de login para heredar mi PATH: `/bin/zsh -lc '…'` en macOS, `bash -lc '…'` en Linux. Comprueba al menos estos candidatos, y cualquier otro agente de IA para la terminal que encuentres en el PATH o en `~/.local/bin`, `~/.npm-global/bin`, `~/.bun/bin`, `/opt/homebrew/bin` y `~/.<nombre>/bin`:

| Candidato | Binarios a buscar |
|---|---|
| OpenAI Codex | `codex` |
| Google Antigravity / Gemini | `agy`, `gemini` |
| OpenCode | `opencode` |
| GitHub Copilot CLI | `copilot` |
| Kimi Code | `kimi` |
| Cursor (agente de terminal; la app sola es un IDE y no sirve) | `cursor-agent`, `agent` |
| Z.ai / GLM (sea cual sea el nombre de su CLI) | `zcode`, `zai`, `glm` |
| Qwen Code | `qwen` |
| Otros que aparezcan | `aider`, `crush`, `amp`, `goose`, … |

Para cada binario encontrado, averigua y anota:

- **Modo no interactivo:** el flag para pasar un prompt y salir (`exec`, `-p`, `run`, …).
- **Salida legible por máquina:** JSON o stream-json. Saca el formato real de cada línea con una ejecución de prueba: `Reply with exactly: OK`.
- **Cómo lista sus modelos.** Usa siempre la fuente más fresca: un comando de la propia CLI antes que un archivo de caché, porque una caché puede venir de una versión vieja de la CLI y traer modelos antiguos. Anota por modelo: id, descripción o nombre visible, ventana de contexto y niveles de esfuerzo admitidos.
- **Esfuerzo o razonamiento:** cómo se pasa y qué valores acepta. Hay CLIs que lo llevan en el id del modelo, como `-low` o `-high`.
- **Permisos:** cómo correr en solo lectura y cómo aprobar ediciones sin preguntas. Confirma qué hace la CLI en modo no interactivo cuando una herramienta pide confirmación: algunas la rechazan en silencio y terminan sin respuesta.
- **Sandbox:** si limita los comandos al proyecto. Pruébalo: un `touch` fuera del proyecto debe fallar.
- **Cómo informa del final:** mensaje final, archivo de salida, tokens usados y errores.
- **Errores de cuenta:** cómo se ven «plan sin acceso», «sin créditos», «límite alcanzado» y «sin sesión». Así el mod los reconoce después.
- **Si tiene sesión iniciada.**

Si falta un agente que suele instalarse por separado de su app (Cursor, por ejemplo), dímelo y pregunta si lo instalo. No lo instales sin mi sí.

### 1.3 Preguntarme por cada agente

Enséñame una tabla con cada agente detectado (versión, modelos, si tiene sesión, lo que quedó sin verificar) y pregúntame, en una sola tanda:

- Cuáles activo y cuáles no.
- **Qué plan tengo en cada uno** (gratis, estudiante, Pro, de pago, sin plan) y qué gasta cada tarea: tokens, peticiones premium o cuota.
- Si alguno debe ir siempre en automático, sin elegir modelo ni esfuerzo. Ejemplo: Copilot en un plan que deja elegir el modelo a la propia CLI va siempre en `auto`.
- Qué modelo uso por defecto cuando no indico ninguno. Ejemplo: en OpenCode, el modelo gratuito que yo prefiera.
- Qué modelos de cada CLI quiero **excluir**.
- **El orden de gasto:** qué cuotas se gastan antes que los límites de Claude Code. Ejemplo: Antigravity ofrece Claude Opus y Sonnet con su propia cuota, así que conviene gastar esa antes que los límites de 5 h y semanales de Claude Code.

Guarda mis respuestas en un archivo de configuración del usuario que el mod lea al arrancar, por ejemplo `~/.config/orchestra/providers.json`. Así podré editarlo luego sin tocar código: activar o desactivar un agente, cambiar su plan, su modelo por defecto o sus exclusiones, o añadir un agente nuevo. Si un agente del archivo no está instalado, el mod lo ignora y lo dice.

## 2. Fase 2: plan

Dime en una lista corta:

- Qué vas a crear o cambiar.
- Qué adaptadores de agente vas a escribir.
- Qué quedó sin verificar.

Al mejorar, di también qué se conserva tal cual. Espera mi «sí» antes de seguir.

## 3. Arquitectura

```
orchestra/
  .claude-plugin/plugin.json        name, version, description, "types": "./types/index.d.ts"
  .claude-plugin/marketplace.json   para instalarlo con /plugin install (solo si te lo pido)
  hooks/hooks.json                  { "modules": ["./register.tsx"] }
  hooks/register.tsx                hooks, herramientas, panel
  hooks/providers.ts                un adaptador por agente externo (si la API permite importar archivos del plugin; compruébalo)
  hooks/register.test.ts            tests
  types/index.d.ts                  contrato de $.state (PluginState.orchestra)
```

**Adaptador de agente.** Cada agente externo es un objeto con la misma forma. Añadir uno nuevo (Cursor, Z.ai, …) debe consistir en escribir un adaptador y una entrada de configuración, sin tocar el resto:

```ts
type Adapter = {
  id: string                       // 'codex', 'agy', 'cursor', …
  name: string                     // nombre en el panel
  detect: () => Promise<boolean>   // ¿instalado y con sesión?
  listModels: () => Promise<Model[]>   // fuente más fresca; solo la generación más nueva de cada línea si la CLI lista varias
  argv: (task: Task, prompt: string, reportPath: string) => string[]   // lectura o escritura, modelo, esfuerzo
  readLine: (line: string) => StreamFact   // actividad, archivos leídos y editados, tokens, modelo real, texto final, error, coste
  refusal: RegExp                  // errores de cuenta: plan, créditos, cuota, sesión
  autoOnly?: boolean               // nunca pasar modelo ni esfuerzo (p. ej. Copilot en auto)
  defaultModel?: (models: Model[]) => string | undefined
  costNote: string                 // qué gasta, para el texto de reparto
}
type Model = { provider: string; id: string; name: string; window: number; efforts: string[]; blocked?: string }
```

**Estado** en `$.state`, con `atom()`, `read()` y `update()`, todo declarado en el contrato: `main` (chat principal), `agents`, `claims`, `touches`, `notes`, `log`, `limits`, `catalog`, `groups`, `team` (selección y secciones abiertas en el panel) y `relay`. Lo que dura entre sesiones va en `$.store`: el catálogo para arrancar sin esperar, los bloqueos de cuenta con su caducidad y los contadores mensuales de peticiones premium. Si cambias la forma de un valor guardado, usa la etiqueta `shape` que explica el skill.

## 4. Reparto del trabajo (lo más importante)

Va en una sección de `prompt.compose` (`scope: 'session'`) generada a partir del catálogo **vivo**. Solo ofrece modelos que la cuenta acepta.

**No es una receta fija.** El orquestador decide parte por parte, con criterio:

1. **Si yo nombro modelos, proveedores o esfuerzo** para algo, se usan exactamente esos para esas partes. Solo decide el resto.
2. Si no, para cada parte elige el modelo que mejor encaja, sopesando:
   - **qué tipo de trabajo es:** plan, diseño, arquitectura, implementación, maqueta, investigación, búsqueda de imágenes, revisión, auditoría o texto;
   - **qué tan difícil es;**
   - **cuánto contexto necesita:** para trabajos pesados, las ventanas más grandes del catálogo;
   - **si necesita las herramientas, skills o contexto de este chat**, y entonces va a un subagente de Claude;
   - **cuánto cuesta**, en este orden: lo gratis primero; luego las cuotas de otros planes, incluida la cuota propia de un proveedor que ofrece modelos de Claude; los límites de Claude Code al final y para lo que de verdad lo necesite.
3. Fija el **esfuerzo según la parte**, no según el modelo: bajo para lo mecánico, medio para lo rutinario, alto para diseño y lógica de verdad, xhigh/max solo para el razonamiento más difícil.
4. Mezcla proveedores cuando ayude: uno planifica, otros construyen piezas separadas en paralelo y **otro modelo distinto** revisa o audita. Usa tan pocos agentes como pida la tarea. Una tarea pequeña la hace el orquestador solo.
5. Al lanzar agentes, explica en una línea qué modelo hace qué parte y por qué, para que yo pueda corregir.

Para que el criterio funcione, el texto de reparto incluye:

- Por cada modelo: su id, **la descripción que da su propia CLI**, su ventana y sus esfuerzos.
- Una línea por proveedor con aquello para lo que **suele** servir y lo que gasta. Es un punto de partida, no una regla.
- Los niveles de dificultad (complejo, medio, pequeño), con los modelos de cada nivel clasificados por su id y su descripción. Un modelo puede estar en dos niveles.

**Subagentes de Claude.** Regístralos con `$.agent.register` en `session.start`:

- `architect` (opus, high)
- `builder` (sonnet, medium)
- `reviewer` (sonnet, high): revisa el trabajo terminado de otro, ejecuta los tests y publica su veredicto.
- `polisher` (haiku, low)

El texto de reparto dice que cada llamada a Agent fija `model` y `effort` según la parte, aunque cambie lo predeterminado del rol. Todos llevan las reglas del equipo: editar solo sus archivos; si se rechaza una edición, no rodearla con Bash sino escribir al dueño en el tablero; leer el tablero al empezar; terminar con un informe breve.

## 5. Herramienta `delegate`

`$.tool.register`, con `isDeferred: false`.

- **action** `start` (por defecto), `stop`, `list` o `probe`.
- **Parámetros:** `provider`, `task` (instrucciones completas, porque el agente no ve el chat), `label`, `model`, `effort`, `write` (false = solo lectura), `files` (rutas absolutas que posee), `group`, `reportTo` (quién lee el informe y actúa), `review` (proveedor revisor, distinto del autor) y opciones propias del adaptador, como `fast`.

**Al arrancar:**

- Valida el proveedor y el modelo contra el catálogo y responde con los modelos disponibles si el pedido no existe o está bloqueado.
- Si el adaptador es `autoOnly`, ignora el modelo y el esfuerzo pedidos. Sin modelo, usa el `defaultModel` del adaptador.
- Rechaza el arranque si un archivo pedido lo tiene otro agente en marcha.
- Reserva los archivos, registra el agente y responde al momento. El proceso corre en segundo plano con `$.process.spawn`, siempre a través del shell de login: `['/bin/zsh','-lc','exec "$0" "$@"', …argv]`.

**Mientras trabaja:** lee el stream con el `readLine` del adaptador y actualiza en vivo la actividad, los tokens, el modelo real, los archivos leídos y los editados. Lo que edita un externo se reserva sobre la marcha, porque las CLIs editan fuera del guard de Claude.

**Su prompt incluye:**

- su nombre, su grupo y el objetivo del grupo;
- sus archivos y los que tienen otros agentes;
- los agentes en marcha;
- las notas para él o su grupo;
- el tablero compartido `.orchestra/BOARD.md`, que debe releer antes de tocar un archivo compartido y antes de terminar;
- quién leerá su informe;
- la ruta `.orchestra/reports/<AAAAMMDD-HHMM>-<id>.md` y el formato del informe: `## Summary`, `## Files changed`, `## How I checked it`, `## Left undone or risky`, `## Messages` (líneas `TO <agente o grupo>: …`).

Si la CLI tiene un flag para guardar su mensaje final, se usa ese. Si no, el agente escribe el archivo y repite el informe al final.

**Al terminar:**

- Reescribe el informe con una cabecera: agente, modelo, esfuerzo, grupo, quién lo pidió, para quién es, revisor y estado. Debajo van la tarea, el informe, `## Activity` y, si falló, la cola de stderr.
- Un informe vacío cuenta como fallo, aunque el código de salida sea 0.
- Publica en el tablero el resumen y la ruta para `reportTo` (y para quien lo pidió), y también sus líneas `TO`. Libera sus archivos.
- Si lo pidió el orquestador, `$.prompt.submit` con el resumen y la ruta, **no** con el informe entero.
- Si hay `review`, lanza al revisor: un `orchestra:reviewer` si es Claude, o un `delegate` de solo lectura con otro proveedor. Si el proveedor del revisor no está disponible, usa Claude.

**Rechazos de cuenta:**

- Si el error coincide con `refusal`, bloquea ese modelo, o toda la CLI si el error es de sesión o de cuenta. Los límites de ritmo caducan en 2 h y el resto en 72 h, y el bloqueo se guarda en `$.store`.
- Reintenta **una vez** con otro modelo del mismo nivel en la misma CLI.
- Deja de ofrecer lo bloqueado en el reparto. `probe` manda a cada modelo un prompt mínimo, de 4 en 4, y actualiza los bloqueos.

**Archivos:** `.orchestra/` lleva su propio `.gitignore` con `*`.

## 6. Coordinación entre agentes

- **Tablero `board`** (herramienta). `read` devuelve, en este orden: las notas para mí o mi grupo, los grupos con su objetivo, los agentes en marcha con lo que hacen, los archivos reservados y las últimas notas. `post` publica con `to` opcional (un agente, un grupo u `orchestrator`). `group` fija el objetivo de un grupo. El mod mantiene `.orchestra/BOARD.md` al día para los agentes externos.
- **Destinatario tolerante:** si `to` viene en otra mayúscula, como «Grupo: nombre» o con el nombre a medias, se entrega al agente o grupo que corresponde.
- **Guard de archivos:** un `tool.call` sobre Edit, Write, MultiEdit y NotebookEdit hace que el subagente reserve el archivo al editarlo. Si lo tiene otro agente en marcha, devuelve `{ deny }` con el nombre del dueño y registra la espera. El orquestador no reserva. Sin `.catch`: un fallo del mod nunca bloquea el trabajo. Las reservas se liberan al terminar el agente.
- **Quién hace qué en cada archivo (`touches`):** por archivo y por agente se guarda el rol (`edits`, `audits`, `reads` o `plans`) y las funciones o clases que tocan sus ediciones, sacadas del `old_string`/`new_string` de Edit. Un `Write` cuenta como «whole file». Read y Grep sobre un archivo cuentan como lectura. Un revisor audita y un planificador planea. Para los externos se usan los archivos leídos y editados de su stream.
- **Grupos automáticos:**
  - Una descripción «Grupo: nombre» fija el grupo.
  - Si no, hereda el del padre.
  - Si tampoco, va al grupo de su tipo de trabajo (Design, Build, Review, Polish, Research, Planning), cada uno con su objetivo predeterminado.
  - Si nada aplica, el objetivo es «Working on: <tarea del primero>».
- **Relay con Haiku:**
  - Las notas largas (más de unos 280 caracteres) y los informes finales se condensan con `$.model.complete({ model: 'haiku', effort: 'low', timeoutMs })` antes de llegar al tablero y al chat principal.
  - Reglas para Haiku: conservar textualmente rutas, identificadores, números, comandos, errores y quién debe hacer qué.
  - Si al resultado le falta una ruta o identificador del original, o Haiku falla, va el original.
  - Se puede encender y apagar desde el panel, que muestra cuánto ha condensado.

## 7. Panel

Un solo panel: `$.ui.open` más un hook `ui.render` sobre `Pane`, con los elementos de `$.ui.resolve(e)`. Debe funcionar igual en la **CLI** y en la **app de escritorio**. En el móvil no hay `Input` ni `Select`: compruébalo con `'Input' in ui` y deja esa parte en solo lectura. Usa secciones en tarjetas (`Box` con `borderStyle="round"`, `paddingX`) y un título de color en cada una. De arriba abajo:

1. **Usage** (siempre arriba y siempre visible):
   - `5h` y `Week`: barra coloreada por umbral, `% used · % left`, y el reinicio en hora local (con el día si no es hoy) más la cuenta atrás.
   - Datos de `$.session.usage()` al arrancar y del evento `session.measure`. La cuenta atrás se refresca cada 60 s con `$.clock.every` y `$.ui.invalidate`.
   - Debajo: el contexto del chat principal (barra, k/total, %, modelo, esfuerzo) y los contadores de peticiones premium del mes.
2. **Orchestra:**
   - Arriba, los grupos con su objetivo y cuántos agentes tienen en marcha.
   - Debajo, **una línea plegable por proveedor**, con un `Button` `plain` y `key` estable. En la CLI se abre también con un dígito como `hotkey`. Cerrada, solo muestra el resumen («▸ Codex · 2 running · 1 done · api, footer»).
   - Abierta, por agente: estado, nombre, grupo y tipo; modelo, esfuerzo y `ctx` con barra, k/total y % **sobre la ventana máxima del modelo** (un subagente con el mismo modelo que el chat toma la ventana real del chat); la tarea y quién la pidió; lo que hace ahora; `✎ edits archivo (funciones)`; `◎ reads` / `◉ audits` / `◇ plans`; con quién habla; la ruta de su informe.
3. **Files:** los archivos en uso por agentes en marcha, primero los que tienen varios agentes, cada uno marcado con su número de agentes. Por archivo, una línea por agente con su icono, su nombre, su proveedor, su rol y las funciones que toca.
4. **Working together:** los pares que se han escrito (`a ⇄ b · N msgs · último mensaje`), las esperas en curso (`⏸ x waits on y: archivo`) y una «Activity» plegable con encargos, reservas, esperas, notas y finales.
5. **Agent:** un `Select` para elegir un agente y ver su ficha y su conversación, con los botones «Ask for status» y «Stop» (Stop solo para externos).
6. **Message the team:** un `Select` de destinatario (agente, grupo u orchestrator) y un `Input` con botón Send. El mensaje llega al tablero como nota de «you».
7. **Haiku relay:** ON/OFF, lo condensado y los tokens ahorrados, con el botón para encenderlo o apagarlo en la misma fila.

Además: el comando `/orchestra`, que abre el panel, y `$.ui.status` con «orchestra: N running».

## 8. Pruebas y verificación

Escribe tests con `claude-code/testing`. Monta el panel en `terminal` **y** en `desktop`, y despliega los proveedores antes de buscar sus filas. Como mínimo, comprueba:

- Los límites: usado, restante y reinicio.
- Las reservas, las esperas y la entrega de notas.
- Cada adaptador simulado, con `process.spawn` como generador y `process.run`: argv correcto, lectura del stream, archivos reservados e informe en el tablero.
- Que solo se ofrece la generación más nueva de cada línea de modelos.
- Que un agente `autoOnly` nunca recibe modelo ni esfuerzo.
- Que se usa el modelo por defecto cuando no se pide ninguno.
- Los rechazos de cuenta: se bloquea el modelo o la CLI y se reintenta una vez.
- Un agente sin informe, que queda como fallo.
- El revisor automático.
- El relay: condensa, y deja pasar el original si se pierde una ruta.
- Varios agentes sobre un archivo: rol y funciones.
- El panel: plegar y desplegar, elegir un agente, enviar un mensaje y encender o apagar el relay.

Recuerda que en el arnés los stubs de los nombres de `$` devuelven `{ value: … }`, y usa `mock.clock` y `mock.store`.

Pasa `claude plugin validate` y `claude plugin test`, y `tsc` sin errores en `register.tsx`.

Prueba a mano cada CLI activa en un directorio temporal, con una tarea mínima que ejecute un comando y escriba el informe.

Si el mod se instala desde un marketplace local, sube la versión en `plugin.json` y ejecuta `claude plugin marketplace update <marketplace>` y luego `claude plugin update orchestra@<marketplace>`.

## 9. Avisos que me debes dar al terminar

- La ruta del mod, cómo se carga (recarga en caliente o `--plugin-dir`, o reiniciar si se instaló) y qué quedó sin probar.
- Que los modos de escritura de las CLIs externas les permiten editar el proyecto, y qué sandbox tiene cada una.
- Que cada agente externo que termina abre un turno en el chat principal.
- Que el relay con Haiku gasta un poco de los límites de Claude, y solo en mensajes largos.
- Qué CLIs no informan de las funciones que editan: en el panel solo se verá el archivo.
- Que solo un agente edita un archivo a la vez y los demás pueden leerlo o auditarlo. Si quiero que varios editen funciones distintas del mismo archivo a la vez, hay que cambiar el guard a reservas por función.
