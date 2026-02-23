# Meta 8 — Backups cifrados + DR

## Estado
Implementada con cifrado de backups, validación periódica de restore y política RPO/RTO.

## Entregables cubiertos

- **Backups cifrados (local/offsite)**
  - Backups cifrados con AES-256-GCM usando `BACKUP_ENCRYPTION_KEY`.
  - Soporte de copia offsite (`offsiteEnabled` + `offsitePath`).

- **Pruebas periódicas de restore automatizadas**
  - Endpoint `POST /backup/validate-restore` para validar restaurabilidad del backup.
  - Script programable `npm run backup:validate:scheduled` para ejecución periódica automática.
  - Registro de resultados en `backup_restore_validations`.

- **Política RPO/RTO**
  - Política runtime incluye `rpoHours` y `rtoHours` (defaults 24h/4h).
  - Frecuencia de validación (`restoreValidationFrequency`) y último control (`lastValidationAt`).

## Gate

- Restore validado automáticamente al menos semanalmente en entorno de prueba.

## Endpoints relevantes

- `GET /backup/policy`
- `POST /backup/policy`
- `POST /backup/create`
- `POST /backup/validate-restore`
- `POST /backup/restore`

## Verificación rápida

```bash
node JET_UNIFICADO/scripts/verificar_meta8.js
```

Debe retornar `meta8GateReached: true`.
