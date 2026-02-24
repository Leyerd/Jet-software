# Plan de metas para convertir JET en sistema principal de gestión EIRL

## Objetivo final
Que JET cubra de extremo a extremo: obligaciones fiscales empresa + dueño, administración multipropósito del negocio, y operación diaria equivalente (o superior) a la que hoy depende de un contador externo.

## Lineamiento operativo decidido
- Modo single-user: se prioriza simplicidad y continuidad operativa.
- Se omiten requerimientos de seguridad avanzada para no frenar uso real del dueño-operador.

## Meta A1 (0-15 días) — Flujo fiscal mínimo infalible (empresa + dueño)
**Entregables**
1. Checklist único mensual: F29, DDJJ, F22 empresa y F22 dueño.
2. Estado de cumplimiento por obligación con evidencia obligatoria y acuse.
3. Bloqueo de operaciones críticas cuando exista obligación crítica vencida sin acuse.

**Gate**
- 100% obligaciones críticas del período en estado `acuse` o con bloqueo activo.

## Meta A2 (15-30 días) — Reorganización de navegación (menús vacíos → menús guiados)
**Entregables**
1. Agrupación de módulos en 5 menús: Operación diaria, Impuestos y cierre, Control y análisis, Gobierno, Sistema.
2. Estado inicial guiado por módulo: “qué falta cargar para ver datos”.
3. CTA por módulo para poblar datos demo o correr consulta inicial.

**Gate**
- Ningún módulo principal inicia con pantalla “vacía” sin instrucciones accionables.

## Meta A3 (30-45 días) — Contabilidad operativa confiable
**Entregables**
1. Cierre mensual con checklist y validaciones cruzadas mínimas.
2. Libro diario/mayor/balance con consistencia verificable.
3. Reglas de asientos por tipo de operación frecuentes (venta, compra, gasto, importación).

**Gate**
- Cierre de un mes completo sin ajustes manuales fuera del sistema.

## Meta A4 (45-60 días) — Reportería de gestión y control dueño-operador
**Entregables**
1. Reportes ejecutivos en lenguaje de decisión (no técnico).
2. Semáforo de salud del negocio (caja, margen, deuda, riesgo fiscal).
3. Tablero “qué hacer hoy” (acciones priorizadas por impacto).

**Gate**
- El dueño puede operar semanalmente usando solo el tablero y reportes de JET.

## Meta A5 (60-90 días) — Integración operativa multipropósito
**Entregables**
1. Flujo unificado ventas + inventario + tesorería + impuestos.
2. Conciliación operacional automatizada (bancos/marketplaces/documentos).
3. Tareas recurrentes automatizadas (recordatorios y cierres básicos).

**Gate**
- Operación mensual completa de la empresa sin planillas externas paralelas.

## Meta A6 (90-120 días) — Validación de reemplazo real de contador
**Entregables**
1. Simulación de 3 cierres mensuales consecutivos solo con JET.
2. Evidencia de cumplimiento fiscal y trazabilidad por período.
3. Informe final de brechas remanentes y acciones de mejora.

**Gate**
- 3 ciclos mensuales completos, con cumplimiento fiscal y contable documentado en JET.
