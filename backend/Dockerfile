FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Imagem de produção: só o código compilado, as dependências de execução e as
# migrações. Os testes NÃO entram aqui.
FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY migrations ./migrations
USER node
CMD ["node", "dist/main.js"]

# Imagem dos testes (perfil `test` do compose): a de produção + a pasta test/.
FROM runtime AS test
COPY --chown=node:node test ./test
