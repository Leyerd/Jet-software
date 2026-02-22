# Meta 7 — Seguridad productiva (nivel empresa)

## Estado
Implementada en autenticación con controles de credenciales, sesiones, lockout/rate limit y MFA opcional.

## Entregables cubiertos

- **Hash de credenciales robusto**
  - Hashing de password con `scrypt` + salt aleatorio + comparación timing-safe.
  - Eliminado uso de `sha256` para password auth runtime.

- **Bloqueo progresivo + rate limiting**
  - Rate limiting por IP/usuario sobre intentos de login por minuto.
  - Lockout progresivo por intentos fallidos (`auth_lockouts`), con tiempo de bloqueo incremental.

- **Rotación/revocación de sesiones**
  - En login exitoso se revocan sesiones activas previas del usuario y se emite token nuevo.
  - Revocación explícita con endpoint de revocación de sesión(es).

- **MFA opcional para roles críticos**
  - Setup + enable + disable MFA (TOTP) para `dueno` y `contador_admin`.

## Endpoints nuevos/relevantes

- `POST /auth/login`
- `POST /auth/logout`
- `POST /auth/revoke-session`
- `POST /auth/mfa/setup`
- `POST /auth/mfa/enable`
- `POST /auth/mfa/disable`

## Gate

- `sha256` no se usa en password hashing de auth.

## Verificación rápida

```bash
node JET_UNIFICADO/scripts/verificar_meta7.js
```

Debe retornar `meta7GateReached: true`.
