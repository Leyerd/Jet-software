# Meta 16 — Gobierno normativo continuo

## Estado
Implementada base operativa para registro de cambios normativos, política de revisión mensual y corrida de regresión normativa.

## Entregables cubiertos

- **Registro de cambios normativos con impacto**
  - Endpoint `GET/POST /normative/changes`.
  - Cada cambio guarda título, fuente, fecha efectiva, áreas impactadas y hash de integridad.

- **Proceso formal de actualización normativa**
  - Política runtime (`normativePolicy`) con revisión mensual, owner y ventana hotfix.

- **Regresión normativa por año/régimen/formulario (base)**
  - Endpoint `POST /normative/regression/run`.
  - Guarda corrida en `normativeRegressionRuns` y marca cambios validados.

- **UI operativa**
  - Pestaña `Normativa` para registrar cambios y ejecutar regresión.

## Gate

- Todo cambio normativo queda versionado y trazable.
- Existe corrida de regresión documentada para validar impacto.
- Dashboard/operación incluye estado de cambios y corridas recientes.

## Verificación rápida

```bash
node JET_UNIFICADO/scripts/verificar_meta16.js
```

Debe retornar `meta16GateReached: true`.
