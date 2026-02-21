FROM node:20-alpine
WORKDIR /app

# La API Sprint 3 puede correr sin instalar dependencias externas.
# (Los scripts de migración a PostgreSQL requieren 'pg' y se ejecutan manualmente fuera del contenedor).
COPY package.json ./
COPY server.js ./
COPY src ./src
COPY scripts ./scripts
COPY data ./data

EXPOSE 4000
CMD ["npm", "start"]
