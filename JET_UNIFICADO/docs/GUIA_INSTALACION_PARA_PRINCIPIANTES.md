# Guía paso a paso para instalar JET UNIFICADO (sin saber programación)

Esta guía está escrita para alguien que **nunca ha programado**.

---

## 0) ¿Qué vas a lograr?
Al terminar, tendrás el sistema funcionando en tu computador y podrás abrir:
- Interfaz (pantalla principal): `http://localhost:3000`
- Estado de la API (verificación técnica): `http://localhost:4000/health`

---

## 1) Instalar lo necesario (solo una vez)

### 1.1 Instalar Docker Desktop
1. Entra a: https://www.docker.com/products/docker-desktop/
2. Descarga Docker Desktop para tu sistema operativo (Windows/Mac).
3. Instálalo con el asistente (Siguiente > Siguiente > Finalizar).
4. Abre Docker Desktop y espera a que diga que está listo.

> Importante: si Docker Desktop no está abierto, el sistema no puede iniciar.

### 1.2 (Opcional) Instalar GitHub Desktop
Esto te puede facilitar abrir proyectos sin comandos complejos.
- Descarga: https://desktop.github.com/

### 1.3 Instalar Node.js (recomendado)
1. Entra a: https://nodejs.org/
2. Descarga la versión **LTS**.
3. Instálala con opciones por defecto.

> Node.js se usa para algunos chequeos y scripts internos.

---

## 2) Obtener el proyecto en tu computador

Si ya tienes la carpeta `JET_UNIFICADO`, puedes saltar a la sección 3.

Si no la tienes:
1. Descarga el proyecto como ZIP desde GitHub (botón "Code" > "Download ZIP").
2. Descomprime el ZIP.
3. Ubica la carpeta llamada `JET_UNIFICADO`.

---

## 3) Abrir terminal en la carpeta correcta

Debes abrir la terminal **dentro de `JET_UNIFICADO`**.

### Windows (fácil)
1. Abre la carpeta `JET_UNIFICADO` en el explorador.
2. Haz clic en la barra de dirección.
3. Escribe `cmd` y presiona Enter.

### Mac
1. Abre Terminal.
2. Escribe `cd ` (con espacio).
3. Arrastra la carpeta `JET_UNIFICADO` a la ventana de Terminal.
4. Presiona Enter.

---

## 4) Iniciar el sistema

Con Docker Desktop abierto y la terminal en `JET_UNIFICADO`, ejecuta:

```bash
docker compose up -d --build
```

Qué significa:
- `up`: inicia el sistema.
- `-d`: lo deja corriendo en segundo plano.
- `--build`: construye lo necesario la primera vez.

Espera entre 1 y 3 minutos.

---

## 5) Confirmar que todo funciona

Abre tu navegador:
- Interfaz: http://localhost:3000
- Salud API: http://localhost:4000/health

Si ves contenido (no error), la instalación quedó lista.

---

## 6) Uso diario (encender y apagar)

### Encender
Dentro de `JET_UNIFICADO`:

```bash
docker compose up -d
```

### Apagar

```bash
docker compose down
```

---

## 7) Solución de problemas comunes

### Problema A: `localhost:4000/health` no responde
1. Ejecuta:
```bash
docker compose down
docker compose up -d --build
```
2. Revisa contenedores:
```bash
docker compose ps
```
3. Revisa logs del API:
```bash
docker compose logs api --tail=100
```

### Problema B: Docker dice que no puede iniciar
- Verifica que Docker Desktop esté abierto.
- Reinicia Docker Desktop.
- Vuelve a ejecutar `docker compose up -d --build`.

### Problema C: Error por puerto ocupado
Puede haber otro programa usando el puerto 3000 o 4000.
- Cierra apps que usen esos puertos (otros servidores locales).
- Vuelve a iniciar con Docker.

---

## 8) Verificación rápida opcional (si quieres comprobar más)

```bash
curl -s http://localhost:4000/db/status
curl -s http://localhost:4000/system/coherence-check
```

Si devuelven JSON, el backend está respondiendo correctamente.

---

## 9) Resumen ultra corto
1. Abre Docker Desktop.
2. Abre terminal en `JET_UNIFICADO`.
3. Ejecuta `docker compose up -d --build`.
4. Abre `http://localhost:3000`.
5. Para apagar, usa `docker compose down`.

Con eso ya puedes usar el software sin entrar al código.
