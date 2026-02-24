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

## KPI de seguimiento (semanal)
- % obligaciones en verde.
- % obligaciones con acuse oficial validado.
- Nº discrepancias críticas abiertas > 48h.
- Riesgo esperado de multa (monto) por período.
- Tiempo medio de cierre de brechas tributarias.

## Secuencia recomendada
Meta 17 como ciclo continuo de mejora semanal.

> Nota: este plan fue simplificado a Meta 17 según instrucción de negocio vigente.
