# Plan de metas para lograr objetivo EIRL (evitar multas + operación profesional)

## Objetivo principal
Convertir JET UNIFICADO en una plataforma profesional que minimice riesgo de multas y permita operar contabilidad/tributación con estándar de estudio contable, manteniendo trazabilidad y evidencia auditable.

## Criterios de éxito global
- 0 obligaciones críticas vencidas sin evidencia de envío/acuse.
- 100% obligaciones con flujo: preparado → validado → enviado → acuse.
- < 24h para detectar inconsistencias tributarias críticas.
- Reducción sostenida del riesgo estimado de multa mes a mes.

## Meta 17 (0-30 días) — Cumplimiento legal operativo “anti-multas”
**Problema a resolver:** evitar atrasos y omisiones.

**Entregables**
1. Motor de vencimientos legal por tipo de contribuyente, régimen y calendario real.
2. Alertas escaladas (email/WhatsApp/Slack) con SLA y responsables.
3. Bloqueo operativo en acciones críticas si hay obligaciones vencidas sin evidencia.
4. Evidencia completa con acuse oficial y hash por obligación.

**Gate**
- `meta17GateReached: true` con casos de prueba de vencimientos y escalamiento.

## Meta 18 (30-60 días) — Validación cruzada tributaria/contable profunda
**Problema a resolver:** inconsistencias entre fuentes que gatillan observaciones/multas.

**Entregables**
1. Validadores cruzados automáticos: ventas vs RCV vs bancos vs inventario vs IVA.
2. Matriz de severidad (bloqueante/alta/media) con playbooks de corrección.
3. Reporte diario de brechas con dueño y fecha compromiso.

**Gate**
- Detección automática de discrepancias en dataset de prueba realista.

## Meta 19 (60-90 días) — Plan de cuentas y reglas contables enterprise
**Problema a resolver:** mapeos simplificados insuficientes para operación profesional.

**Entregables**
1. Plan de cuentas parametrizable por empresa/costos/centros.
2. Motor de reglas contables por tipo de operación real.
3. Ajustes automáticos de cierre y validaciones NIIF/tributarias avanzadas.

**Gate**
- 100% asientos críticos generados por reglas parametrizadas + aprobación dual.

## Meta 20 (90-120 días) — Gobierno normativo continuo con regresión avanzada
**Problema a resolver:** cambios regulatorios frecuentes y riesgo de desalineación.

**Entregables**
1. Catálogo normativo multi-año versionado y trazable.
2. Pipeline de regresión por formulario/régimen con datasets históricos.
3. Control formal de cambios legales y bitácora de decisiones.

**Gate**
- Ningún cambio normativo pasa a producción sin regresión aprobada.

## Meta 21 (120-150 días) — Confiabilidad productiva/SRE y seguridad reforzada
**Problema a resolver:** brechas operativas que afectan continuidad y evidencia.

**Entregables**
1. SLO/SLA, tableros on-call y alertas de disponibilidad/latencia/error budget.
2. DR operativo con pruebas periódicas de restore evidenciadas.
3. Hardening de seguridad (secret management, rotación de llaves, SAST/DAST).

**Gate**
- Cumplimiento sostenido de SLO y restores validados en ventanas programadas.

## Meta 22 (150-180 días) — Certificación interna “listo para reemplazo operativo”
**Problema a resolver:** demostrar confiabilidad integral antes de delegación total.

**Entregables**
1. Auditoría interna + auditoría externa técnica/contable.
2. Manual operativo de cumplimiento y matriz RACI.
3. Simulacro de cierre y ciclo fiscal completo sin intervención correctiva externa.

**Gate**
- Dictamen interno favorable + checklist de reemplazo operativo cumplida.

## KPI de seguimiento (semanal)
- % obligaciones en verde.
- % obligaciones con acuse oficial validado.
- Nº discrepancias críticas abiertas > 48h.
- Riesgo esperado de multa (monto) por período.
- Tiempo medio de cierre de brechas tributarias.

## Secuencia recomendada
Meta 17 → 18 → 19 → 20 → 21 → 22.

> Nota: el sistema actual ya cubre base fuerte (metas 10-16), pero este plan cierra las brechas para un uso profesional comparable al estándar de estudio contable.
