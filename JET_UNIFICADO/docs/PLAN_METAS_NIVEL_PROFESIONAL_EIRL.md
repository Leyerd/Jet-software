# Plan de metas para nivel profesional (EIRL) orientado a evitar multas

## Objetivo general
Llevar JET desde un estado "operativo avanzado" a un estado "reemplazo de contador" mediante cobertura normativa completa, contabilidad configurable de estudio contable y cumplimiento operativo automatizado con evidencia auditable.

## Principios rectores
- **Backend-first y trazabilidad total**: toda decisión crítica debe dejar evidencia técnica y legalmente auditable.
- **Cumplimiento por diseño**: prevenir errores antes de declarar (no solo detectar después).
- **Reproducibilidad**: mismo set de datos y normativa debe producir mismo resultado, hash y evidencia.
- **Operación antifallas**: controles, alertas, aprobaciones y bloqueo preventivo en tareas sensibles.

---

## Meta 13 (0-30 días) — Calendario legal + semáforo tributario + evidencia automática

### Problema que resuelve
Dependencia de recordatorios manuales y alto riesgo de vencimientos omitidos (multas por atraso o declaración incompleta).

### Entregables
1. **Motor de calendario legal parametrizado por perfil tributario**
   - Soporte por tipo de contribuyente (EIRL, régimen, actividad, obligación mensual/anual).
   - Cálculo de fechas por obligación: F29, F22, DDJJ, patente, obligaciones laborales vinculadas.
   - Reglas de corrimiento por fin de semana/feriado.

2. **Semáforo tributario diario**
   - Estado por obligación: `verde` (al día), `amarillo` (próximo a vencer), `rojo` (vencido / inconsistente).
   - Indicadores mínimos: F29, F22, DDJJ, conciliaciones observadas, diferencias críticas, respaldos pendientes.

3. **Workflow de evidencia automática por obligación**
   - Estados: `preparado -> validado -> enviado -> acuse`.
   - Guardar evidencia estructurada: usuario, timestamp, hash documento, folio/acuse, fuente.

4. **Alertas escaladas multicanal**
   - Notificaciones por correo + webhook (Slack/WhatsApp gateway) con política de escalamiento.

### Gate de aceptación
- Ninguna obligación crítica puede quedar sin estado y sin fecha calculada.
- Toda obligación enviada debe tener acuse y hash asociado.
- Dashboard muestra semáforo diario y backlog de riesgo en tiempo real.

---

## Meta 14 (30-60 días) — Contabilidad profesional parametrizable + consistencia cruzada + doble aprobación

### Problema que resuelve
Mapeos contables simplificados y riesgo de errores técnicos de clasificación/registración en cierres y declaraciones.

### Entregables
1. **Plan de cuentas profesional configurable por empresa**
   - Catálogo de cuentas jerárquico (activo/pasivo/patrimonio/resultado).
   - Versionado y vigencia del plan de cuentas.
   - Parametrización por centro de costo, unidad de negocio y proyecto.

2. **Motor de reglas contables por operación real**
   - Asientos automáticos por tipo de documento/evento (venta, NC/ND, importación, honorarios, ajustes).
   - Tabla de reglas editable con control de cambios y aprobación.

3. **Validadores de consistencia cruzada**
   - Cruces automáticos: ventas vs RCV, bancos vs flujo, inventario vs costo de ventas, IVA débito/crédito vs libros.
   - Alertas por diferencias por umbral configurable y severidad.

4. **Aprobación dual en acciones críticas**
   - Flujo maker-checker para cierre/reapertura, rectificatorias y cambios normativos.
   - Bitácora completa de aprobación (quién solicita, quién aprueba, motivo, evidencia).

### Gate de aceptación
- Ningún cierre mensual se publica si hay diferencias rojas sin resolución documentada.
- Toda rectificatoria/cierre/reapertura exige doble aprobación registrada.
- Reportes contables salen del plan de cuentas versionado, no de mapeos fijos.

---

## Meta 15 (60-90 días) — Paquete fiscalizador + simulador de riesgo/multa + tablero ejecutivo EIRL

### Problema que resuelve
Falta de paquete de defensa ante fiscalización y priorización económica del riesgo operativo.

### Entregables
1. **Pack de auditoría exportable para fiscalización**
   - Export unificado (ZIP firmado/hash chain): libros, declaraciones, acuses, bitácora, cambios normativos y trazabilidad de cálculo.
   - Índice navegable por período y obligación.

2. **Simulador de multa/riesgo**
   - Modelo de riesgo por atraso, inconsistencia y reincidencia.
   - Priorización de tareas por impacto esperado (monto potencial + probabilidad).

3. **Dashboard ejecutivo EIRL**
   - Caja proyectada, margen, stock crítico, cumplimiento mensual, riesgo tributario agregado.
   - Vista gerente (resumen) y vista operativa (detalle accionable).

### Gate de aceptación
- Para un período fiscal dado, el sistema genera en 1 clic el paquete completo de evidencia fiscalizable.
- El backlog operativo queda ordenado por riesgo económico esperado y criticidad regulatoria.
- Dirección puede ver estado financiero + cumplimiento + riesgo sin depender de consolidación manual externa.

---

## Meta 16 (transversal) — Gobierno normativo continuo

### Problema que resuelve
Cambios SII/LIR no absorbidos a tiempo.

### Entregables
- Proceso formal de actualización normativa (monthly review + hotfix legal).
- Registro de cambios normativos con impacto en cálculos históricos/prospectivos.
- Suite de regresión normativa por año/régimen/formulario.

### Gate de aceptación
- Todo cambio normativo relevante queda desplegado con versión, fecha efectiva y pruebas de regresión aprobadas.

---

## KPIs de éxito (orientados a evitar multas)

- **% obligaciones en verde** (meta >= 98% mensual).
- **% declaraciones enviadas con acuse y hash** (meta = 100%).
- **Tiempo medio de resolución de alertas rojas** (meta < 48h).
- **Diferencias críticas en cruces contable-tributarios** (meta = 0 al cierre).
- **Incidencias de incumplimiento/multas** (meta = 0 por período).

---

## Secuencia de implementación recomendada

1. Implementar Meta 13 completa antes de ampliar features no-regulatorias.
2. Activar Meta 14 en paralelo por etapas: (a) plan de cuentas, (b) reglas, (c) cruces, (d) doble aprobación.
3. Cerrar Meta 15 con paquete fiscalizador y simulador de riesgo para gestión ejecutiva.
4. Operar Meta 16 como capacidad permanente (no proyecto puntual).

---

## Resultado esperado al completar Metas 13-16

- Sistema preparado para operar en modo **compliance-first**.
- Reducción drástica de errores por proceso manual.
- Capacidad de defensa ante fiscalización con evidencia completa y reproducible.
- Plataforma más cercana al estándar necesario para **reemplazo operativo de contador** en una EIRL (manteniendo revisión profesional periódica para casos complejos o litigiosos).
