FROM node:22-slim AS build

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV CI=true

WORKDIR /home/node/app

COPY . .
RUN DEBIAN_FRONTEND=noninteractive

RUN apt-get update -y

RUN corepack enable
RUN pnpm install

WORKDIR /home/node/app
RUN pnpm run build

FROM node:22-slim
WORKDIR /home/node/app

RUN apt-get update -y

RUN corepack enable

COPY --from=build /home/node/app/package.json .
COPY --from=build /home/node/app/pnpm-lock.yaml .

RUN pnpm install

COPY --from=build /home/node/app/dist .

RUN chown -R node:node /home/node
USER node

WORKDIR /home/node/app

CMD [ "node", "index.js"]